import { assertEquals, assertExists } from "@std/assert";
import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { restore, stub } from "@std/testing/mock";
import platformClient from "purecloud-platform-client-v2";
import type { Context } from "aws-lambda";
import { handler } from "../src/mod.ts";
import { clearTokenCache } from "../src/genesys/client.ts";
import type { FunctionRequest } from "../src/types/FunctionRequest.ts";
import type { FunctionResponse } from "../src/types/FunctionResponse.ts";
import type { Rule } from "../src/types/Rule.ts";
import { RoutingDecision } from "../src/types/RoutingDecision.ts";
import { RuleAction } from "../src/types/RuleAction.ts";
import { RuleTarget } from "../src/types/RuleTarget.ts";
import { CONVERSATION_ID, createConversation, createLambdaContext, createMessage, MESSAGE_ID } from "./fixtures.ts";

/**
 * The budget this function must finish within.
 *
 * Set this to the timeout configured on your data action. Genesys permits 1–15 seconds and stops
 * a function that exceeds it, so a handler that outgrows this number fails in production rather
 * than here — which is the failure this test exists to bring forward in time.
 */
const ACTION_TIMEOUT_MS = 15_000;

/**
 * Share of the budget the handler may consume before this test fails.
 *
 * Well under 1.0 on purpose. This runs against stubs on a warm machine, while production adds a
 * cold start, TLS handshakes, and a live Genesys round trip per API call. Passing at 90% here
 * would still time out there.
 */
const BUDGET_FRACTION = 0.5;

/** A day, the lifetime a real Genesys client-credentials token is issued with. */
const ONE_DAY_MS = 86_400_000;

/**
 * The path templates `callApi` is handed, verbatim.
 *
 * Every generated API class funnels through `callApi` with the unsubstituted path and the path
 * parameters alongside it, so matching on these is exact rather than a prefix test — which matters
 * here, because the conversation path is a prefix of the message path.
 */
const CONVERSATION_PATH = "/api/v2/conversations/emails/{conversationId}";
const MESSAGE_PATH = "/api/v2/conversations/emails/{conversationId}/messages/{messageId}";
const ROWS_PATH = "/api/v2/flows/datatables/{datatableId}/rows";
const LIBRARIES_PATH = "/api/v2/responsemanagement/libraries";
const RESPONSES_PATH = "/api/v2/responsemanagement/responses";

/** The Response Management library and canned response the reply rules below name. */
const LIBRARY_NAME = "Auto replies";
const RESPONSE_NAME = "Acknowledgement";
const RESPONSE_TEXT = "Thanks for writing.";

const DATATABLE_ID = "datatable-0001";

const baseRequest: FunctionRequest = {
  datatableId: DATATABLE_ID,
  conversationId: CONVERSATION_ID,
  messageId: MESSAGE_ID,
};

/**
 * Invokes the handler and drops the `void` the AWS `Handler` type permits.
 *
 * `Handler` also covers callback-style handlers, so its return type is `void | Promise<TResult>`.
 * `src/mod.ts` is an async function that always resolves with a response, and re-establishing that
 * in every case would say nothing about the function.
 */
function invoke(request: FunctionRequest = baseRequest, context: Context = createLambdaContext()): Promise<
  FunctionResponse
> {
  return Promise.resolve(handler(request, context, () => {})) as Promise<FunctionResponse>;
}

/**
 * Stands in for Genesys for one whole invocation: the grant, the two email reads, the rule table,
 * and Response Management.
 *
 * `getClient` builds its own {@linkcode platformClient.ApiClientClass} and `getContext` builds its
 * own API classes on top of it, so there is no instance for a test to reach — the prototype is the
 * only seam, and `callApi` is the one point every generated API class passes through.
 *
 * @param rules - The rows the Architect datatable answers with, in evaluation order.
 * @returns The paths called, in order, so a test can assert what the run actually touched.
 */
function stubPlatform(rules: readonly Rule[]): string[] {
  const paths: string[] = [];

  stub(platformClient.ApiClientClass.prototype, "loginClientCredentialsGrant", () => {
    const expiry = Date.now() + ONE_DAY_MS;

    return Promise.resolve({
      accessToken: "access-token-0001",
      tokenExpiryTime: expiry,
      tokenExpiryTimeString: new Date(expiry).toISOString(),
    });
  });

  stub(platformClient.ApiClientClass.prototype, "callApi", (path: string): Promise<unknown> => {
    paths.push(path);

    switch (path) {
      case CONVERSATION_PATH:
        return Promise.resolve(createConversation());
      case MESSAGE_PATH:
        return Promise.resolve(createMessage());
      case ROWS_PATH:
        return Promise.resolve({ entities: rules, pageCount: 1 });
      case LIBRARIES_PATH:
        return Promise.resolve({ entities: [{ id: "library-0001", name: LIBRARY_NAME }], pageCount: 1 });
      case RESPONSES_PATH:
        return Promise.resolve({
          entities: [{ id: "response-0001", name: RESPONSE_NAME, texts: [{ content: RESPONSE_TEXT }] }],
          pageCount: 1,
        });
      default:
        return Promise.reject(new Error(`Unexpected Platform API call: ${path}`));
    }
  });

  return paths;
}

/** The keys of the rules that were actually considered, in order. */
function consideredKeys(response: FunctionResponse): string[] {
  return (response.executionLog ?? []).map((entry) => entry.id);
}

/** A datatable row for a non-routing action, carrying the columns that action reads. */
function createRuleRow(key: string, action: RuleAction, overrides: Partial<Rule> = {}): Rule {
  return { key, action, enabled: true, ...overrides };
}

/** A rule that sends the interaction to a queue, which is terminal. */
function routeToQueue(key: string, queue: string, overrides: Partial<Rule> = {}): Rule {
  return createRuleRow(key, RuleAction.Route, {
    targetType: RuleTarget.Queue,
    targetName: queue,
    ...overrides,
  });
}

describe("Router => Handler => handler()", () => {
  // The token cache is module scope and outlives a test, exactly as it outlives an invocation on a
  // warm container. Every case starts cold, or it would pass alone and fail in a suite.
  beforeEach(() => clearTokenCache());

  afterEach(() => {
    restore();
    clearTokenCache();
  });

  it("reads the rule table and reports the decision the matching rule produced", async () => {
    const paths = stubPlatform([
      routeToQueue("rule-billing", "Billing", { filter: 'subject ~ "invoice"', skill: "invoicing" }),
    ]);

    const response = await invoke();

    assertEquals(response.decision, RoutingDecision.TransferToQueue);
    assertEquals(response.target, "Billing");
    assertEquals(response.skill, "invoicing");
    assertEquals(response.replies, []);
    assertEquals(consideredKeys(response), ["rule-billing"]);

    const entry = (response.executionLog ?? [])[0];
    assertExists(entry);
    assertEquals(entry.isValid, true);
    assertEquals(entry.isMatched, true);
    assertEquals(entry.isSuccessful, true);

    // The conversation and the message are read before any rule can be evaluated, and the table is
    // read once. Anything else would be a round trip the 15-second budget did not need to spend.
    assertEquals(paths, [CONVERSATION_PATH, MESSAGE_PATH, ROWS_PATH]);
  });

  it("stops at the first rule producing a terminal decision", async () => {
    stubPlatform([
      routeToQueue("rule-first", "Billing"),
      createRuleRow("rule-later", RuleAction.PrioritySet, { priority: 9 }),
    ]);

    const response = await invoke();

    assertEquals(response.decision, RoutingDecision.TransferToQueue);
    assertEquals(response.target, "Billing");

    // Absence from the trail is the assertion: a rule that never ran left no entry, and the
    // priority the later rule would have set never landed.
    assertEquals(consideredKeys(response), ["rule-first"]);
    assertEquals(response.priority, 0);
  });

  it("accumulates the non-terminal rules that precede the routing rule", async () => {
    stubPlatform([
      createRuleRow("rule-urgent", RuleAction.PriorityIncrease, { priority: 3 }),
      createRuleRow("rule-ack", RuleAction.Reply, {
        responseLibrary: LIBRARY_NAME,
        responseName: RESPONSE_NAME,
      }),
      routeToQueue("rule-support", "Support"),
    ]);

    const response = await invoke();

    assertEquals(response.decision, RoutingDecision.TransferToQueue);
    assertEquals(response.target, "Support");
    assertEquals(response.priority, 3);
    assertEquals(response.replies, [RESPONSE_TEXT]);
    assertEquals(consideredKeys(response), ["rule-urgent", "rule-ack", "rule-support"]);
  });

  it("returns decision none for an empty rule table", async () => {
    stubPlatform([]);

    const response = await invoke();

    // A table with nothing to say is a successful run, not a failure: the flow simply continues on
    // its default path.
    assertEquals(response.decision, RoutingDecision.None);
    assertEquals(response.target, undefined);
    assertEquals(response.skill, undefined);
    assertEquals(response.priority, 0);
    assertEquals(response.replies, []);
    assertEquals(consideredKeys(response), []);
  });

  it("returns decision none when no rule matches, having considered them all", async () => {
    stubPlatform([
      routeToQueue("rule-disabled", "Billing", { enabled: false }),
      routeToQueue("rule-unmatched", "Escalations", { filter: 'subject ~ "refund"' }),
    ]);

    const response = await invoke();

    assertEquals(response.decision, RoutingDecision.None);
    assertEquals(consideredKeys(response), ["rule-disabled", "rule-unmatched"]);

    const [skipped, unmatched] = response.executionLog ?? [];
    assertExists(skipped);
    assertExists(unmatched);
    assertEquals(skipped.message, "Rule is disabled.");
    assertEquals(unmatched.message, "Filter did not match");
  });

  it("passes isTestMode through to the rules it evaluates", async () => {
    const paths = stubPlatform([routeToQueue("rule-dry-run", "Billing")]);

    const response = await invoke({ ...baseRequest, isTestMode: true });

    // A dry run still reports the decision; what it must not do is send anything. Nothing outbound
    // appears among the calls made.
    assertEquals(response.decision, RoutingDecision.TransferToQueue);
    assertEquals(paths, [CONVERSATION_PATH, MESSAGE_PATH, ROWS_PATH]);
  });
});

describe("Router => Handler => handler() => timing", () => {
  beforeEach(() => clearTokenCache());

  afterEach(() => {
    restore();
    clearTokenCache();
  });

  it("finishes well inside the action timeout", async () => {
    stubPlatform([
      createRuleRow("rule-urgent", RuleAction.PriorityIncrease, { priority: 3 }),
      createRuleRow("rule-ack", RuleAction.Reply, {
        responseLibrary: LIBRARY_NAME,
        responseName: RESPONSE_NAME,
      }),
      routeToQueue("rule-support", "Support", { filter: 'subject ~ "invoice"' }),
    ]);

    const started = performance.now();
    await invoke();
    const elapsedMs = performance.now() - started;

    const ceilingMs = ACTION_TIMEOUT_MS * BUDGET_FRACTION;

    assertEquals(
      elapsedMs < ceilingMs,
      true,
      `Handler took ${elapsedMs.toFixed(0)}ms of a ${ACTION_TIMEOUT_MS}ms budget, past the ` +
        `${ceilingMs}ms mark this test allows. Genesys stops a function that exceeds its action ` +
        `timeout, and production adds a cold start and live API round trips on top of whatever ` +
        `this measures. Do less work, or raise the action timeout and ACTION_TIMEOUT_MS together.`,
    );
  });
});
