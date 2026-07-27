import type { Models } from "purecloud-platform-client-v2";
import type { RoutingContext } from "../types/RoutingContext.ts";
import { paginate } from "../utils/paginate.ts";

/**
 * Reads every Response Management library in the organization.
 *
 * @param context - Routing context carrying the Response Management API client.
 * @returns Every library.
 *
 * @example
 * ```ts
 * import type { RoutingContext } from "../types/mod.ts";
 * import { getLibraries } from "./responses.ts";
 *
 * declare const context: RoutingContext;
 *
 * const libraries = await getLibraries(context);
 * ```
 */
export function getLibraries(context: RoutingContext): Promise<Models.Library[]> {
  return paginate((pageNumber, pageSize) =>
    context.responseManagementApi.getResponsemanagementLibraries({ pageSize, pageNumber })
  );
}

/**
 * Reads every canned response in a library.
 *
 * @param libraryId - The library to read.
 * @param context - Routing context carrying the Response Management API client.
 * @returns Every response in the library.
 *
 * @example
 * ```ts
 * import type { RoutingContext } from "../types/mod.ts";
 * import { getResponses } from "./responses.ts";
 *
 * declare const context: RoutingContext;
 *
 * const responses = await getResponses("library-id", context);
 * ```
 */
export function getResponses(libraryId: string, context: RoutingContext): Promise<Models.Response[]> {
  return paginate((pageNumber, pageSize) =>
    context.responseManagementApi.getResponsemanagementResponses(libraryId, { pageSize, pageNumber })
  );
}

/**
 * Finds a canned response by name within a named library.
 *
 * Rules name a library and a response rather than carrying ids, because a datatable is edited by
 * people and a name is something they can check. The cost is two paginated sweeps per reply rule,
 * which is the most expensive thing in the rule set — worth keeping in mind against the function's
 * 15-second ceiling when several reply rules can match.
 *
 * @param responseName - The response's name.
 * @param libraryName - The library's name.
 * @param context - Routing context carrying the Response Management API client.
 * @returns The matching response.
 * @throws {Error} If no library or no response carries that name. The message names which.
 *
 * @example
 * ```ts
 * import type { RoutingContext } from "../types/mod.ts";
 * import { getResponseByName } from "./responses.ts";
 *
 * declare const context: RoutingContext;
 *
 * const response = await getResponseByName("Out of hours", "Auto replies", context);
 * ```
 */
export async function getResponseByName(
  responseName: string,
  libraryName: string,
  context: RoutingContext,
): Promise<Models.Response> {
  const libraries = await getLibraries(context);
  const libraryId = libraries.find((library) => library.name === libraryName)?.id;

  if (!libraryId) {
    throw new Error(`Library with name ${libraryName} not found`);
  }

  const responses = await getResponses(libraryId, context);
  const response = responses.find((candidate) => candidate.name === responseName);

  if (!response) {
    throw new Error(`Response with name ${responseName} not found in library ${libraryName}`);
  }

  return response;
}
