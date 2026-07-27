import type { ActionOutcome } from "./ActionOutcome.ts";
import type { RoutingContext } from "./RoutingContext.ts";
import type { Rule } from "./Rule.ts";

/**
 * Applies a rule that has already matched.
 *
 * A handler is reached only once its rule's filter has passed, so it never decides whether the rule
 * applies — it applies the rule's effect and reports the outcome. It returns the context rather
 * than mutating the one it was given, so a handler that fails leaves no partial state behind.
 *
 * Handlers must honour {@linkcode RoutingContext.isTestMode} by skipping every outbound side
 * effect while still reporting what they would have done.
 *
 * @param context - The routing context as the preceding rules left it.
 * @param rule - The rule to apply.
 * @returns The updated context, and the {@linkcode ActionOutcome} describing what happened.
 */
export type ActionHandler = (context: RoutingContext, rule: Rule) => Promise<ActionOutcome>;
