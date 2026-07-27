import type { ActionOutcome } from "../types/ActionOutcome.ts";
import type { RoutingContext } from "../types/RoutingContext.ts";
import type { Rule } from "../types/Rule.ts";

/**
 * Raises the interaction's priority by the rule's amount.
 *
 * Not terminal, and cumulative: several matching rules each add their amount, so priority ends up
 * expressing how many urgency signals the mail tripped rather than which single rule fired last.
 * There is no upper bound — the ceiling is whatever the receiving queue treats as meaningful.
 *
 * @param context - The routing context as the preceding rules left it.
 * @param rule - The rule that matched, supplying `priority` as the amount to add.
 * @returns The context carrying the raised priority, and the audit entry. A rule with no numeric
 * priority is reported unsuccessful and leaves the context untouched.
 *
 * @example
 * ```ts
 * import type { RoutingContext, Rule } from "../types/mod.ts";
 * import { handlePriorityIncrease } from "./handlePriorityIncrease.ts";
 *
 * declare const context: RoutingContext;
 * declare const rule: Rule;
 *
 * const { context: updated } = await handlePriorityIncrease(context, rule);
 * // updated.priority === (context.priority ?? 0) + (rule.priority ?? 0)
 * ```
 */
export function handlePriorityIncrease(context: RoutingContext, rule: Rule): Promise<ActionOutcome> {
  const amount = rule.priority;

  if (typeof amount !== "number") {
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
    context: { ...context, priority: (context.priority ?? 0) + amount },
    result: {
      id: rule.key,
      isValid: true,
      isMatched: true,
      isSuccessful: true,
    },
  });
}
