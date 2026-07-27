import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assertEquals, assertExists } from "@std/assert";
import { restore, stub } from "@std/testing/mock";
import type platformClient from "purecloud-platform-client-v2";
import { handleForward } from "../../src/actions/handleForward.ts";
import type { RoutingContext } from "../../src/types/RoutingContext.ts";
import { RuleAction } from "../../src/types/RuleAction.ts";
import { CONVERSATION_ID, createMockRoutingContext, createRoute, createRule, ROUTE_EMAIL } from "../fixtures.ts";

/** The mailbox the rules forward to. Valid, and distinct from the inbound route. */
const FORWARD_TARGET = "escalations@example.com";

/** A send response shaped the way the agentless API returns one. */
function createSendResponse(): platformClient.Models.AgentlessEmailSendResponseDto {
  return {
    id: "agentless-0001",
    conversationId: CONVERSATION_ID,
    senderType: "Outbound",
    fromAddress: createRoute(),
    toAddresses: [{ email: FORWARD_TARGET, name: "" }],
    dateCreated: "2026-01-01T00:00:00.000Z",
  };
}

describe("Actions => Forward => handleForward()", () => {
  let context: RoutingContext;

  beforeEach(() => {
    context = createMockRoutingContext();
  });

  afterEach(() => restore());

  it("forwards the message and reports success for a valid address", async () => {
    const send = stub(
      context.conversationApi,
      "postConversationsEmailsAgentless",
      () => Promise.resolve(createSendResponse()),
    );

    const rule = createRule({ action: RuleAction.Forward, targetName: FORWARD_TARGET });
    const { context: updated, result } = await handleForward(context, rule);

    assertEquals(result.isValid, true);
    assertEquals(result.isMatched, true);
    assertEquals(result.isSuccessful, true);
    assertEquals(result.message, undefined);
    assertEquals(result.error, undefined);
    assertEquals(updated.target, FORWARD_TARGET);
    assertEquals(send.calls.length, 1);
  });

  it("sends from the inbound route, to the target, with a forwarded subject", async () => {
    const send = stub(
      context.conversationApi,
      "postConversationsEmailsAgentless",
      () => Promise.resolve(createSendResponse()),
    );

    const rule = createRule({ action: RuleAction.Forward, targetName: FORWARD_TARGET });
    await handleForward(context, rule);

    const call = send.calls[0];
    assertExists(call);

    const request = call.args[0];
    assertEquals(request.senderType, "Outbound");
    assertEquals(request.fromAddress.email, ROUTE_EMAIL);
    assertEquals(request.toAddresses.length, 1);
    assertEquals(request.toAddresses[0]?.email, FORWARD_TARGET);
    assertEquals(request.subject, `FW: ${context.message.subject}`);
    assertEquals(request.conversationId, CONVERSATION_ID);
    assertEquals(request.textBody, context.message.textBody);
  });

  it("trims the target before forwarding", async () => {
    const send = stub(
      context.conversationApi,
      "postConversationsEmailsAgentless",
      () => Promise.resolve(createSendResponse()),
    );

    const rule = createRule({ action: RuleAction.Forward, targetName: `  ${FORWARD_TARGET}  ` });
    const { context: updated, result } = await handleForward(context, rule);

    assertEquals(result.isValid, true);
    assertEquals(updated.target, FORWARD_TARGET);
    assertEquals(send.calls.length, 1);
  });

  const invalidTargets: ReadonlyArray<readonly [string, string | undefined]> = [
    ["missing", undefined],
    ["blank", "   "],
    ["not an address", "not-an-email"],
  ];

  for (const [label, targetName] of invalidTargets) {
    it(`reports isValid false and sends nothing when the target is ${label}`, async () => {
      const send = stub(
        context.conversationApi,
        "postConversationsEmailsAgentless",
        () => Promise.resolve(createSendResponse()),
      );

      const rule = createRule(
        targetName === undefined ? { action: RuleAction.Forward } : { action: RuleAction.Forward, targetName },
      );
      const { context: updated, result } = await handleForward(context, rule);

      assertEquals(result.isValid, false);
      assertEquals(result.isMatched, true);
      assertEquals(result.isSuccessful, false);
      assertEquals(result.message, `Invalid target email address: "${targetName}"`);
      assertEquals(updated.target, undefined);
      assertEquals(send.calls.length, 0);
    });
  }

  it("reports success and a target in test mode, but sends nothing", async () => {
    context = createMockRoutingContext({ isTestMode: true });

    const send = stub(
      context.conversationApi,
      "postConversationsEmailsAgentless",
      () => Promise.resolve(createSendResponse()),
    );

    const rule = createRule({ action: RuleAction.Forward, targetName: FORWARD_TARGET });
    const { context: updated, result } = await handleForward(context, rule);

    assertEquals(result.isValid, true);
    assertEquals(result.isSuccessful, true);
    assertEquals(updated.target, FORWARD_TARGET);
    assertEquals(send.calls.length, 0);
  });

  it("reports isSuccessful false with the error's message when the send rejects", async () => {
    const failure = new Error("Mailbox unavailable");

    stub(
      context.conversationApi,
      "postConversationsEmailsAgentless",
      () => Promise.reject(failure),
    );

    const rule = createRule({ action: RuleAction.Forward, targetName: FORWARD_TARGET });
    const { context: updated, result } = await handleForward(context, rule);

    assertEquals(result.isValid, true);
    assertEquals(result.isSuccessful, false);
    assertEquals(result.message, "Mailbox unavailable");
    assertEquals(result.error, failure);
    assertEquals(updated.target, FORWARD_TARGET);
  });

  it("still reports a string message when the send rejects with a plain object", async () => {
    const failure = { status: 404, code: "not.found" };

    stub(
      context.conversationApi,
      "postConversationsEmailsAgentless",
      () => Promise.reject(failure),
    );

    const rule = createRule({ action: RuleAction.Forward, targetName: FORWARD_TARGET });
    const { result } = await handleForward(context, rule);

    // The SDK rejects with plain objects as often as with Errors. Only that a non-empty string
    // reaches the audit trail is asserted; the exact rendering belongs to the source.
    assertEquals(result.isSuccessful, false);
    assertEquals(typeof result.message, "string");
    assertEquals((result.message ?? "").length > 0, true);
    assertEquals(result.error, failure);
  });

  it("does not throw when the send rejects with a primitive", async () => {
    stub(
      context.conversationApi,
      "postConversationsEmailsAgentless",
      () => Promise.reject("rate limited"),
    );

    const rule = createRule({ action: RuleAction.Forward, targetName: FORWARD_TARGET });
    const { result } = await handleForward(context, rule);

    assertEquals(result.isSuccessful, false);
    assertEquals(result.message, "rate limited");
  });
});
