import { assertEquals, assertNotStrictEquals, assertStrictEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { handlePrioritySet } from "../../src/actions/handlePrioritySet.ts";
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

describe("Actions => Priority Set => handlePrioritySet()", () => {
  it("sets the priority to the rule's value", async () => {
    const context = createMockRoutingContext();
    const rule = createRule({ priority: 7 });

    const outcome = await handlePrioritySet(context, rule);

    assertEquals(outcome.context.priority, 7);
  });

  it("overwrites an existing priority rather than adding to it", async () => {
    const context = createMockRoutingContext({ priority: 3 });
    const rule = createRule({ priority: 7 });

    const outcome = await handlePrioritySet(context, rule);

    assertEquals(outcome.context.priority, 7);
  });

  it("treats a priority of 0 as a value rather than as missing", async () => {
    const context = createMockRoutingContext({ priority: 5 });
    const rule = createRule({ priority: 0 });

    const outcome = await handlePrioritySet(context, rule);

    assertEquals(outcome.context.priority, 0);
    assertEquals(outcome.result.isSuccessful, true);
    assertEquals(outcome.result.message, undefined);
  });

  it("reports the rule as valid, matched and successful", async () => {
    const context = createMockRoutingContext();
    const rule = createRule({ key: "rule-priority-set", priority: 7 });

    const outcome = await handlePrioritySet(context, rule);

    assertEquals(outcome.result, {
      id: "rule-priority-set",
      isValid: true,
      isMatched: true,
      isSuccessful: true,
    });
  });

  it("leaves the rest of the context alone", async () => {
    const context = createMockRoutingContext({ target: "Support Queue", skill: "German", replies: ["staged"] });
    const rule = createRule({ priority: 7 });

    const outcome = await handlePrioritySet(context, rule);

    assertEquals(outcome.context.decision, undefined);
    assertEquals(outcome.context.target, "Support Queue");
    assertEquals(outcome.context.skill, "German");
    assertEquals(outcome.context.replies, ["staged"]);
    assertStrictEquals(outcome.context.conversation, context.conversation);
    assertStrictEquals(outcome.context.message, context.message);
  });

  it("reports failure and leaves the context untouched when the priority is missing", async () => {
    const context = createMockRoutingContext({ priority: 3 });
    const rule = createRule({ key: "rule-priority-set" });

    const outcome = await handlePrioritySet(context, rule);

    assertEquals(outcome.result, {
      id: "rule-priority-set",
      isValid: true,
      isMatched: true,
      isSuccessful: false,
      message: "Missing or invalid priority value",
    });
    assertStrictEquals(outcome.context, context);
    assertEquals(outcome.context.priority, 3);
  });

  it("reports failure when the priority is not a number", async () => {
    const context = createMockRoutingContext({ priority: 3 });
    const rule = createRule({ priority: "5" as unknown as number });

    const outcome = await handlePrioritySet(context, rule);

    assertEquals(outcome.result.isSuccessful, false);
    assertEquals(outcome.result.message, "Missing or invalid priority value");
    assertStrictEquals(outcome.context, context);
    assertEquals(outcome.context.priority, 3);
  });

  it("does not mutate the context it was given", async () => {
    const context = createMockRoutingContext({ priority: 3, replies: ["staged"] });
    const rule = createRule({ priority: 7 });
    const before = captureState(context);

    const outcome = await handlePrioritySet(context, rule);

    assertEquals(captureState(context), before);
    assertNotStrictEquals(outcome.context, context);
  });
});
