import type { ActionOutcome } from "../types/ActionOutcome.ts";
import type { RoutingContext } from "../types/RoutingContext.ts";
import type { Rule } from "../types/Rule.ts";

/**
 * Lowers the interaction's priority by the rule's amount, never below zero.
 *
 * The floor is deliberate. Priority is handed to a queue that treats it as a sort key, and letting
 * de-prioritising rules accumulate into negative numbers would make a message's position depend on
 * how many of them happened to match rather than on how it should be treated.
 *
 * Not terminal: evaluation continues.
 *
 * @param context - The routing context as the preceding rules left it.
 * @param rule - The rule that matched, supplying `priority` as the amount to subtract.
 * @returns The context carrying the lowered priority, and the audit entry. A rule with no numeric
 * priority is reported unsuccessful and leaves the context untouched.
 *
 * @example
 * ```ts
 * import type { RoutingContext, Rule } from "../types/mod.ts";
 * import { handlePriorityDecrease } from "./handlePriorityDecrease.ts";
 *
 * declare const context: RoutingContext;
 * declare const rule: Rule;
 *
 * const { context: updated } = await handlePriorityDecrease(context, rule);
 * // updated.priority >= 0
 * ```
 */
export function handlePriorityDecrease(context: RoutingContext, rule: Rule): Promise<ActionOutcome> {
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
    context: { ...context, priority: Math.max(0, (context.priority ?? 0) - amount) },
    result: {
      id: rule.key,
      isValid: true,
      isMatched: true,
      isSuccessful: true,
    },
  });
}
