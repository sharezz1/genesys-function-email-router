import { forwardEmail } from "../genesys/conversation.ts";
import type { ActionOutcome } from "../types/ActionOutcome.ts";
import type { RoutingContext } from "../types/RoutingContext.ts";
import type { Rule } from "../types/Rule.ts";
import { isValidEmail } from "../utils/email.ts";

/**
 * Sends a copy of the message to another address, leaving the interaction where it is.
 *
 * Unlike routing to an email target, this is not terminal: the conversation stays in Genesys and
 * evaluation continues, so a rule can copy a mailbox and a later rule can still decide where the
 * interaction goes. Use it to notify; use route-to-email to hand off.
 *
 * The target is validated before anything is sent. An address that does not parse is reported as an
 * invalid rule rather than attempted, because a rejected send costs an API call and returns an
 * error a rule author cannot see.
 *
 * A failed send is reported but not thrown: one unreachable mailbox should not abandon the rest of
 * the rule set.
 *
 * @param context - The routing context as the preceding rules left it.
 * @param rule - The rule that matched, supplying `targetName` as the recipient address.
 * @returns The context carrying the forward target, and the audit entry.
 *
 * @example
 * ```ts
 * import type { RoutingContext, Rule } from "../types/mod.ts";
 * import { handleForward } from "./handleForward.ts";
 *
 * declare const context: RoutingContext;
 * declare const rule: Rule;
 *
 * const { result } = await handleForward(context, rule);
 * // result.isSuccessful === true when the message was accepted for delivery
 * ```
 */
export async function handleForward(context: RoutingContext, rule: Rule): Promise<ActionOutcome> {
  const target = rule.targetName?.trim();

  if (!target || !isValidEmail(target)) {
    return {
      context,
      result: {
        id: rule.key,
        isValid: false,
        isMatched: true,
        isSuccessful: false,
        message: `Invalid target email address: "${rule.targetName}"`,
      },
    };
  }

  let isSuccessful = true;
  let error: unknown;
  let message: string | undefined;

  if (!context.isTestMode) {
    try {
      await forwardEmail(context, target);
    } catch (caught) {
      isSuccessful = false;
      error = caught;
      message = caught instanceof Error ? caught.message : String(caught);
    }
  }

  return {
    context: { ...context, target },
    result: {
      id: rule.key,
      isValid: true,
      isMatched: true,
      isSuccessful,
      message,
      error,
    },
  };
}
