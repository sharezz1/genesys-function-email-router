import { forwardEmail } from "../genesys/conversation.ts";
import type { ActionOutcome } from "../types/ActionOutcome.ts";
import type { RoutingContext } from "../types/RoutingContext.ts";
import { RoutingDecision } from "../types/RoutingDecision.ts";
import type { Rule } from "../types/Rule.ts";
import { RuleTarget } from "../types/RuleTarget.ts";
import { isValidEmail } from "../utils/email.ts";

/** Maps a rule's target type to the decision the calling flow acts on. */
const DECISIONS: Readonly<Record<RuleTarget, RoutingDecision>> = {
  [RuleTarget.Email]: RoutingDecision.TransferToEmail,
  [RuleTarget.Queue]: RoutingDecision.TransferToQueue,
  [RuleTarget.State]: RoutingDecision.TransferToState,
};

/**
 * Sends the interaction somewhere: a queue, a flow state, or out to an email address.
 *
 * Terminal — it sets a decision, so evaluation stops here and nothing later in the table runs. This
 * is the action most rule sets end on.
 *
 * Queue and state targets are names the calling flow resolves, so they are accepted as written; an
 * email target is validated, because handing an unparseable address to the send API costs a call
 * and returns an error no rule author can see. For an email target the message is also forwarded
 * before the decision is reported, since the interaction is leaving Genesys and nothing downstream
 * will do it.
 *
 * @param context - The routing context as the preceding rules left it.
 * @param rule - The rule that matched, supplying `targetType`, `targetName` and optionally `skill`.
 * @returns The context carrying the decision, target and skill, and the audit entry.
 *
 * @example
 * ```ts
 * import type { RoutingContext, Rule } from "../types/mod.ts";
 * import { handleRoute } from "./handleRoute.ts";
 *
 * declare const context: RoutingContext;
 * declare const rule: Rule;
 *
 * const { context: updated } = await handleRoute(context, rule);
 * // updated.decision === "transfer_queue" for a queue target
 * ```
 */
export async function handleRoute(context: RoutingContext, rule: Rule): Promise<ActionOutcome> {
  const target = rule.targetName?.trim();
  const targetType = rule.targetType;
  const isEmail = targetType === RuleTarget.Email;

  const isValid = target !== undefined && target.length > 0 &&
    targetType !== undefined && Object.hasOwn(DECISIONS, targetType) &&
    (!isEmail || isValidEmail(target));

  if (!isValid || target === undefined || targetType === undefined) {
    return {
      context,
      result: {
        id: rule.key,
        isValid: false,
        isMatched: true,
        isSuccessful: false,
        message: `Invalid or missing route target "${rule.targetName}"`,
      },
    };
  }

  let isSuccessful = true;
  let message: string | undefined;

  if (isEmail && !context.isTestMode) {
    try {
      await forwardEmail(context, target);
    } catch (caught) {
      isSuccessful = false;
      message = caught instanceof Error ? caught.message : String(caught);
    }
  }

  return {
    context: { ...context, target, skill: rule.skill, decision: DECISIONS[targetType] },
    result: {
      id: rule.key,
      isValid: true,
      isMatched: true,
      isSuccessful,
      message,
    },
  };
}
