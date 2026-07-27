import { assertEquals, assertExists } from "@std/assert";
import { afterEach, describe, it } from "@std/testing/bdd";
import { restore, stub } from "@std/testing/mock";
import platformClient from "purecloud-platform-client-v2";
import { getContext } from "../../src/routing/context.ts";
import type { FunctionRequest } from "../../src/types/FunctionRequest.ts";
import { CONVERSATION_ID, createConversation, createMessage, MESSAGE_ID } from "../fixtures.ts";

/**
 * The path templates `callApi` is handed, verbatim.
 *
 * Every generated API class funnels through `callApi` with the unsubstituted path and the path
 * parameters alongside it, so these are literal rather than interpolated — and matching on them is
 * exact, which keeps the conversation read from answering the message read.
 */
const CONVERSATION_PATH = "/api/v2/conversations/emails/{conversationId}";
const MESSAGE_PATH = "/api/v2/conversations/emails/{conversationId}/messages/{messageId}";

const client = platformClient.ApiClient.instance;

const baseRequest: FunctionRequest = {
  datatableId: "datatable-0001",
  conversationId: CONVERSATION_ID,
  messageId: MESSAGE_ID,
};

/**
 * Answers the two Platform API reads `getContext` performs.
 *
 * `callApi` is the one seam the SDK offers below the generated API classes: stubbing it leaves the
 * request building in place, so the test exercises the same call path production takes.
 */
function stubEmailReads(): void {
  stub(client, "callApi", (path: string): Promise<unknown> => {
    switch (path) {
      case CONVERSATION_PATH:
        return Promise.resolve(createConversation());
      case MESSAGE_PATH:
        return Promise.resolve(createMessage());
      default:
        return Promise.reject(new Error(`Unexpected Platform API call: ${path}`));
    }
  });
}

describe("Routing => Context => getContext()", () => {
  afterEach(() => restore());

  it("fetches and includes the conversation in context", async () => {
    stubEmailReads();

    const context = await getContext(baseRequest, client);
    assertExists(context.conversation);
    assertEquals(context.conversation.id, CONVERSATION_ID);
  });

  it("fetches and includes the email message in context", async () => {
    stubEmailReads();

    const context = await getContext(baseRequest, client);
    assertExists(context.message);
    assertEquals(context.message.id, MESSAGE_ID);
    assertEquals(context.message.subject, createMessage().subject);
  });

  it("includes API clients in the context", async () => {
    stubEmailReads();

    const context = await getContext(baseRequest, client);
    assertExists(context.architectApi);
    assertExists(context.responseManagementApi);
    assertExists(context.conversationApi);
  });

  it("starts priority at 0", async () => {
    stubEmailReads();

    const context = await getContext(baseRequest, client);

    // Zero rather than absent: the increase and decrease actions add to whatever is already there,
    // and a run where no priority rule matched should still report a number to the calling flow.
    assertEquals(context.priority, 0);
  });

  it("starts replies empty", async () => {
    stubEmailReads();

    const context = await getContext(baseRequest, client);
    assertEquals(context.replies, []);
  });

  it("defaults isTestMode to false when the request omits it", async () => {
    stubEmailReads();

    const context = await getContext(baseRequest, client);

    // Absent must mean armed. Defaulting the other way would let a request that forgot the flag
    // silently suppress every side effect the rule set exists to perform.
    assertEquals(context.isTestMode, false);
  });

  it("honours isTestMode when the request sets it", async () => {
    stubEmailReads();

    const context = await getContext({ ...baseRequest, isTestMode: true }, client);
    assertEquals(context.isTestMode, true);
  });
});
