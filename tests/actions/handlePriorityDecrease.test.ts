import { assertEquals, assertNotStrictEquals, assertStrictEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { handlePriorityDecrease } from "../../src/actions/handlePriorityDecrease.ts";
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

describe("Actions => Priority Decrease => handlePriorityDecrease()", () => {
  it("subtracts the rule's amount from an existing priority", async () => {
    const context = createMockRoutingContext({ priority: 8 });
    const rule = createRule({ priority: 3 });

    const outcome = await handlePriorityDecrease(context, rule);

    assertEquals(outcome.context.priority, 5);
  });

  it("reaches exactly zero when the amount equals the current priority", async () => {
    const context = createMockRoutingContext({ priority: 5 });
    const rule = createRule({ priority: 5 });

    const outcome = await handlePriorityDecrease(context, rule);

    assertEquals(outcome.context.priority, 0);
  });

  it("clamps at zero rather than going negative", async () => {
    const context = createMockRoutingContext({ priority: 2 });
    const rule = createRule({ priority: 5 });

    const outcome = await handlePriorityDecrease(context, rule);

    assertEquals(outcome.context.priority, 0);
  });

  it("treats an absent priority as zero and still clamps", async () => {
    const context = createMockRoutingContext();
    const rule = createRule({ priority: 3 });

    const outcome = await handlePriorityDecrease(context, rule);

    assertEquals(outcome.context.priority, 0);
  });

  it("is cumulative across successive rules", async () => {
    const context = createMockRoutingContext({ priority: 9 });

    const first = await handlePriorityDecrease(context, createRule({ key: "rule-a", priority: 2 }));
    const second = await handlePriorityDecrease(first.context, createRule({ key: "rule-b", priority: 4 }));

    assertEquals(first.context.priority, 7);
    assertEquals(second.context.priority, 3);
  });

  it("treats a priority of 0 as a value rather than as missing", async () => {
    const context = createMockRoutingContext({ priority: 4 });
    const rule = createRule({ priority: 0 });

    const outcome = await handlePriorityDecrease(context, rule);

    assertEquals(outcome.context.priority, 4);
    assertEquals(outcome.result.isSuccessful, true);
    assertEquals(outcome.result.message, undefined);
  });

  it("reports the rule as valid, matched and successful", async () => {
    const context = createMockRoutingContext({ priority: 8 });
    const rule = createRule({ key: "rule-priority-decrease", priority: 3 });

    const outcome = await handlePriorityDecrease(context, rule);

    assertEquals(outcome.result, {
      id: "rule-priority-decrease",
      isValid: true,
      isMatched: true,
      isSuccessful: true,
    });
  });

  it("leaves the rest of the context alone", async () => {
    const context = createMockRoutingContext({
      priority: 8,
      target: "Support Queue",
      skill: "German",
      replies: ["staged"],
    });
    const rule = createRule({ priority: 3 });

    const outcome = await handlePriorityDecrease(context, rule);

    assertEquals(outcome.context.decision, undefined);
    assertEquals(outcome.context.target, "Support Queue");
    assertEquals(outcome.context.skill, "German");
    assertEquals(outcome.context.replies, ["staged"]);
    assertStrictEquals(outcome.context.conversation, context.conversation);
    assertStrictEquals(outcome.context.message, context.message);
  });

  it("reports failure and leaves the context untouched when the priority is missing", async () => {
    const context = createMockRoutingContext({ priority: 5 });
    const rule = createRule({ key: "rule-priority-decrease" });

    const outcome = await handlePriorityDecrease(context, rule);

    assertEquals(outcome.result, {
      id: "rule-priority-decrease",
      isValid: true,
      isMatched: true,
      isSuccessful: false,
      message: "Missing or invalid priority value",
    });
    assertStrictEquals(outcome.context, context);
    assertEquals(outcome.context.priority, 5);
  });

  it("reports failure when the priority is not a number", async () => {
    const context = createMockRoutingContext({ priority: 5 });
    const rule = createRule({ priority: "5" as unknown as number });

    const outcome = await handlePriorityDecrease(context, rule);

    assertEquals(outcome.result.isSuccessful, false);
    assertEquals(outcome.result.message, "Missing or invalid priority value");
    assertStrictEquals(outcome.context, context);
    assertEquals(outcome.context.priority, 5);
  });

  it("does not mutate the context it was given", async () => {
    const context = createMockRoutingContext({ priority: 8, replies: ["staged"] });
    const rule = createRule({ priority: 3 });
    const before = captureState(context);

    const outcome = await handlePriorityDecrease(context, rule);

    assertEquals(captureState(context), before);
    assertNotStrictEquals(outcome.context, context);
  });
});
