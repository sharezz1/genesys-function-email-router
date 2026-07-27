import type { ActionOutcome } from "../types/ActionOutcome.ts";
import type { RoutingContext } from "../types/RoutingContext.ts";
import { RoutingDecision } from "../types/RoutingDecision.ts";
import type { Rule } from "../types/Rule.ts";

/**
 * Records that the interaction should be ended.
 *
 * The function does not disconnect anything itself — it reports the decision and the calling
 * Architect flow ends the interaction. This is the terminal action for mail that warrants no reply
 * at all, which in practice means spam and auto-generated noise.
 *
 * Being terminal, it stops rule evaluation: nothing after it in the table runs.
 *
 * @param context - The routing context as the preceding rules left it.
 * @param rule - The rule that matched. Only its key is used, for the audit trail.
 * @returns The context carrying {@linkcode RoutingDecision.Disconnect}, and the audit entry.
 *
 * @example
 * ```ts
 * import type { RoutingContext, Rule } from "../types/mod.ts";
 * import { handleDisconnect } from "./handleDisconnect.ts";
 *
 * declare const context: RoutingContext;
 * declare const rule: Rule;
 *
 * const { context: updated } = await handleDisconnect(context, rule);
 * // updated.decision === "disconnect"
 * ```
 */
export function handleDisconnect(context: RoutingContext, rule: Rule): Promise<ActionOutcome> {
  return Promise.resolve({
    context: { ...context, decision: RoutingDecision.Disconnect },
    result: {
      id: rule.key,
      isValid: true,
      isMatched: true,
      isSuccessful: true,
    },
  });
}
