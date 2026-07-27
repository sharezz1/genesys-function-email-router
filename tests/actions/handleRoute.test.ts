import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assertEquals, assertExists } from "@std/assert";
import { restore, stub } from "@std/testing/mock";
import type platformClient from "purecloud-platform-client-v2";
import { handleRoute } from "../../src/actions/handleRoute.ts";
import type { RoutingContext } from "../../src/types/RoutingContext.ts";
import { RoutingDecision } from "../../src/types/RoutingDecision.ts";
import { RuleAction } from "../../src/types/RuleAction.ts";
import { RuleTarget } from "../../src/types/RuleTarget.ts";
import { CONVERSATION_ID, createMockRoutingContext, createRoute, createRule, ROUTE_EMAIL } from "../fixtures.ts";

/** The mailbox an email target routes to. */
const EMAIL_TARGET = "escalations@example.com";

/** A send response shaped the way the agentless API returns one. */
function createSendResponse(): platformClient.Models.AgentlessEmailSendResponseDto {
  return {
    id: "agentless-0001",
    conversationId: CONVERSATION_ID,
    senderType: "Outbound",
    fromAddress: createRoute(),
    toAddresses: [{ email: EMAIL_TARGET, name: "" }],
    dateCreated: "2026-01-01T00:00:00.000Z",
  };
}

describe("Actions => Route => handleRoute()", () => {
  let context: RoutingContext;

  beforeEach(() => {
    context = createMockRoutingContext();
  });

  afterEach(() => restore());

  /** Stubs the agentless send an email target reaches, resolving successfully. */
  function stubSend() {
    return stub(
      context.conversationApi,
      "postConversationsEmailsAgentless",
      () => Promise.resolve(createSendResponse()),
    );
  }

  it("sets transfer_queue, the target and the skill for a queue target", async () => {
    const send = stubSend();

    const rule = createRule({
      action: RuleAction.Route,
      targetType: RuleTarget.Queue,
      targetName: "Billing",
      skill: "German",
    });
    const { context: updated, result } = await handleRoute(context, rule);

    assertEquals(result.isValid, true);
    assertEquals(result.isMatched, true);
    assertEquals(result.isSuccessful, true);
    assertEquals(result.message, undefined);
    assertEquals(updated.decision, RoutingDecision.TransferToQueue);
    assertEquals(updated.target, "Billing");
    assertEquals(updated.skill, "German");
    assertEquals(send.calls.length, 0);
  });

  it("leaves the skill undefined when the rule carries none", async () => {
    const rule = createRule({ action: RuleAction.Route, targetType: RuleTarget.Queue, targetName: "Billing" });
    const { context: updated } = await handleRoute(context, rule);

    assertEquals(updated.skill, undefined);
    assertEquals(updated.decision, RoutingDecision.TransferToQueue);
  });

  it("sets transfer_state for a state target", async () => {
    const send = stubSend();

    const rule = createRule({
      action: RuleAction.Route,
      targetType: RuleTarget.State,
      targetName: "Escalation",
    });
    const { context: updated, result } = await handleRoute(context, rule);

    assertEquals(result.isValid, true);
    assertEquals(result.isSuccessful, true);
    assertEquals(updated.decision, RoutingDecision.TransferToState);
    assertEquals(updated.target, "Escalation");
    assertEquals(send.calls.length, 0);
  });

  it("sets transfer_email and forwards the message for a valid email target", async () => {
    const send = stubSend();

    const rule = createRule({
      action: RuleAction.Route,
      targetType: RuleTarget.Email,
      targetName: EMAIL_TARGET,
    });
    const { context: updated, result } = await handleRoute(context, rule);

    assertEquals(result.isValid, true);
    assertEquals(result.isSuccessful, true);
    assertEquals(updated.decision, RoutingDecision.TransferToEmail);
    assertEquals(updated.target, EMAIL_TARGET);
    assertEquals(send.calls.length, 1);

    const call = send.calls[0];
    assertExists(call);
    assertEquals(call.args[0].fromAddress.email, ROUTE_EMAIL);
    assertEquals(call.args[0].toAddresses[0]?.email, EMAIL_TARGET);
  });

  it("trims the target before routing", async () => {
    const rule = createRule({
      action: RuleAction.Route,
      targetType: RuleTarget.Queue,
      targetName: "  Billing  ",
    });
    const { context: updated } = await handleRoute(context, rule);

    assertEquals(updated.target, "Billing");
  });

  it("reports isValid false and sends nothing for an email target with an invalid address", async () => {
    const send = stubSend();

    const rule = createRule({
      action: RuleAction.Route,
      targetType: RuleTarget.Email,
      targetName: "not-an-email",
    });
    const { context: updated, result } = await handleRoute(context, rule);

    assertEquals(result.isValid, false);
    assertEquals(result.isMatched, true);
    assertEquals(result.isSuccessful, false);
    assertEquals(result.message, `Invalid or missing route target "not-an-email"`);
    assertEquals(updated.decision, undefined);
    assertEquals(updated.target, undefined);
    assertEquals(send.calls.length, 0);
  });

  it("reports isValid false when the target name is missing", async () => {
    const rule = createRule({ action: RuleAction.Route, targetType: RuleTarget.Queue });
    const { context: updated, result } = await handleRoute(context, rule);

    assertEquals(result.isValid, false);
    assertEquals(result.message, `Invalid or missing route target "undefined"`);
    assertEquals(updated.decision, undefined);
  });

  it("reports isValid false when the target name is blank", async () => {
    const rule = createRule({ action: RuleAction.Route, targetType: RuleTarget.Queue, targetName: "   " });
    const { context: updated, result } = await handleRoute(context, rule);

    assertEquals(result.isValid, false);
    assertEquals(result.message, `Invalid or missing route target "   "`);
    assertEquals(updated.decision, undefined);
  });

  it("reports isValid false when the target type is unknown", async () => {
    const rule = createRule({
      action: RuleAction.Route,
      targetType: "flow" as RuleTarget,
      targetName: "Main Flow",
    });
    const { context: updated, result } = await handleRoute(context, rule);

    assertEquals(result.isValid, false);
    assertEquals(result.isSuccessful, false);
    assertEquals(updated.decision, undefined);
  });

  it("reports isValid false when the target type is missing", async () => {
    const rule = createRule({ action: RuleAction.Route, targetName: "Billing" });
    const { context: updated, result } = await handleRoute(context, rule);

    assertEquals(result.isValid, false);
    assertEquals(updated.decision, undefined);
  });

  it("sets the decision but sends nothing in test mode", async () => {
    context = createMockRoutingContext({ isTestMode: true });
    const send = stubSend();

    const rule = createRule({
      action: RuleAction.Route,
      targetType: RuleTarget.Email,
      targetName: EMAIL_TARGET,
    });
    const { context: updated, result } = await handleRoute(context, rule);

    assertEquals(result.isValid, true);
    assertEquals(result.isSuccessful, true);
    assertEquals(updated.decision, RoutingDecision.TransferToEmail);
    assertEquals(updated.target, EMAIL_TARGET);
    assertEquals(send.calls.length, 0);
  });

  it("reports isSuccessful false but still sets the decision when the send fails", async () => {
    stub(
      context.conversationApi,
      "postConversationsEmailsAgentless",
      () => Promise.reject(new Error("Mailbox unavailable")),
    );

    const rule = createRule({
      action: RuleAction.Route,
      targetType: RuleTarget.Email,
      targetName: EMAIL_TARGET,
    });
    const { context: updated, result } = await handleRoute(context, rule);

    assertEquals(result.isValid, true);
    assertEquals(result.isSuccessful, false);
    assertEquals(result.message, "Mailbox unavailable");
    assertEquals(updated.decision, RoutingDecision.TransferToEmail);
    assertEquals(updated.target, EMAIL_TARGET);
  });

  it("still reports a string message when the send rejects with a non-Error", async () => {
    stub(
      context.conversationApi,
      "postConversationsEmailsAgentless",
      () => Promise.reject("rate limited"),
    );

    const rule = createRule({
      action: RuleAction.Route,
      targetType: RuleTarget.Email,
      targetName: EMAIL_TARGET,
    });
    const { context: updated, result } = await handleRoute(context, rule);

    assertEquals(result.isSuccessful, false);
    assertEquals(result.message, "rate limited");
    assertEquals(updated.decision, RoutingDecision.TransferToEmail);
  });
});
