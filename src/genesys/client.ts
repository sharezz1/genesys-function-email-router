import platformClient from "purecloud-platform-client-v2";
import type { Context } from "aws-lambda";
import type { Credentials } from "../types/Credentials.ts";
import { getCredentials } from "./context.ts";

type CachedToken = {
  /** The exact credentials this token was issued for. */
  readonly credentials: Credentials;
  readonly accessToken: string;
  /** Absolute epoch milliseconds at which the token stops being valid. */
  readonly expiresAt: number;
};

/**
 * The token held for the lifetime of the execution environment.
 *
 * Lambda reuses a warm container across invocations, so module scope survives between calls and a
 * token with hours of life left can be reused instead of re-authenticating every time.
 *
 * One slot rather than a keyed collection: a function is deployed per data action, and an action
 * carries a single credential set, so a container sees the same credentials for its whole life. A
 * map would hold exactly one entry forever, while being unbounded in the very case it was meant to
 * serve. Correctness does not rest on that assumption — the stored credentials are compared in
 * full on every call, so anything unexpected simply re-authenticates.
 */
let cachedToken: CachedToken | undefined;

/** The login in progress, so concurrent callers share it instead of stampeding the token endpoint. */
let inFlightLogin: { readonly credentials: Credentials; readonly promise: Promise<CachedToken> } | undefined;

/**
 * Reports whether two credential sets are interchangeable.
 *
 * The secret is compared alongside the host and client ID. Comparing only the identifier would let
 * a rotated secret keep serving the token minted with the previous one — which fails hardest in
 * the case rotation exists for, a secret that has been revoked.
 */
function sameCredentials(a: Credentials, b: Credentials): boolean {
  return a.host === b.host && a.clientId === b.clientId && a.clientSecret === b.clientSecret;
}

/**
 * Reports whether a cached token is still valid.
 *
 * No safety margin. A token lives for 24 hours, so a margin would only change the outcome in its
 * final seconds — and in exchange this module would have to know how long the runtime allows an
 * invocation to last, which is not its concern. A token that does expire mid-call answers with a
 * 401, and the honest response to that is to re-authenticate and retry rather than to have
 * predicted it here.
 */
function isUsable(token: CachedToken): boolean {
  return token.expiresAt > Date.now();
}

/** Performs a client-credentials grant and normalizes the result into a cache entry. */
async function login(
  client: platformClient.ApiClientClass,
  credentials: Credentials,
): Promise<CachedToken> {
  const authData = await client.loginClientCredentialsGrant(
    credentials.clientId,
    credentials.clientSecret,
  );

  const accessToken = authData?.accessToken;

  if (typeof accessToken !== "string" || accessToken === "") {
    throw new Error(`Genesys client-credentials grant for ${credentials.host} returned no access token.`);
  }

  // The SDK records an absolute expiry alongside the token. If it ever stops doing so, treat the
  // token as already spent: it still authenticates this invocation, but nothing is cached for the
  // next one. Inventing a lifetime would be guessing about credentials.
  const expiryTime = authData?.tokenExpiryTime;
  const expiresAt = typeof expiryTime === "number" && expiryTime > 0 ? expiryTime : 0;

  return { credentials, accessToken, expiresAt };
}

/**
 * Returns the cached token when it is usable, otherwise authenticates.
 *
 * Client-credentials grants issue no refresh token, so an expired token cannot be renewed — the
 * full grant has to run again. The SDK's built-in 401 refresh path only covers the authorization
 * code grant and does not apply here.
 */
async function acquireToken(
  client: platformClient.ApiClientClass,
  credentials: Credentials,
): Promise<CachedToken> {
  if (
    cachedToken !== undefined &&
    sameCredentials(cachedToken.credentials, credentials) &&
    isUsable(cachedToken)
  ) {
    return cachedToken;
  }

  if (inFlightLogin !== undefined && sameCredentials(inFlightLogin.credentials, credentials)) {
    return await inFlightLogin.promise;
  }

  const promise = login(client, credentials)
    .then((token) => {
      cachedToken = token;
      return token;
    })
    .finally(() => {
      if (inFlightLogin?.promise === promise) {
        inFlightLogin = undefined;
      }
    });

  inFlightLogin = { credentials, promise };

  return await promise;
}

/**
 * Discards the cached token.
 *
 * Intended for tests, and for recovery after a 401 where the held token must be dropped before
 * retrying.
 */
export function clearTokenCache(): void {
  cachedToken = undefined;
  inFlightLogin = undefined;
}

/**
 * Returns an authenticated Genesys API client.
 *
 * Credentials are read from the context's `clientContext` unless supplied explicitly, which is
 * what you want when they arrive through the request template body instead.
 *
 * Each call constructs its own {@linkcode platformClient.ApiClientClass} rather than reusing the
 * `ApiClient.instance` singleton. The singleton is shared for the lifetime of the execution
 * environment, so configuring it would let a warm container leak one organization's environment
 * and token into a later invocation for a different organization. A fresh instance costs nothing
 * and removes that possibility; the access token is still reused, and only while the credentials
 * that produced it are unchanged.
 *
 * No socket timeout is configured. The platform stops a function that exceeds its action timeout,
 * so a second, slightly shorter deadline in the client would enforce the same bound less
 * accurately. If a specific call needs its own deadline, set one on that call:
 * `client.getHttpClient().setTimeout(ms)`.
 *
 * @param context - AWS Lambda execution context for this invocation.
 * @param credentials - Credentials to use instead of those in `context.clientContext`.
 * @returns An authenticated client, ready to hand to any `platformClient` API class.
 * @throws {Error} If credentials are missing from the context, or the grant returns no token.
 *
 * @example
 * ```ts
 * import type { Context } from "aws-lambda";
 * import platformClient from "purecloud-platform-client-v2";
 * import { getClient } from "./client.ts";
 *
 * declare const context: Context;
 *
 * const client = await getClient(context);
 * const routing = new platformClient.RoutingApi(client);
 * ```
 */
export async function getClient(
  context: Context,
  credentials: Credentials = getCredentials(context),
): Promise<platformClient.ApiClientClass> {
  const client = new platformClient.ApiClientClass();

  client.setEnvironment(credentials.host);

  const token = await acquireToken(client, credentials);
  client.setAccessToken(token.accessToken);

  return client;
}
