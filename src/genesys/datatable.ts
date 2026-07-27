import type { RoutingContext } from "../types/RoutingContext.ts";
import type { Rule } from "../types/Rule.ts";
import { paginate } from "../utils/paginate.ts";

/**
 * Reads every row of an Architect datatable.
 *
 * `showbrief: false` asks for the full row rather than just its key, which is the whole point here —
 * the rule lives in the other columns.
 *
 * @param context - Routing context carrying the Architect API client.
 * @param datatableId - The datatable to read.
 * @returns Every row, as flat records keyed by column name.
 *
 * @example
 * ```ts
 * import type { RoutingContext } from "../types/mod.ts";
 * import { getDatatableRows } from "./datatable.ts";
 *
 * declare const context: RoutingContext;
 *
 * const rows = await getDatatableRows(context, "datatable-id");
 * ```
 */
export function getDatatableRows(context: RoutingContext, datatableId: string): Promise<Record<string, unknown>[]> {
  return paginate((pageNumber, pageSize) =>
    context.architectApi.getFlowsDatatableRows(datatableId, {
      pageSize,
      pageNumber,
      showbrief: false,
    })
  );
}

/**
 * Reads the rule set from an Architect datatable.
 *
 * Rows are returned in datatable order, and that order is the rule order: evaluation runs top to
 * bottom and stops at the first rule producing a terminal decision, so moving a row changes which
 * rules can be reached.
 *
 * Rows are taken as {@linkcode Rule} without validation — the datatable's own column types are the
 * only schema enforcement there is. A column that is missing or misnamed reaches the handlers as
 * `undefined`, where each reports it as an invalid rule rather than failing the run.
 *
 * @param context - Routing context carrying the Architect API client.
 * @param datatableId - The datatable holding the rules.
 * @returns The rules, in evaluation order.
 *
 * @example
 * ```ts
 * import type { RoutingContext } from "../types/mod.ts";
 * import { getRules } from "./datatable.ts";
 *
 * declare const context: RoutingContext;
 *
 * const rules = await getRules(context, "datatable-id");
 * // rules[0]?.action === "route"
 * ```
 */
export async function getRules(context: RoutingContext, datatableId: string): Promise<Rule[]> {
  const rows = await getDatatableRows(context, datatableId);
  return rows.map((row) => row as Rule);
}
