import { assert, assertEquals, assertExists, assertInstanceOf, assertStringIncludes } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { handleRule } from "../../src/routing/rules.ts";
import type { ActionResult } from "../../src/types/ActionResult.ts";
import type { RoutingContext } from "../../src/types/RoutingContext.ts";
import type { Rule } from "../../src/types/Rule.ts";
import { RuleAction } from "../../src/types/RuleAction.ts";
import { createMockRoutingContext, createRule } from "../fixtures.ts";

/**
 * A filter the fixture message matches: its subject is "Invoice 2026-01 attached".
 */
const MATCHING_FILTER = 'subject ~ "invoice"';

/** A well-formed filter the fixture message does not match. */
const NON_MATCHING_FILTER = 'subject ~ "refund"';

/** A filter that cannot be parsed at all — the comparison has no right-hand side. */
const MALFORMED_FILTER = "subject ~";

/**
 * A rule whose action column holds something {@linkcode RuleAction} does not cover.
 *
 * Rules come out of a datatable, where the action column is free text an administrator typed. A
 * misspelling or an empty cell reaches `handleRule` as exactly this, so the tests build it the
 * dishonest way on purpose rather than pretending the enum is enforced upstream.
 */
function createRuleWithRawAction(key: string, action: string | undefined): Rule {
  return { ...createRule({ key }), action } as unknown as Rule;
}

/** Every branch through `handleRule`, as the rule that reaches it. */
const EVERY_PATH: readonly { readonly label: string; readonly rule: Rule }[] = [
  {
    label: "a disabled rule",
    rule: createRule({ key: "path-disabled", action: RuleAction.PrioritySet, priority: 7, enabled: false }),
  },
  {
    label: "a rule with no filter",
    rule: createRule({ key: "path-unfiltered", action: RuleAction.PrioritySet, priority: 7 }),
  },
  {
    label: "a filter that matches",
    rule: createRule({
      key: "path-matched",
      action: RuleAction.PrioritySet,
      priority: 7,
      filter: MATCHING_FILTER,
    }),
  },
  {
    label: "a filter that does not match",
    rule: createRule({
      key: "path-unmatched",
      action: RuleAction.PrioritySet,
      priority: 7,
      filter: NON_MATCHING_FILTER,
    }),
  },
  {
    label: "a filter that throws",
    rule: createRule({
      key: "path-malformed",
      action: RuleAction.PrioritySet,
      priority: 7,
      filter: MALFORMED_FILTER,
    }),
  },
  { label: "an unknown action", rule: createRuleWithRawAction("path-unknown-action", "escalate") },
  { label: "a missing action", rule: createRuleWithRawAction("path-missing-action", undefined) },
];

/** The audit trail as it stands, which is empty rather than absent on the fixture context. */
function trail(context: RoutingContext): ActionResult[] {
  return context.executionLog ?? [];
}

/** Asserts the timing stamp every result carries, whichever branch produced it. */
function assertTimed(result: ActionResult): void {
  const { startedAt, endedAt, duration } = result;

  assertExists(startedAt, "startedAt must be stamped");
  assertExists(endedAt, "endedAt must be stamped");
  assertExists(duration, "duration must be stamped");

  assert(endedAt >= startedAt, "endedAt must not precede startedAt");
  assertEquals(duration, endedAt - startedAt);
}

describe("Routing => Rules => handleRule()", () => {
  it("skips a disabled rule without running its action", async () => {
    const rule = createRule({ key: "rule-disabled", action: RuleAction.PrioritySet, priority: 7, enabled: false });

    const { context, result } = await handleRule(createMockRoutingContext(), rule);

    assertEquals(result.message, "Rule is disabled.");
    assertEquals(result.isValid, true);
    assertEquals(result.isMatched, false);
    assertEquals(result.isSuccessful, false);

    // The action is what proves it: a priority the handler never got to set.
    assertEquals(context.priority, undefined);
  });

  it("treats a rule with no filter as matching", async () => {
    const rule = createRule({ key: "rule-unfiltered", action: RuleAction.PrioritySet, priority: 7 });

    const { context, result } = await handleRule(createMockRoutingContext(), rule);

    assertEquals(result.isMatched, true);
    assertEquals(result.isValid, true);
    assertEquals(result.isSuccessful, true);
    assertEquals(context.priority, 7);
  });

  it("runs the action when the filter matches", async () => {
    const rule = createRule({
      key: "rule-matched",
      action: RuleAction.PrioritySet,
      priority: 7,
      filter: MATCHING_FILTER,
    });

    const { context, result } = await handleRule(createMockRoutingContext(), rule);

    assertEquals(result.isMatched, true);
    assertEquals(result.isSuccessful, true);
    assertEquals(result.error, undefined);
    assertEquals(context.priority, 7);
  });

  it("skips the action when the filter does not match", async () => {
    const rule = createRule({
      key: "rule-unmatched",
      action: RuleAction.PrioritySet,
      priority: 7,
      filter: NON_MATCHING_FILTER,
    });

    const { context, result } = await handleRule(createMockRoutingContext(), rule);

    assertEquals(result.isValid, true);
    assertEquals(result.isMatched, false);
    assertEquals(result.isSuccessful, false);
    assertEquals(result.message, "Filter did not match");
    assertEquals(result.error, undefined);
    assertEquals(context.priority, undefined);
  });

  it("treats a malformed filter as a non-match and keeps the parse error", async () => {
    const rule = createRule({
      key: "rule-malformed",
      action: RuleAction.PrioritySet,
      priority: 7,
      filter: MALFORMED_FILTER,
    });

    const { context, result } = await handleRule(createMockRoutingContext(), rule);

    // One unparseable expression must not take the rest of the table with it, so the rule is a
    // non-match rather than a thrown run — but the error is kept, or nothing would ever show that
    // the filter is broken rather than merely unsatisfied.
    assertEquals(result.isValid, true);
    assertEquals(result.isMatched, false);
    assertEquals(result.isSuccessful, false);
    assertEquals(result.message, "Filter evaluation error");
    assertInstanceOf(result.error, SyntaxError);
    assertEquals(context.priority, undefined);
  });

  it("reports an unknown action as invalid", async () => {
    const rule = createRuleWithRawAction("rule-unknown-action", "escalate");

    const { context, result } = await handleRule(createMockRoutingContext(), rule);

    assertEquals(result.isValid, false);
    assertEquals(result.isSuccessful, false);
    assertStringIncludes(result.message ?? "", "escalate");
    assertEquals(context.priority, undefined);
  });

  it("reports a missing action as invalid", async () => {
    const rule = createRuleWithRawAction("rule-missing-action", undefined);

    const { context, result } = await handleRule(createMockRoutingContext(), rule);

    assertEquals(result.isValid, false);
    assertEquals(result.isSuccessful, false);
    assertEquals(result.message, "Unsupported or missing action type: undefined");
    assertEquals(context.priority, undefined);
  });

  it("keeps a filter error on an invalid rule too", async () => {
    // Both faults at once. The action is checked before the match is, so this lands in the invalid
    // branch — which must still carry the parse error, or the second fault would hide the first.
    const rule = createRuleWithRawAction("rule-doubly-broken", "escalate");
    const broken = { ...rule, filter: MALFORMED_FILTER } as Rule;

    const { result } = await handleRule(createMockRoutingContext(), broken);

    assertEquals(result.isValid, false);
    assertEquals(result.isMatched, false);
    assertInstanceOf(result.error, SyntaxError);
  });
});

describe("Routing => Rules => handleRule() => audit trail", () => {
  it("appends exactly one entry on every path", async () => {
    for (const { label, rule } of EVERY_PATH) {
      const { context } = await handleRule(createMockRoutingContext(), rule);

      assertEquals(trail(context).length, 1, `${label} should append exactly one entry`);
      assertEquals(trail(context)[0]?.id, rule.key, `${label} should record the rule's key`);
    }
  });

  it("stamps startedAt, endedAt and duration on every path", async () => {
    for (const { label, rule } of EVERY_PATH) {
      const { context, result } = await handleRule(createMockRoutingContext(), rule);

      assertTimed(result);

      const entry = trail(context)[0];
      assertExists(entry, `${label} should append an entry`);
      assertTimed(entry);
    }
  });

  it("accumulates entries across successive calls", async () => {
    const rules = [
      createRule({ key: "rule-1", action: RuleAction.PriorityIncrease, priority: 2 }),
      createRule({ key: "rule-2", action: RuleAction.PrioritySet, priority: 9, filter: NON_MATCHING_FILTER }),
      createRule({ key: "rule-3", action: RuleAction.PriorityIncrease, priority: 3, filter: MATCHING_FILTER }),
    ];

    let context = createMockRoutingContext();

    for (const rule of rules) {
      ({ context } = await handleRule(context, rule));
    }

    // The trail is the whole account of the run — a deployed function emits no logs — so a rule
    // that did nothing has to appear alongside the ones that did.
    assertEquals(trail(context).map((entry) => entry.id), ["rule-1", "rule-2", "rule-3"]);
    assertEquals(trail(context).map((entry) => entry.isSuccessful), [true, false, true]);
    assertEquals(context.priority, 5);
  });
});
