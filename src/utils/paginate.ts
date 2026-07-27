/** Rows per request. The Platform API's maximum, so this is the fewest calls a sweep can take. */
const PAGE_SIZE = 100;

/**
 * Collects every page of a paginated Genesys Cloud response.
 *
 * One call per page, against a budget of 300 Platform API requests per minute shared by the whole
 * function and a 15-second ceiling on the invocation. Prefer a server-side filter where the
 * endpoint offers one; reach for this only when the whole collection is genuinely needed.
 *
 * @param fetchPage - Fetches one page. Receives the 1-based page number, the page size, and
 * `options` verbatim.
 * @param options - Passed through to `fetchPage` unchanged.
 * @returns Every entity across every page, in page order.
 *
 * @example
 * ```ts
 * import type { RoutingContext } from "../types/mod.ts";
 * import { paginate } from "./paginate.ts";
 *
 * declare const context: RoutingContext;
 *
 * const libraries = await paginate((pageNumber, pageSize) =>
 *   context.responseManagementApi.getResponsemanagementLibraries({ pageSize, pageNumber })
 * );
 * ```
 */
export async function paginate<T, O = unknown>(
  fetchPage: (pageNumber: number, pageSize: number, options: O) => Promise<{ entities?: T[]; pageCount?: number }>,
  options: O = {} as O,
): Promise<T[]> {
  const results: T[] = [];
  let pageNumber = 1;
  let totalPages = 1;

  do {
    const response = await fetchPage(pageNumber, PAGE_SIZE, options);

    if (response.entities) {
      results.push(...response.entities);
    }

    totalPages = response.pageCount || 1;
    pageNumber++;
  } while (pageNumber <= totalPages);

  return results;
}
