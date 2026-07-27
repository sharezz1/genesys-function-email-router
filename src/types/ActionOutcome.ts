import type { ActionResult } from "./ActionResult.ts";
import type { RoutingContext } from "./RoutingContext.ts";

/**
 * What applying a rule produces.
 *
 * The context and the audit entry travel together because they are two halves of one step: the
 * context is what the next rule sees, and the result is the account of how it got that way. A
 * handler that returned only one of them would leave the run either unexplained or unadvanced.
 */
export type ActionOutcome = {
  /** The routing context as this rule leaves it. */
  readonly context: RoutingContext;

  /** What this rule did, for the audit trail. */
  readonly result: ActionResult;
};
