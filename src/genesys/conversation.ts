import type platformClient from "purecloud-platform-client-v2";
import type { RoutingContext } from "../types/RoutingContext.ts";
import { getEmailRoute } from "../utils/email.ts";

/**
 * Reads the attributes held against the sender's participant on the conversation.
 *
 * Attributes are where a flow stores what it has learned about a customer, so they are the natural
 * source for substitutions in a canned reply.
 *
 * `fetchRemote` costs an extra Platform API call and buys currency: the conversation already in the
 * context was read at the start of the invocation, and a flow step running concurrently may have
 * written since. Pay for it only when a stale value would produce a wrong answer.
 *
 * @param context - Routing context carrying the conversation and the Conversations API client.
 * @param fetchRemote - Re-read the conversation from Genesys before looking, rather than using the
 * copy in the context.
 * @returns The participant's attributes, or an empty record if it has none.
 * @throws {Error} If the conversation has no id, or has no participant matching the sender.
 *
 * @example
 * ```ts
 * import type { RoutingContext } from "../types/mod.ts";
 * import { getAttributes } from "./conversation.ts";
 *
 * declare const context: RoutingContext;
 *
 * const attributes = await getAttributes(context);
 * // attributes.CustomerType === "premium"
 * ```
 */
export async function getAttributes(context: RoutingContext, fetchRemote?: boolean): Promise<Record<string, string>> {
  const findParticipant = (
    participants?: platformClient.Models.EmailMediaParticipant[],
  ): platformClient.Models.EmailMediaParticipant | undefined =>
    participants?.find((participant) => participant.address === context.message.from.email);

  let participant: platformClient.Models.EmailMediaParticipant | undefined;

  if (fetchRemote) {
    if (!context.conversation.id) {
      throw new Error("Conversation ID not found");
    }

    const remote = await context.conversationApi.getConversationsEmail(context.conversation.id);
    participant = findParticipant(remote.participants);
  } else {
    participant = findParticipant(context.conversation.participants);
  }

  if (!participant) {
    throw new Error("External participant not found in the conversation.");
  }

  return participant.attributes ?? {};
}

/**
 * Writes attributes onto the sender's participant.
 *
 * Genesys merges the supplied keys into whatever is already there rather than replacing the set, so
 * this adds and overwrites but never clears. The merged result is written back onto the
 * conversation held in the context, keeping the two in step for the rules that run afterwards.
 *
 * @param context - Routing context carrying the conversation and the Conversations API client.
 * @param data - Attributes to merge in.
 * @returns The participant's attributes after the merge.
 * @throws {Error} If the conversation or its sender participant cannot be identified, or if Genesys
 * returns no attributes.
 *
 * @example
 * ```ts
 * import type { RoutingContext } from "../types/mod.ts";
 * import { setAttributes } from "./conversation.ts";
 *
 * declare const context: RoutingContext;
 *
 * await setAttributes(context, { RouterDecision: "transfer_queue" });
 * ```
 */
export async function setAttributes(
  context: RoutingContext,
  data: Record<string, string>,
): Promise<Record<string, string>> {
  const { conversation, message, conversationApi } = context;

  const participant = (conversation.participants ?? []).find(
    (candidate) => candidate.address === message.from.email,
  );

  if (!participant?.id) {
    throw new Error("External participant or participant ID not found in the conversation.");
  }

  if (!conversation.id) {
    throw new Error("Conversation ID not found");
  }

  const { attributes } = await conversationApi.patchConversationsEmailParticipantAttributes(
    conversation.id,
    participant.id,
    { attributes: data },
  );

  if (!attributes) {
    throw new Error("Failed to update participant attributes");
  }

  participant.attributes = { ...participant.attributes, ...attributes };

  return participant.attributes;
}

/**
 * Sends an email through the agentless API.
 *
 * Agentless send attributes the message to the conversation rather than to an agent, which is what
 * lets a routing decision put mail out without occupying anyone.
 *
 * @param context - Routing context carrying the conversation and the Conversations API client.
 * @param from - Sender address. Must be an address the organization is configured to send from.
 * @param to - Recipients.
 * @param subject - Subject line.
 * @param textBody - Plain text body.
 * @param htmlBody - HTML body, when the message has one.
 * @returns The send response, carrying the id Genesys assigned the outbound message.
 *
 * @example
 * ```ts
 * import type { RoutingContext } from "../types/mod.ts";
 * import { sendEmail } from "./conversation.ts";
 *
 * declare const context: RoutingContext;
 *
 * await sendEmail(
 *   context,
 *   { email: "support@example.com", name: "Support" },
 *   [{ email: "billing@example.com", name: "Billing" }],
 *   "FW: Invoice 2026-01",
 *   "Forwarded by the email router.",
 * );
 * ```
 */
export function sendEmail(
  context: RoutingContext,
  from: platformClient.Models.EmailAddress,
  to: platformClient.Models.EmailAddress[],
  subject: string,
  textBody: string,
  htmlBody?: string,
): Promise<platformClient.Models.AgentlessEmailSendResponseDto> {
  const request: platformClient.Models.AgentlessEmailSendRequestDto = {
    senderType: "Outbound",
    fromAddress: from,
    toAddresses: to,
    subject,
    textBody,
    ...(context.conversation.id === undefined ? {} : { conversationId: context.conversation.id }),
    ...(htmlBody === undefined ? {} : { htmlBody }),
  };

  return context.conversationApi.postConversationsEmailsAgentless(request);
}

/**
 * Forwards the inbound message to another mailbox, leaving the original conversation intact.
 *
 * The sender is the inbound route the mail arrived at — the address the organization already
 * publishes and is configured to send from — rather than a fixed address. Anything else would
 * either not be sendable or would misattribute the forward.
 *
 * @param context - Routing context carrying the conversation, the message, and the API client.
 * @param toEmail - Address to forward to.
 * @param toName - Display name for the recipient.
 * @returns The send response for the forwarded message.
 * @throws {Error} If the conversation or message has no id, or if the inbound route cannot be
 * identified from the conversation's participants.
 *
 * @example
 * ```ts
 * import type { RoutingContext } from "../types/mod.ts";
 * import { forwardEmail } from "./conversation.ts";
 *
 * declare const context: RoutingContext;
 *
 * await forwardEmail(context, "escalations@example.com", "Escalations");
 * ```
 */
export function forwardEmail(
  context: RoutingContext,
  toEmail: string,
  toName?: string,
): Promise<platformClient.Models.AgentlessEmailSendResponseDto> {
  const { conversation, message } = context;

  if (!conversation.id) {
    throw new Error("Conversation ID not found");
  }

  if (!message.id) {
    throw new Error("Message ID not found");
  }

  const from = getEmailRoute(conversation, message);
  const to: platformClient.Models.EmailAddress[] = [{ email: toEmail, name: toName ?? "" }];

  return sendEmail(context, from, to, `FW: ${message.subject}`, message.textBody, message.htmlBody);
}
