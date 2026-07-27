import type platformClient from "purecloud-platform-client-v2";
import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assert, assertEquals, assertExists, assertMatch } from "@std/assert";
import { restore, stub } from "@std/testing/mock";
import { getDatatableRows, getRules } from "../../src/genesys/datatable.ts";
import { createMockRoutingContext } from "../fixtures.ts";
import type { Rule } from "../../src/types/Rule.ts";
import { RuleAction } from "../../src/types/RuleAction.ts";
import { RuleTarget } from "../../src/types/RuleTarget.ts";

/** Datatable rows arrive as opaque column maps; rules only become rules once read as such. */
function asGenesysRows(input: readonly Rule[]): Record<string, object>[] {
  return input as unknown as Record<string, object>[];
}

const routeRule: Rule = {
  key: "rule-0",
  action: RuleAction.Route,
  targetType: RuleTarget.Queue,
  targetName: "Support Queue",
  priority: 5,
  enabled: true,
  filter: 'subject ~ "invoice"',
  skill: "billing",
  responseLibrary: "responses",
  responseName: "default-invoice",
  description: "Route invoice-related emails",
};

const replyRule: Rule = {
  key: "rule-1",
  action: RuleAction.Reply,
  targetType: RuleTarget.Email,
  targetName: "autoresponder@example.com",
  priority: 1,
  enabled: true,
  filter: 'subject ~ "vacation"',
  skill: "general",
  responseLibrary: "default",
  responseName: "vacation-reply",
  description: "Auto-reply to vacation requests",
};

const mockRules: Rule[] = [routeRule, replyRule];

describe("Genesys => Datatables => getDatatableRows()", () => {
  const context = createMockRoutingContext();
  let rows: Record<string, unknown>[] = [];

  beforeEach(async () => {
    stub(
      context.architectApi,
      "getFlowsDatatableRows",
      () =>
        Promise.resolve(
          {
            entities: asGenesysRows(mockRules),
            pageCount: 1,
          } satisfies platformClient.Models.DataTableRowEntityListing,
        ),
    );

    rows = await getDatatableRows(context, "dummy-datatable-id");
  });

  afterEach(() => restore());

  it("returns the expected number of rows", () => {
    assertEquals(rows.length, mockRules.length);
  });

  it("each row key is a string", () => {
    rows.forEach((row, i) => assert(typeof row["key"] === "string", `Row ${i} key should be a string`));
  });

  it("each row key matches format", () => {
    rows.forEach((row, i) => assertMatch(String(row["key"]), /^rule-\d+$/, `Row ${i} key should match pattern`));
  });

  it("each row has required fields with correct types", () => {
    rows.forEach((row, i) => {
      assert(typeof row["action"] === "string", `Row ${i} action should be a string`);
      assert(typeof row["targetName"] === "string", `Row ${i} targetName should be a string`);
      assert(typeof row["priority"] === "number", `Row ${i} priority should be a number`);
      assert(typeof row["enabled"] === "boolean", `Row ${i} enabled should be a boolean`);
    });
  });

  it("each row contains only valid Rule fields", () => {
    const template = mockRules[0];
    assertExists(template);
    const allowedKeys = new Set<keyof Rule>(Object.keys(template) as (keyof Rule)[]);
    rows.forEach((row, i) => {
      for (const key in row) {
        assert(allowedKeys.has(key as keyof Rule), `Row ${i} contains unexpected key '${key}'`);
      }
    });
  });
});

describe("Genesys => Datatables => getDatatableRows() => pagination", () => {
  const context = createMockRoutingContext();

  afterEach(() => restore());

  it("asks for full rows rather than brief ones", async () => {
    const fetched = stub(
      context.architectApi,
      "getFlowsDatatableRows",
      () => Promise.resolve({ entities: [], pageCount: 1 } satisfies platformClient.Models.DataTableRowEntityListing),
    );

    await getDatatableRows(context, "options-datatable-id");

    const call = fetched.calls[0];
    assertExists(call);
    assertEquals(call.args[0], "options-datatable-id");
    assertEquals(call.args[1], { pageSize: 100, pageNumber: 1, showbrief: false });
  });

  it("collects rows from every page, in page order", async () => {
    const fetched = stub(
      context.architectApi,
      "getFlowsDatatableRows",
      (_datatableId: string, opts?: { pageNumber?: number }) =>
        Promise.resolve(
          {
            entities: asGenesysRows(opts?.pageNumber === 1 ? [routeRule] : [replyRule]),
            pageCount: 2,
          } satisfies platformClient.Models.DataTableRowEntityListing,
        ),
    );

    const rows = await getDatatableRows(context, "paged-datatable-id");

    assertEquals(fetched.calls.length, 2);
    assertEquals(rows.map((row) => row["key"]), ["rule-0", "rule-1"]);
  });

  it("returns an empty array for an empty table", async () => {
    stub(
      context.architectApi,
      "getFlowsDatatableRows",
      () => Promise.resolve({ entities: [], pageCount: 1 } satisfies platformClient.Models.DataTableRowEntityListing),
    );

    assertEquals(await getDatatableRows(context, "empty-datatable-id"), []);
  });
});

describe("Genesys => Datatables => getRules()", () => {
  const context = createMockRoutingContext();
  let rules: Rule[] = [];

  beforeEach(async () => {
    stub(
      context.architectApi,
      "getFlowsDatatableRows",
      () =>
        Promise.resolve(
          {
            entities: asGenesysRows(mockRules),
            pageCount: 1,
          } satisfies platformClient.Models.DataTableRowEntityListing,
        ),
    );

    rules = await getRules(context, "predefined-table");
  });

  afterEach(() => restore());

  it("returns all predefined rules", () => {
    assertEquals(rules.length, mockRules.length);
  });

  it("matches expected rule properties", () => {
    rules.forEach((rule, i) => {
      const expected = mockRules[i];
      assertExists(expected);
      assertEquals(rule.key, expected.key);
      assertEquals(rule.action, expected.action);
      assertEquals(rule.enabled, expected.enabled);
    });
  });

  it("has valid types for each Rule field", () => {
    rules.forEach((rule, i) => {
      assert(typeof rule.key === "string", `Rule ${i} key must be string`);
      assert(typeof rule.enabled === "boolean", `Rule ${i} enabled must be boolean`);
      assert(typeof rule.targetName === "string", `Rule ${i} targetName must be string`);
    });
  });
});

describe("Genesys => Datatables => getRules() => pagination", () => {
  const context = createMockRoutingContext();

  afterEach(() => restore());

  it("keeps datatable order across pages, because order is rule order", async () => {
    stub(
      context.architectApi,
      "getFlowsDatatableRows",
      (_datatableId: string, opts?: { pageNumber?: number }) =>
        Promise.resolve(
          {
            entities: asGenesysRows(opts?.pageNumber === 1 ? [routeRule] : [replyRule]),
            pageCount: 2,
          } satisfies platformClient.Models.DataTableRowEntityListing,
        ),
    );

    const rules = await getRules(context, "paged-table");

    assertEquals(rules.map((rule) => rule.key), ["rule-0", "rule-1"]);
    assertEquals(rules.map((rule) => rule.action), [RuleAction.Route, RuleAction.Reply]);
  });

  it("returns an empty array for an empty table", async () => {
    stub(
      context.architectApi,
      "getFlowsDatatableRows",
      () => Promise.resolve({ entities: [], pageCount: 1 } satisfies platformClient.Models.DataTableRowEntityListing),
    );

    assertEquals(await getRules(context, "empty-table"), []);
  });
});
