import { getResponseByName } from "../genesys/responses.ts";
import type { ActionOutcome } from "../types/ActionOutcome.ts";
import type { RoutingContext } from "../types/RoutingContext.ts";
import type { Rule } from "../types/Rule.ts";

/**
 * Stages a canned response for the calling flow to send.
 *
 * The text is resolved from Response Management and appended to the context; nothing is sent from
 * here. Delivery belongs to the Architect flow, which knows whether the interaction is still live
 * and can retry — this function has one 15-second attempt and no way to tell whether a send it
 * could not confirm actually happened.
 *
 * Not terminal, and cumulative: several matching reply rules stage several texts, in rule order.
 *
 * Newlines become `<br>` so the text survives being placed into an HTML mail body.
 *
 * @param context - The routing context as the preceding rules left it.
 * @param rule - The rule that matched, supplying `responseLibrary` and `responseName`.
 * @returns The context with the response text appended to `replies`, and the audit entry. A
 * response that cannot be found is reported unsuccessful and stages nothing.
 *
 * @example
 * ```ts
 * import type { RoutingContext, Rule } from "../types/mod.ts";
 * import { handleReply } from "./handleReply.ts";
 *
 * declare const context: RoutingContext;
 * declare const rule: Rule;
 *
 * const { context: updated } = await handleReply(context, rule);
 * // updated.replies holds the resolved response text
 * ```
 */
export async function handleReply(context: RoutingContext, rule: Rule): Promise<ActionOutcome> {
  const library = rule.responseLibrary?.trim() ?? "";
  const name = rule.responseName?.trim() ?? "";

  if (library.length === 0 || name.length === 0) {
    return {
      context,
      result: {
        id: rule.key,
        isValid: false,
        isMatched: true,
        isSuccessful: false,
        message: library.length === 0
          ? `Invalid response library: "${rule.responseLibrary}"`
          : `Invalid response name: "${rule.responseName}"`,
      },
    };
  }

  let isSuccessful = true;
  let message: string | undefined;
  let replies: string[] = [];

  try {
    const response = await getResponseByName(name, library, context);
    replies = (response.texts ?? []).map((text) => text.content.replace(/\r?\n/g, "<br>"));
  } catch (caught) {
    isSuccessful = false;
    message = describe(caught);
  }

  return {
    context: { ...context, replies: [...context.replies, ...replies] },
    result: {
      id: rule.key,
      isValid: true,
      isMatched: true,
      isSuccessful,
      message,
    },
  };
}

/**
 * Renders a rejection as a message a rule author can act on.
 *
 * The Platform SDK rejects with three different shapes — a parsed error body, an extended response
 * object, or a real `AxiosError` — and only the last is an `Error`. Serializing the rest is what
 * keeps `{"status":404}` from arriving as `[object Object]`, which is the whole diagnostic a
 * deployed function gets.
 */
function describe(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return typeof error === "object" && error !== null ? JSON.stringify(error, null, 2) : String(error);
}
