import { assertEquals, assertNotStrictEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { restore, stub } from "@std/testing/mock";
import platformClient from "purecloud-platform-client-v2";
import type { Credentials } from "../../src/types/Credentials.ts";
import { clearTokenCache, getClient } from "../../src/genesys/client.ts";
import { createLambdaContext } from "../fixtures.ts";

/** The credentials `createLambdaContext()` carries in its `clientContext` headers. */
const ORG_A: Credentials = {
  host: "https://api.mypurecloud.com",
  clientId: "client-id-0001",
  clientSecret: "client-secret-0001",
};

/** A second organization, in another region, sharing nothing with {@linkcode ORG_A}. */
const ORG_B: Credentials = {
  host: "https://api.mypurecloud.de",
  clientId: "client-id-0002",
  clientSecret: "client-secret-0002",
};

/** A day, the lifetime a real Genesys client-credentials token is issued with. */
const ONE_DAY_MS = 86_400_000;

/** One recorded client-credentials grant. */
type Grant = {
  readonly clientId: string;
  readonly clientSecret: string;
};

/** An auth payload shaped like the SDK's, built loosely so a test can omit fields the SDK promises. */
function authData(accessToken: string, lifetimeMs = ONE_DAY_MS): Record<string, unknown> {
  const expiry = Date.now() + lifetimeMs;

  return {
    accessToken,
    tokenExpiryTime: expiry,
    tokenExpiryTimeString: new Date(expiry).toISOString(),
  };
}

/**
 * Replaces the grant on the prototype, not on one instance.
 *
 * `getClient` builds a new {@linkcode platformClient.ApiClientClass} on every call, so there is no
 * instance to stub ahead of time — the prototype is the only seam.
 *
 * @returns The grants performed, in order, so a test can assert how many logins actually happened.
 */
function stubGrant(respond: (clientId: string) => Record<string, unknown>): Grant[] {
  const grants: Grant[] = [];

  stub(
    platformClient.ApiClientClass.prototype,
    "loginClientCredentialsGrant",
    (clientId: string, clientSecret: string): Promise<platformClient.AuthData> => {
      grants.push({ clientId, clientSecret });

      return Promise.resolve(respond(clientId) as unknown as platformClient.AuthData);
    },
  );

  return grants;
}

/** A grant answering with a token derived from the client ID and valid for a day. */
function stubLogin(lifetimeMs = ONE_DAY_MS): Grant[] {
  return stubGrant((clientId) => authData(`token-for-${clientId}`, lifetimeMs));
}

/** Records the tokens handed to `setAccessToken`, which is otherwise write-only from outside. */
function stubAccessToken(): string[] {
  const tokens: string[] = [];

  stub(platformClient.ApiClientClass.prototype, "setAccessToken", (token: string): void => {
    tokens.push(token);
  });

  return tokens;
}

describe("Genesys => Client => getClient()", () => {
  // The token cache is module scope and outlives a test, exactly as it outlives an invocation on a
  // warm container. Every case starts cold, or it would pass alone and fail in a suite.
  beforeEach(() => {
    clearTokenCache();
  });

  afterEach(() => {
    restore();
    clearTokenCache();
  });

  it("reads credentials from the Lambda clientContext", async () => {
    const grants = stubLogin();
    const tokens = stubAccessToken();

    const client = await getClient(createLambdaContext());

    assertEquals(grants, [{ clientId: ORG_A.clientId, clientSecret: ORG_A.clientSecret }]);
    assertEquals(client.config.basePath, ORG_A.host);
    assertEquals(tokens, [`token-for-${ORG_A.clientId}`]);
  });

  it("uses explicit credentials and ignores the clientContext", async () => {
    const grants = stubLogin();

    // Credentials arriving through the request template body rather than the request headers.
    const client = await getClient(createLambdaContext(), ORG_B);

    assertEquals(grants, [{ clientId: ORG_B.clientId, clientSecret: ORG_B.clientSecret }]);
    assertEquals(client.config.basePath, ORG_B.host);
  });

  it("constructs a fresh client per call rather than the shared singleton", async () => {
    const grants = stubLogin();

    const first = await getClient(createLambdaContext(), ORG_A);
    const second = await getClient(createLambdaContext(), ORG_A);

    // The singleton lives as long as the container, so configuring it would let one organization's
    // environment and token leak into a later invocation for another. This is the whole point of
    // the module: a fresh instance per call, while the token itself is still reused.
    assertNotStrictEquals(first, second);
    assertNotStrictEquals(first, platformClient.ApiClient.instance);
    assertNotStrictEquals(second, platformClient.ApiClient.instance);
    assertEquals(grants.length, 1);
  });

  it("reuses a cached token across sequential calls", async () => {
    const grants = stubLogin();

    await getClient(createLambdaContext(), ORG_A);
    await getClient(createLambdaContext(), ORG_A);
    await getClient(createLambdaContext(), ORG_A);

    // Three invocations on a warm container, one grant: the point of the cache.
    assertEquals(grants.length, 1);
  });

  it("re-authenticates when the client secret is rotated", async () => {
    const grants = stubLogin();

    await getClient(createLambdaContext(), ORG_A);
    await getClient(createLambdaContext(), { ...ORG_A, clientSecret: "rotated-secret" });

    // A revoked secret must not keep serving the token it minted. Keying the cache on host and
    // client ID alone silently reused the stale token here.
    assertEquals(grants, [
      { clientId: ORG_A.clientId, clientSecret: ORG_A.clientSecret },
      { clientId: ORG_A.clientId, clientSecret: "rotated-secret" },
    ]);
  });

  it("re-authenticates when the client id changes", async () => {
    const grants = stubLogin();

    await getClient(createLambdaContext(), ORG_A);
    await getClient(createLambdaContext(), { ...ORG_A, clientId: "rotated-id" });

    assertEquals(grants.map((grant) => grant.clientId), [ORG_A.clientId, "rotated-id"]);
  });

  it("re-authenticates when the host changes", async () => {
    const grants = stubLogin();

    const first = await getClient(createLambdaContext(), ORG_A);
    const second = await getClient(createLambdaContext(), { ...ORG_A, host: ORG_B.host });

    // Same credentials, another region: a token minted against one host is not valid on the other.
    assertEquals(grants.length, 2);
    assertEquals(first.config.basePath, ORG_A.host);
    assertEquals(second.config.basePath, ORG_B.host);
  });

  it("re-authenticates once the cached token has expired", async () => {
    const grants = stubLogin(-1);

    await getClient(createLambdaContext(), ORG_A);
    await getClient(createLambdaContext(), ORG_A);

    assertEquals(grants.length, 2);
  });

  it("caches nothing when the grant reports no expiry time", async () => {
    const grants = stubGrant((clientId) => ({ accessToken: `token-for-${clientId}` }));

    // Without an expiry the token still authenticates this invocation, but inventing a lifetime for
    // the next one would be guessing about credentials.
    await getClient(createLambdaContext(), ORG_A);
    await getClient(createLambdaContext(), ORG_A);

    assertEquals(grants.length, 2);
  });

  it("throws when the grant returns no access token", async () => {
    stubGrant(() => ({ tokenExpiryTime: Date.now() + ONE_DAY_MS }));

    const error = await assertRejects(
      () => getClient(createLambdaContext(), ORG_B),
      Error,
      "returned no access token",
    );

    // The host names which organization's configuration to go and fix.
    assertStringIncludes(error.message, ORG_B.host);
  });

  it("throws when the grant returns an empty access token", async () => {
    stubGrant(() => ({ accessToken: "", tokenExpiryTime: Date.now() + ONE_DAY_MS }));

    await assertRejects(
      () => getClient(createLambdaContext(), ORG_A),
      Error,
      "returned no access token",
    );
  });

  it("collapses concurrent logins into a single grant", async () => {
    const grants = stubLogin();

    // Deliberately not awaited between the calls: a cold container serving parallel invocations
    // must share one login instead of stampeding the token endpoint.
    const pending = [getClient(createLambdaContext(), ORG_A), getClient(createLambdaContext(), ORG_A)];
    const [first, second] = await Promise.all(pending);

    assertEquals(grants.length, 1);
    assertNotStrictEquals(first, second);
  });

  it("does not cache a failed grant", async () => {
    const grants: Grant[] = [];
    let attempt = 0;

    stub(
      platformClient.ApiClientClass.prototype,
      "loginClientCredentialsGrant",
      (clientId: string, clientSecret: string): Promise<platformClient.AuthData> => {
        grants.push({ clientId, clientSecret });
        attempt += 1;

        if (attempt === 1) {
          return Promise.reject(new Error("invalid_client"));
        }

        return Promise.resolve(authData(`token-for-${clientId}`) as unknown as platformClient.AuthData);
      },
    );

    await assertRejects(() => getClient(createLambdaContext(), ORG_A), Error, "invalid_client");

    // The next invocation must retry rather than wait forever on a poisoned in-flight login.
    await getClient(createLambdaContext(), ORG_A);

    assertEquals(grants.length, 2);
  });
});

describe("Genesys => Client => clearTokenCache()", () => {
  beforeEach(() => {
    clearTokenCache();
  });

  afterEach(() => {
    restore();
    clearTokenCache();
  });

  it("drops the cached token so the next call authenticates again", async () => {
    const grants = stubLogin();

    await getClient(createLambdaContext(), ORG_A);
    clearTokenCache();
    await getClient(createLambdaContext(), ORG_A);

    assertEquals(grants.length, 2);
  });
});
