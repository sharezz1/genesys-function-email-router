import { assertEquals, assertStringIncludes, assertThrows } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import type { Context } from "aws-lambda";
import { getCredentials } from "../../src/genesys/context.ts";
import { createLambdaContext } from "../fixtures.ts";

/** A Lambda context with no `clientContext` at all, as an invocation carrying no headers has. */
function contextWithoutClientContext(): Context {
  const context: Record<string, unknown> = { ...createLambdaContext() };

  // Deleted rather than set to `undefined`: the property is optional, and under
  // exactOptionalPropertyTypes an explicit `undefined` is not the same thing as absent.
  delete context["clientContext"];

  return context as unknown as Context;
}

describe("Genesys => Context => getCredentials()", () => {
  it("should extract credentials correctly from valid context", () => {
    const credentials = getCredentials(createLambdaContext());

    assertEquals(credentials, {
      host: "https://api.mypurecloud.com",
      clientId: "client-id-0001",
      clientSecret: "client-secret-0001",
    });
  });

  it("should match header names case-insensitively", () => {
    // Genesys forwards the configured headers verbatim, but casing is not guaranteed to survive
    // the hops in between.
    const credentials = getCredentials(createLambdaContext({
      "x-genesys-api-host": "https://api.mypurecloud.de",
      "X-GENESYS-API-KEY": "client-id-123",
      "x-Genesys-Api-Secret": "client-secret-456",
    }));

    assertEquals(credentials, {
      host: "https://api.mypurecloud.de",
      clientId: "client-id-123",
      clientSecret: "client-secret-456",
    });
  });

  it("should throw if clientContext is missing", () => {
    const error = assertThrows(
      () => getCredentials(contextWithoutClientContext()),
      Error,
      "Missing Genesys credentials in clientContext",
    );

    assertStringIncludes(error.message, "X-Genesys-API-Host");
    assertStringIncludes(error.message, "X-Genesys-API-Key");
    assertStringIncludes(error.message, "X-Genesys-API-Secret");
  });

  it("should throw if API host is missing", () => {
    const error = assertThrows(
      () =>
        getCredentials(createLambdaContext({
          "X-Genesys-API-Key": "client-id-123",
          "X-Genesys-API-Secret": "client-secret-456",
        })),
      Error,
      "Missing Genesys credentials in clientContext",
    );

    assertStringIncludes(error.message, "X-Genesys-API-Host");
  });

  it("should throw if API key is missing", () => {
    const error = assertThrows(
      () =>
        getCredentials(createLambdaContext({
          "X-Genesys-API-Host": "https://api.mypurecloud.com",
          "X-Genesys-API-Secret": "client-secret-456",
        })),
      Error,
      "Missing Genesys credentials in clientContext",
    );

    assertStringIncludes(error.message, "X-Genesys-API-Key");
  });

  it("should throw if API secret is missing", () => {
    const error = assertThrows(
      () =>
        getCredentials(createLambdaContext({
          "X-Genesys-API-Host": "https://api.mypurecloud.com",
          "X-Genesys-API-Key": "client-id-123",
        })),
      Error,
      "Missing Genesys credentials in clientContext",
    );

    assertStringIncludes(error.message, "X-Genesys-API-Secret");
  });

  it("should treat an empty header value as missing", () => {
    assertThrows(
      () =>
        getCredentials(createLambdaContext({
          "X-Genesys-API-Host": "https://api.mypurecloud.com",
          "X-Genesys-API-Key": "",
          "X-Genesys-API-Secret": "client-secret-456",
        })),
      Error,
      "X-Genesys-API-Key",
    );
  });

  it("should treat a whitespace-only header value as missing", () => {
    assertThrows(
      () =>
        getCredentials(createLambdaContext({
          "X-Genesys-API-Host": "https://api.mypurecloud.com",
          "X-Genesys-API-Key": "client-id-123",
          "X-Genesys-API-Secret": "   ",
        })),
      Error,
      "X-Genesys-API-Secret",
    );
  });

  it("should name every missing header at once", () => {
    const error = assertThrows(
      () => getCredentials(createLambdaContext({ "X-Genesys-API-Host": "https://api.mypurecloud.com" })),
      Error,
    );

    // A misconfigured action should be fixable in one pass, not one header per deploy.
    assertStringIncludes(error.message, "X-Genesys-API-Key");
    assertStringIncludes(error.message, "X-Genesys-API-Secret");
    assertEquals(error.message.includes("X-Genesys-API-Host"), false);
  });

  it("should not leak the client secret in its error message", () => {
    const error = assertThrows(
      () => getCredentials(createLambdaContext({ "X-Genesys-API-Secret": "super-secret-value" })),
      Error,
    );

    assertEquals(error.message.includes("super-secret-value"), false);
  });
});
