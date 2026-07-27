import { assertEquals, assertNotStrictEquals, assertStrictEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { handleDisconnect } from "../../src/actions/handleDisconnect.ts";
import { RoutingDecision } from "../../src/types/RoutingDecision.ts";
import type { RoutingContext } from "../../src/types/RoutingContext.ts";
import { createMockRoutingContext, createRule } from "../fixtures.ts";

/**
 * The fields a handler could plausibly change, copied out so that mutation of the input context is
 * detectable after the call. Arrays are copied too, because an in-place push would otherwise be
 * invisible to a shallow comparison.
 */
function captureState(context: RoutingContext): Record<string, unknown> {
  return {
    decision: context.decision,
    target: context.target,
    skill: context.skill,
    priority: context.priority,
    replies: [...context.replies],
    executionLog: context.executionLog === undefined ? undefined : [...context.executionLog],
    isTestMode: context.isTestMode,
  };
}

describe("Actions => Disconnect => handleDisconnect()", () => {
  it("sets the decision to disconnect", async () => {
    const context = createMockRoutingContext();
    const rule = createRule();

    const outcome = await handleDisconnect(context, rule);

    assertEquals(outcome.context.decision, RoutingDecision.Disconnect);
  });

  it("overwrites a decision left by an earlier rule", async () => {
    const context = createMockRoutingContext({ decision: RoutingDecision.None });
    const rule = createRule();

    const outcome = await handleDisconnect(context, rule);

    assertEquals(outcome.context.decision, RoutingDecision.Disconnect);
  });

  it("reports the rule as valid, matched and successful", async () => {
    const context = createMockRoutingContext();
    const rule = createRule({ key: "rule-disconnect" });

    const outcome = await handleDisconnect(context, rule);

    assertEquals(outcome.result, {
      id: "rule-disconnect",
      isValid: true,
      isMatched: true,
      isSuccessful: true,
    });
  });

  it("leaves the rest of the context alone", async () => {
    const context = createMockRoutingContext({
      target: "Support Queue",
      skill: "German",
      priority: 4,
      replies: ["Thanks for your mail."],
      isTestMode: true,
    });
    const rule = createRule();

    const outcome = await handleDisconnect(context, rule);

    assertEquals(outcome.context.target, "Support Queue");
    assertEquals(outcome.context.skill, "German");
    assertEquals(outcome.context.priority, 4);
    assertEquals(outcome.context.replies, ["Thanks for your mail."]);
    assertEquals(outcome.context.isTestMode, true);
    assertStrictEquals(outcome.context.conversation, context.conversation);
    assertStrictEquals(outcome.context.message, context.message);
    assertStrictEquals(outcome.context.conversationApi, context.conversationApi);
    assertStrictEquals(outcome.context.responseManagementApi, context.responseManagementApi);
    assertStrictEquals(outcome.context.architectApi, context.architectApi);
  });

  it("does not mutate the context it was given", async () => {
    const context = createMockRoutingContext({ priority: 2, replies: ["staged"] });
    const rule = createRule();
    const before = captureState(context);

    const outcome = await handleDisconnect(context, rule);

    assertEquals(captureState(context), before);
    assertNotStrictEquals(outcome.context, context);
  });
});
