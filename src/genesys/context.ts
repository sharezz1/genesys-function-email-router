import type { Context } from "aws-lambda";
import type { Credentials } from "../types/Credentials.ts";

/** Header carrying the Genesys Cloud API base URL. */
const HOST_HEADER = "X-Genesys-API-Host";

/** Header carrying the OAuth 2.0 client ID. */
const KEY_HEADER = "X-Genesys-API-Key";

/** Header carrying the OAuth 2.0 client secret. */
const SECRET_HEADER = "X-Genesys-API-Secret";

/**
 * Reads a `clientContext` header, ignoring case.
 *
 * Genesys forwards custom `config.request.headers` verbatim, and casing is not guaranteed to
 * survive intermediate hops, so lookups are case-insensitive.
 */
function readHeader(clientContext: Record<string, unknown>, name: string): string | undefined {
  const wanted = name.toLowerCase();

  for (const [key, value] of Object.entries(clientContext)) {
    if (key.toLowerCase() === wanted && typeof value === "string" && value.trim() !== "") {
      return value;
    }
  }

  return undefined;
}

/**
 * Extracts Genesys Cloud credentials from an AWS Lambda invocation context.
 *
 * Credentials are read from `context.clientContext`, which is populated from the data action's
 * `config.request.headers` and caps at 3,584 bytes of base64-encoded data; it cannot carry
 * certificates. When credentials arrive through the request template body instead, extract them in
 * your handler and pass a {@linkcode Credentials} object to `getClient` directly rather than using
 * this function.
 *
 * @param context - AWS Lambda execution context.
 * @returns The credentials carried by the invocation.
 * @throws {Error} If any required header is missing or blank. The message names every missing
 * header at once so a misconfigured action can be fixed in a single pass.
 *
 * @example
 * ```ts
 * import type { Context } from "aws-lambda";
 * import { getCredentials } from "./context.ts";
 *
 * declare const context: Context;
 *
 * const credentials = getCredentials(context);
 * // credentials.host === "https://api.mypurecloud.com"
 * ```
 */
export function getCredentials(context: Context): Credentials {
  const clientContext = (context.clientContext ?? {}) as unknown as Record<string, unknown>;

  const host = readHeader(clientContext, HOST_HEADER);
  const clientId = readHeader(clientContext, KEY_HEADER);
  const clientSecret = readHeader(clientContext, SECRET_HEADER);

  const missing = [
    host ? undefined : HOST_HEADER,
    clientId ? undefined : KEY_HEADER,
    clientSecret ? undefined : SECRET_HEADER,
  ].filter((name): name is string => name !== undefined);

  if (host === undefined || clientId === undefined || clientSecret === undefined) {
    throw new Error(
      `Missing Genesys credentials in clientContext: ${missing.join(", ")}. ` +
        `Add them to the data action's request headers, or pass credentials to getClient directly.`,
    );
  }

  return { host, clientId, clientSecret };
}
