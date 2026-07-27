import platformClient from "purecloud-platform-client-v2";
import type { Context } from "aws-lambda";
import type { RoutingContext } from "../src/types/RoutingContext.ts";
import type { Rule } from "../src/types/Rule.ts";
import { RuleAction } from "../src/types/RuleAction.ts";

/**
 * Fixtures are fixed values rather than generated ones.
 *
 * A generator would vary the subject, the addresses and the ids on every run, which is the opposite
 * of what these tests need: a filter test asserting that `subject ~ "invoice"` matches has to know
 * what the subject is. Random fixtures also turn a real bug into an intermittent one — a case
 * sensitivity fault shows up only on the runs where the generator happens to emit an upper-case
 * letter — and an intermittent failure in CI gets retried rather than read.
 */

/** The address the inbound mail arrived at. Present as a `workflow` participant and a recipient. */
export const ROUTE_EMAIL = "support@example.com";

/** The customer's address. */
export const SENDER_EMAIL = "customer@example.net";

/** The conversation id every fixture shares. */
export const CONVERSATION_ID = "conversation-0001";

/** The message id every fixture shares. */
export const MESSAGE_ID = "message-0001";

/** The inbound route, as it appears in the message's recipients. */
export function createRoute(): platformClient.Models.EmailAddress {
  return { email: ROUTE_EMAIL, name: "Support" };
}

/**
 * A conversation carrying the workflow participant the route is identified by, and the customer.
 *
 * Freshly built on every call. Some code under test writes to participant attributes, and a shared
 * object would carry those writes into whatever test ran next — under `--parallel`, unpredictably.
 */
export function createConversation(): platformClient.Models.EmailConversation {
  return {
    id: CONVERSATION_ID,
    participants: [
      { id: "participant-workflow", purpose: "workflow", address: ROUTE_EMAIL },
      { id: "participant-customer", purpose: "customer", address: SENDER_EMAIL, attributes: {} },
    ],
  };
}

/** An inbound message with every filterable field populated. */
export function createMessage(): platformClient.Models.EmailMessage {
  return {
    id: MESSAGE_ID,
    from: { email: SENDER_EMAIL, name: "A Customer" },
    replyTo: { email: "replies@example.net", name: "A Customer" },
    to: [createRoute()],
    cc: [{ email: "finance@example.com", name: "Finance" }],
    bcc: [{ email: "audit@example.com", name: "Audit" }],
    subject: "Invoice 2026-01 attached",
    textBody: "Please find the invoice attached. Thanks.",
    htmlBody: "<p>Please find the invoice attached. Thanks.</p>",
    attachments: [{ attachmentId: "attachment-0001", name: "invoice.pdf", contentType: "application/pdf" }],
  };
}

/**
 * A routing context wired to real API client instances with no credentials.
 *
 * The clients are real so tests can stub individual methods on them and exercise the same call
 * paths production takes; nothing here reaches the network, because every test stubs the method it
 * exercises.
 */
export function createMockRoutingContext(overrides: Partial<RoutingContext> = {}): RoutingContext {
  return {
    conversationApi: new platformClient.ConversationsApi(),
    responseManagementApi: new platformClient.ResponseManagementApi(),
    architectApi: new platformClient.ArchitectApi(),
    conversation: createConversation(),
    message: createMessage(),
    decision: undefined,
    target: undefined,
    skill: undefined,
    priority: undefined,
    replies: [],
    executionLog: [],
    isTestMode: false,
    ...overrides,
  };
}

/** A rule with sane defaults, so a test states only the fields it is about. */
export function createRule(overrides: Partial<Rule> = {}): Rule {
  return {
    key: "rule-0001",
    action: RuleAction.Disconnect,
    enabled: true,
    ...overrides,
  };
}

/**
 * A Lambda context carrying the three credential headers `getCredentials` expects.
 *
 * `getRemainingTimeInMillis` reports the platform ceiling — a Genesys function never has more.
 */
export function createLambdaContext(clientContext?: Record<string, string>): Context {
  return {
    callbackWaitsForEmptyEventLoop: false,
    functionName: "email-router",
    functionVersion: "1",
    invokedFunctionArn: "arn:aws:lambda:us-east-1:000000000000:function:email-router",
    memoryLimitInMB: "1536",
    awsRequestId: "test-request-id",
    logGroupName: "test-log-group",
    logStreamName: "test-log-stream",
    clientContext: (clientContext ?? {
      "X-Genesys-API-Host": "https://api.mypurecloud.com",
      "X-Genesys-API-Key": "client-id-0001",
      "X-Genesys-API-Secret": "client-secret-0001",
    }) as unknown as Context["clientContext"],
    getRemainingTimeInMillis: () => 15_000,
    done: () => {},
    fail: () => {},
    succeed: () => {},
  };
}
