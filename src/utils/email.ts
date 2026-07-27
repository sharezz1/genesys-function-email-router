import type platformClient from "purecloud-platform-client-v2";

/**
 * Finds the inbound route the message arrived at.
 *
 * An inbound email reaches Genesys through a route, and that route joins the conversation as the
 * participant with purpose `workflow`. Matching that participant's address against the message's
 * recipients picks out which of possibly several `to` addresses actually belongs to the
 * organization — the rest may be anyone the sender happened to copy.
 *
 * This is the only address the organization is certainly configured to send from, which makes it
 * the sender for any mail the router originates.
 *
 * @param conversation - The email conversation, carrying its participants.
 * @param message - The message being routed.
 * @returns The recipient entry corresponding to the inbound route.
 * @throws {Error} If the conversation has no workflow participant, or if no recipient matches it.
 *
 * @example
 * ```ts
 * import type platformClient from "purecloud-platform-client-v2";
 * import { getEmailRoute } from "./email.ts";
 *
 * declare const conversation: platformClient.Models.EmailConversation;
 * declare const message: platformClient.Models.EmailMessage;
 *
 * const route = getEmailRoute(conversation, message);
 * // route.email === "support@example.com"
 * ```
 */
export function getEmailRoute(
  conversation: platformClient.Models.EmailConversation,
  message: platformClient.Models.EmailMessage,
): platformClient.Models.EmailAddress {
  const workflowParticipant = conversation.participants?.find((participant) => participant.purpose === "workflow");

  if (!workflowParticipant) {
    throw new Error("Workflow participant not found in the conversation.");
  }

  const route = message.to.find((address) => address.email === workflowParticipant.address);

  if (!route) {
    throw new Error("Route not found in the message 'to' addresses.");
  }

  return route;
}

/**
 * Reports whether a string is a usable email address.
 *
 * Deliberately stricter than the addressing grammar actually permits. The addresses this guards are
 * typed into a datatable by hand and used as forwarding targets, so the useful question is not
 * "could this conceivably be an address" but "is this what someone meant to type" — quoted local
 * parts and bare-IP domains are far more likely to be a mistake than an intention.
 *
 * @param email - The address to check.
 * @returns Whether the address is well formed.
 *
 * @example
 * ```ts
 * import { isValidEmail } from "./email.ts";
 *
 * isValidEmail("billing@example.com"); // true
 * isValidEmail("billing@example");     // false — no top-level domain
 * ```
 */
export function isValidEmail(email: string): boolean {
  const emailRegex = /^[a-zA-Z0-9](\.?[a-zA-Z0-9_\-+])*@[a-zA-Z0-9\-]+(\.[a-zA-Z0-9\-]+)*\.[a-zA-Z]{2,}$/;
  return emailRegex.test(email);
}

/**
 * Fills a canned response's placeholders from a set of attributes.
 *
 * Only the substitutions the response itself declares are replaced, so an attribute with no
 * matching placeholder is ignored and body text that merely resembles a placeholder is left alone.
 * A declared substitution with no attribute keeps its `{{name}}` marker rather than becoming an
 * empty string — a visible gap in an outbound message is easier to notice and fix than a silently
 * missing sentence.
 *
 * The response is cloned; the original is untouched.
 *
 * @param response - The response as Response Management returned it.
 * @param attributes - Values to substitute, keyed by substitution id.
 * @returns A copy with every text entry substituted.
 *
 * @example
 * ```ts
 * import type platformClient from "purecloud-platform-client-v2";
 * import { substitutePlaceholders } from "./email.ts";
 *
 * declare const response: platformClient.Models.Response;
 *
 * const filled = substitutePlaceholders(response, { customerName: "Ada" });
 * ```
 */
export function substitutePlaceholders(
  response: platformClient.Models.Response,
  attributes: Record<string, string>,
): platformClient.Models.Response {
  const substitutions = response.substitutions ?? [];
  const result: platformClient.Models.Response = structuredClone(response);

  result.texts = (result.texts ?? []).map((text) => {
    let content = text.content;

    for (const { id } of substitutions) {
      const value = attributes[id] ?? `{{${id}}}`;
      const regex = new RegExp(`{{\\s*${id}\\s*}}`, "g");
      content = content.replace(regex, value);
    }

    return { ...text, content };
  });

  return result;
}
