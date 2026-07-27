import type platformClient from "purecloud-platform-client-v2";
import { afterEach, describe, it } from "@std/testing/bdd";
import { assert, assertEquals, assertExists, assertFalse, assertRejects, assertThrows } from "@std/assert";
import { restore, stub } from "@std/testing/mock";
import type { RoutingContext } from "../../src/types/RoutingContext.ts";
import { forwardEmail, getAttributes, sendEmail, setAttributes } from "../../src/genesys/conversation.ts";
import { CONVERSATION_ID, createMockRoutingContext, createRoute, ROUTE_EMAIL, SENDER_EMAIL } from "../fixtures.ts";

/** The customer participant, which is the one the attribute functions look for. */
function findSender(context: RoutingContext): platformClient.Models.EmailMediaParticipant {
  const participant = context.conversation.participants?.find((candidate) => candidate.address === SENDER_EMAIL);
  assertExists(participant, "the fixture conversation should carry the sender participant");
  return participant;
}

/** A context whose sender participant carries the given attributes, or none at all. */
function createContext(attributes?: Record<string, string>): RoutingContext {
  const context = createMockRoutingContext();
  const participant = findSender(context);

  if (attributes === undefined) {
    delete participant.attributes;
  } else {
    participant.attributes = attributes;
  }

  return context;
}

/** What Genesys returns for a successful agentless send. */
function createSendResponse(): platformClient.Models.AgentlessEmailSendResponseDto {
  return {
    id: "email-0001",
    conversationId: CONVERSATION_ID,
    senderType: "Outbound",
    fromAddress: createRoute(),
    toAddresses: [{ email: "forward@example.com", name: "John Doe" }],
    dateCreated: "2026-01-01T00:00:00.000Z",
  };
}

function generateTests(fetchRemote: boolean): void {
  const label = fetchRemote ? "remote" : "local";

  describe(`Genesys => Conversation => getAttributes() with ${label} fetch`, () => {
    afterEach(() => restore());

    it("returns attributes", async () => {
      const context = createContext({ a: "1", b: "2" });

      if (fetchRemote) {
        stub(context.conversationApi, "getConversationsEmail", () => Promise.resolve(context.conversation));
      }

      const result = await getAttributes(context, fetchRemote);
      assertEquals(result, { a: "1", b: "2" });
    });

    it("throws if participant is not found", async () => {
      const context = createContext();
      context.message.from.email = "other@example.com";

      if (fetchRemote) {
        stub(context.conversationApi, "getConversationsEmail", () => Promise.resolve(context.conversation));
      }

      await assertRejects(
        () => getAttributes(context, fetchRemote),
        Error,
        "External participant not found in the conversation.",
      );
    });

    it("returns empty object if attributes are undefined", async () => {
      const context = createContext(undefined);

      if (fetchRemote) {
        stub(context.conversationApi, "getConversationsEmail", () => Promise.resolve(context.conversation));
      }

      const result = await getAttributes(context, fetchRemote);
      assertEquals(result, {});
    });

    it("reflects updated attributes after mutation", async () => {
      const context = createContext({ original: "yes" });
      findSender(context).attributes = { original: "yes", newKey: "newValue" };

      if (fetchRemote) {
        stub(context.conversationApi, "getConversationsEmail", () => Promise.resolve(context.conversation));
      }

      const result = await getAttributes(context, fetchRemote);
      assertEquals(result, { original: "yes", newKey: "newValue" });
    });
  });
}

generateTests(false);
generateTests(true);

describe("Genesys => Conversation => getAttributes() => edge cases", () => {
  afterEach(() => restore());

  it("reads the conversation from Genesys only when asked to", async () => {
    const context = createContext({ a: "1" });
    const remote = createMockRoutingContext().conversation;
    const sender = remote.participants?.find((candidate) => candidate.address === SENDER_EMAIL);
    assertExists(sender);
    sender.attributes = { a: "2" };

    const fetched = stub(context.conversationApi, "getConversationsEmail", () => Promise.resolve(remote));

    assertEquals(await getAttributes(context, false), { a: "1" });
    assertEquals(fetched.calls.length, 0);

    assertEquals(await getAttributes(context, true), { a: "2" });
    assertEquals(fetched.calls.length, 1);
    const call = fetched.calls[0];
    assertExists(call);
    assertEquals(call.args[0], CONVERSATION_ID);
  });

  it("throws if conversation ID is missing during remote fetch", async () => {
    const context = createContext();
    delete context.conversation.id;

    await assertRejects(
      () => getAttributes(context, true),
      Error,
      "Conversation ID not found",
    );
  });
});

describe("Genesys => Conversation => setAttributes()", () => {
  afterEach(() => restore());

  it("successfully updates and returns merged attributes", async () => {
    const context = createContext({ existing: "yes" });
    const patched = stub(
      context.conversationApi,
      "patchConversationsEmailParticipantAttributes",
      () => Promise.resolve({ attributes: { newKey: "newValue" } }),
    );

    const result = await setAttributes(context, { newKey: "newValue" });
    assertEquals(result, { existing: "yes", newKey: "newValue" });
    assertEquals(findSender(context).attributes, { existing: "yes", newKey: "newValue" });

    const call = patched.calls[0];
    assertExists(call);
    assertEquals(call.args[0], CONVERSATION_ID);
    assertEquals(call.args[1], "participant-customer");
    assertEquals(call.args[2], { attributes: { newKey: "newValue" } });
  });

  it("throws if participant is missing", async () => {
    const context = createContext();
    findSender(context).address = "someoneelse@example.com";

    await assertRejects(
      () => setAttributes(context, { test: "value" }),
      Error,
      "External participant or participant ID not found in the conversation.",
    );
  });

  it("throws if participant ID is missing", async () => {
    const context = createContext();
    delete findSender(context).id;

    await assertRejects(
      () => setAttributes(context, { test: "value" }),
      Error,
      "External participant or participant ID not found in the conversation.",
    );
  });

  it("throws if the conversation has no participants at all", async () => {
    const context = createContext();
    delete context.conversation.participants;

    await assertRejects(
      () => setAttributes(context, { test: "value" }),
      Error,
      "External participant or participant ID not found in the conversation.",
    );
  });

  it("throws if conversation ID is missing", async () => {
    const context = createContext();
    delete context.conversation.id;

    await assertRejects(
      () => setAttributes(context, { test: "value" }),
      Error,
      "Conversation ID not found",
    );
  });

  it("throws if API returns no attributes", async () => {
    const context = createContext();
    stub(
      context.conversationApi,
      "patchConversationsEmailParticipantAttributes",
      () => Promise.resolve({}),
    );

    await assertRejects(
      () => setAttributes(context, { test: "value" }),
      Error,
      "Failed to update participant attributes",
    );
  });
});

describe("Genesys => Conversation => sendEmail()", () => {
  afterEach(() => restore());

  it("calls the agentless email API with correct payload", async () => {
    const context = createMockRoutingContext();
    const response = createSendResponse();

    const stubSend = stub(
      context.conversationApi,
      "postConversationsEmailsAgentless",
      () => Promise.resolve(response),
    );

    const result = await sendEmail(
      context,
      response.fromAddress,
      response.toAddresses,
      "Test Subject",
      "This is a plain text body.",
      "<p>This is an HTML body.</p>",
    );

    assertEquals(result.id, "email-0001");
    assertEquals(result.conversationId, CONVERSATION_ID);
    assertEquals(result.senderType, "Outbound");

    const call = stubSend.calls[0];
    assertExists(call);
    const request = call.args[0];
    assertEquals(request.senderType, "Outbound");
    assertEquals(request.fromAddress, response.fromAddress);
    assertEquals(request.toAddresses, response.toAddresses);
    assertEquals(request.subject, "Test Subject");
    assertEquals(request.textBody, "This is a plain text body.");
    assertEquals(request.htmlBody, "<p>This is an HTML body.</p>");
    assertEquals(request.conversationId, CONVERSATION_ID);
  });

  it("omits the conversation id when the conversation has none", async () => {
    const context = createMockRoutingContext();
    delete context.conversation.id;

    const stubSend = stub(
      context.conversationApi,
      "postConversationsEmailsAgentless",
      () => Promise.resolve(createSendResponse()),
    );

    await sendEmail(context, createRoute(), [{ email: "billing@example.com" }], "Subject", "Body");

    const call = stubSend.calls[0];
    assertExists(call);
    assertFalse(Object.hasOwn(call.args[0], "conversationId"));
  });

  it("omits the HTML body when none is supplied", async () => {
    const context = createMockRoutingContext();

    const stubSend = stub(
      context.conversationApi,
      "postConversationsEmailsAgentless",
      () => Promise.resolve(createSendResponse()),
    );

    await sendEmail(context, createRoute(), [{ email: "billing@example.com" }], "Subject", "Body");

    const call = stubSend.calls[0];
    assertExists(call);
    const request = call.args[0];
    assertFalse(Object.hasOwn(request, "htmlBody"));
    assert(Object.hasOwn(request, "conversationId"));
    assertEquals(request.textBody, "Body");
  });
});

describe("Genesys => Conversation => forwardEmail()", () => {
  afterEach(() => restore());

  it("forwards the email with correct parameters", async () => {
    const context = createMockRoutingContext();
    const response = createSendResponse();

    const stubSend = stub(
      context.conversationApi,
      "postConversationsEmailsAgentless",
      () => Promise.resolve(response),
    );

    const result = await forwardEmail(context, "forward@example.com", "John Doe");

    assertEquals(result.id, "email-0001");

    const call = stubSend.calls[0];
    assertExists(call);
    const request = call.args[0];
    assertEquals(request.toAddresses, [{ email: "forward@example.com", name: "John Doe" }]);
    assertEquals(request.subject, "FW: Invoice 2026-01 attached");
    assertEquals(request.textBody, context.message.textBody);
    assertEquals(request.htmlBody, context.message.htmlBody);
    assertEquals(request.conversationId, CONVERSATION_ID);
  });

  it("sends from the inbound route rather than a fixed address", async () => {
    const context = createMockRoutingContext();

    const stubSend = stub(
      context.conversationApi,
      "postConversationsEmailsAgentless",
      () => Promise.resolve(createSendResponse()),
    );

    await forwardEmail(context, "forward@example.com", "John Doe");

    const call = stubSend.calls[0];
    assertExists(call);
    assertEquals(call.args[0].fromAddress, { email: ROUTE_EMAIL, name: "Support" });
  });

  it("defaults the recipient name to an empty string", async () => {
    const context = createMockRoutingContext();

    const stubSend = stub(
      context.conversationApi,
      "postConversationsEmailsAgentless",
      () => Promise.resolve(createSendResponse()),
    );

    await forwardEmail(context, "forward@example.com");

    const call = stubSend.calls[0];
    assertExists(call);
    assertEquals(call.args[0].toAddresses, [{ email: "forward@example.com", name: "" }]);
  });

  it("throws if conversation ID is missing", () => {
    const context = createMockRoutingContext();
    delete context.conversation.id;

    assertThrows(
      () => forwardEmail(context, "forward@example.com"),
      Error,
      "Conversation ID not found",
    );
  });

  it("throws if message ID is missing", () => {
    const context = createMockRoutingContext();
    delete context.message.id;

    assertThrows(
      () => forwardEmail(context, "forward@example.com"),
      Error,
      "Message ID not found",
    );
  });

  it("throws if the conversation has no workflow participant", () => {
    const context = createMockRoutingContext();
    const participants = context.conversation.participants;
    assertExists(participants);
    context.conversation.participants = participants.filter((candidate) => candidate.purpose !== "workflow");

    assertThrows(
      () => forwardEmail(context, "forward@example.com"),
      Error,
      "Workflow participant not found in the conversation.",
    );
  });
});
