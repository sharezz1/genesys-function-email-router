import type { ActionOutcome } from "../types/ActionOutcome.ts";
import type { RoutingContext } from "../types/RoutingContext.ts";
import type { Rule } from "../types/Rule.ts";

/**
 * Sets the interaction's priority to the rule's value, discarding whatever earlier rules set.
 *
 * Not terminal: evaluation continues, so a later rule can still route or override this. Use it for
 * an absolute statement about a class of mail; use increase or decrease to nudge a value other
 * rules are also contributing to.
 *
 * @param context - The routing context as the preceding rules left it.
 * @param rule - The rule that matched, supplying `priority`.
 * @returns The context carrying the new priority, and the audit entry. A rule with no numeric
 * priority is reported unsuccessful and leaves the context untouched.
 *
 * @example
 * ```ts
 * import type { RoutingContext, Rule } from "../types/mod.ts";
 * import { handlePrioritySet } from "./handlePrioritySet.ts";
 *
 * declare const context: RoutingContext;
 * declare const rule: Rule;
 *
 * const { context: updated } = await handlePrioritySet(context, rule);
 * // updated.priority === rule.priority
 * ```
 */
export function handlePrioritySet(context: RoutingContext, rule: Rule): Promise<ActionOutcome> {
  const priority = rule.priority;

  if (typeof priority !== "number") {
    return Promise.resolve({
      context,
      result: {
        id: rule.key,
        isValid: true,
        isMatched: true,
        isSuccessful: false,
        message: "Missing or invalid priority value",
      },
    });
  }

  return Promise.resolve({
    context: { ...context, priority },
    result: {
      id: rule.key,
      isValid: true,
      isMatched: true,
      isSuccessful: true,
    },
  });
}
