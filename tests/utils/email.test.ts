import { assert, assertEquals, assertExists, assertNotStrictEquals, assertThrows } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import type platformClient from "purecloud-platform-client-v2";
import { getEmailRoute, isValidEmail, substitutePlaceholders } from "../../src/utils/email.ts";
import { CONVERSATION_ID, createConversation, createMessage, createRoute, ROUTE_EMAIL } from "../fixtures.ts";

/** A conversation carrying exactly the participants a case is about. */
function createConversationWith(
  participants: platformClient.Models.EmailMediaParticipant[],
): platformClient.Models.EmailConversation {
  return { id: CONVERSATION_ID, participants };
}

/** A message whose recipients are exactly the ones a case is about. */
function createMessageTo(to: platformClient.Models.EmailAddress[]): platformClient.Models.EmailMessage {
  return { ...createMessage(), to };
}

describe("Utils => Email => getEmailRoute", () => {
  it("should return the route that matches the workflow participant", () => {
    const result = getEmailRoute(createConversation(), createMessage());

    assertEquals(result, createRoute());
  });

  it("should pick the organization's route out of several recipients", () => {
    const message = createMessageTo([
      { email: "someone@customer.com", name: "A Copied Colleague" },
      createRoute(),
      { email: "other@notme.com", name: "Not Me" },
    ]);

    const result = getEmailRoute(createConversation(), message);

    assertEquals(result, createRoute());
  });

  it("should throw if the conversation has no participants", () => {
    const conversation: platformClient.Models.EmailConversation = { id: CONVERSATION_ID };

    assertThrows(
      () => getEmailRoute(conversation, createMessage()),
      Error,
      "Workflow participant not found in the conversation.",
    );
  });

  it("should throw if the workflow participant is not found", () => {
    const conversation = createConversationWith([
      { id: "participant-agent", purpose: "agent", address: "agent@acme.com" },
    ]);

    assertThrows(
      () => getEmailRoute(conversation, createMessage()),
      Error,
      "Workflow participant not found in the conversation.",
    );
  });

  it("should throw if the message has no 'to' addresses", () => {
    assertThrows(
      () => getEmailRoute(createConversation(), createMessageTo([])),
      Error,
      "Route not found in the message 'to' addresses.",
    );
  });

  it("should throw if no 'to' address matches the workflow participant", () => {
    const message = createMessageTo([{ email: "other@notme.com", name: "Not Me" }]);

    assertThrows(
      () => getEmailRoute(createConversation(), message),
      Error,
      "Route not found in the message 'to' addresses.",
    );
  });
});

describe("Utils => Email => isValidEmail", () => {
  it("should return true for a simple valid email", () => {
    assert(isValidEmail("test@example.com"));
  });

  it("should return true for the route address fixture", () => {
    assert(isValidEmail(ROUTE_EMAIL));
  });

  it("should return true for email with dot in local part", () => {
    assert(isValidEmail("john.doe@example.com"));
  });

  it("should return true for email with plus aliasing", () => {
    assert(isValidEmail("user+alias@domain.co.uk"));
  });

  it("should return true for email with numeric domain", () => {
    assert(isValidEmail("admin@123domain.com"));
  });

  it("should return true for subdomain email", () => {
    assert(isValidEmail("support@mail.example.co.uk"));
  });

  it("should return true for email with dashes", () => {
    assert(isValidEmail("first-last@my-site.com"));
  });

  it("should return true for email with uppercase letters", () => {
    assert(isValidEmail("UPPERCASE@DOMAIN.COM"));
  });

  it("should return false if '@' is missing", () => {
    assertEquals(isValidEmail("noatsign.com"), false);
  });

  it("should return false if local part is missing", () => {
    assertEquals(isValidEmail("@example.com"), false);
  });

  it("should return false if domain is missing", () => {
    assertEquals(isValidEmail("user@"), false);
  });

  it("should return false if TLD is missing", () => {
    assertEquals(isValidEmail("user@example"), false);
  });

  it("should return false for domain starting with a dot", () => {
    assertEquals(isValidEmail("user@.example.com"), false);
  });

  it("should return false for local part with spaces", () => {
    assertEquals(isValidEmail("user name@example.com"), false);
  });

  it("should return false for an address surrounded by spaces", () => {
    assertEquals(isValidEmail(" user@example.com "), false);
  });

  it("should return false for double dots in domain", () => {
    assertEquals(isValidEmail("user@example..com"), false);
  });

  it("should return false for double dots in local part", () => {
    assertEquals(isValidEmail("first..last@example.com"), false);
  });

  it("should return false for domain with underscore", () => {
    assertEquals(isValidEmail("user@my_domain.com"), false);
  });

  it("should return false for local part with special characters not allowed", () => {
    assertEquals(isValidEmail("us!er@example.com"), false);
  });

  it("should return false for email with trailing dot", () => {
    assertEquals(isValidEmail("user.@example.com"), false);
  });

  it("should return false for email with leading dot", () => {
    assertEquals(isValidEmail(".user@example.com"), false);
  });

  it("should return false for empty string", () => {
    assertEquals(isValidEmail(""), false);
  });

  it("should return false for null-like input", () => {
    assertEquals(isValidEmail("null"), false);
  });
});

describe("Utils => Email => substitutePlaceholders", () => {
  const baseResponse: platformClient.Models.Response = {
    id: "resp-123",
    name: "Test Response",
    version: 1,
    libraries: [],
    texts: [
      {
        content: "Hello {{AGENT_ALIAS}}, welcome!",
        contentType: "text/plain",
      },
      {
        content: "<p>Thank you, {{AGENT_ALIAS}}. Your ID is {{USER_ID}}.</p>",
        contentType: "text/html",
      },
    ],
    createdBy: { version: 1, id: "user-1", selfUri: "/users/user-1" },
    dateCreated: "2024-01-01T00:00:00Z",
    substitutions: [
      { id: "AGENT_ALIAS" },
      { id: "USER_ID" },
    ],
    selfUri: "/responses/resp-123",
  };

  /** The response with only the fields a case cares about replaced. */
  function createResponse(
    overrides: Partial<platformClient.Models.Response> = {},
  ): platformClient.Models.Response {
    return { ...structuredClone(baseResponse), ...overrides };
  }

  it("replaces placeholders with corresponding attribute values", () => {
    const result = substitutePlaceholders(baseResponse, {
      AGENT_ALIAS: "Alex",
      USER_ID: "12345",
    });

    assertExists(result.texts);
    assertEquals(result.texts[0]?.content, "Hello Alex, welcome!");
    assertEquals(
      result.texts[1]?.content,
      "<p>Thank you, Alex. Your ID is 12345.</p>",
    );
  });

  it("tolerates whitespace inside the placeholder braces", () => {
    const response = createResponse({
      texts: [{ content: "Hello {{ AGENT_ALIAS }}, welcome!", contentType: "text/plain" }],
    });

    const result = substitutePlaceholders(response, { AGENT_ALIAS: "Alex" });

    assertExists(result.texts);
    assertEquals(result.texts[0]?.content, "Hello Alex, welcome!");
  });

  it("leaves an undeclared placeholder alone", () => {
    const response = createResponse({
      texts: [{ content: "Hello {{AGENT_ALIAS}}, ticket {{TICKET_ID}}.", contentType: "text/plain" }],
    });

    const result = substitutePlaceholders(response, { AGENT_ALIAS: "Alex", TICKET_ID: "T-1" });

    assertExists(result.texts);
    assertEquals(result.texts[0]?.content, "Hello Alex, ticket {{TICKET_ID}}.");
  });

  it("leaves placeholders unchanged if attribute is missing", () => {
    const result = substitutePlaceholders(baseResponse, {
      AGENT_ALIAS: "Sam",
    });

    assertExists(result.texts);
    assertEquals(result.texts[0]?.content, "Hello Sam, welcome!");
    assertEquals(
      result.texts[1]?.content,
      "<p>Thank you, Sam. Your ID is {{USER_ID}}.</p>",
    );
  });

  it("returns a new object without mutating the original", () => {
    const clone = structuredClone(baseResponse);

    const result = substitutePlaceholders(baseResponse, { AGENT_ALIAS: "Zoe" });

    assertEquals(baseResponse, clone);
    assertNotStrictEquals(result, baseResponse);
    assertNotStrictEquals(result.texts, baseResponse.texts);
  });

  it("works with no substitutions defined", () => {
    const { substitutions: _substitutions, ...withoutSubstitutions } = baseResponse;
    const response: platformClient.Models.Response = structuredClone(withoutSubstitutions);

    const result = substitutePlaceholders(response, { AGENT_ALIAS: "Jon" });

    assertExists(result.texts);
    assertEquals(result.texts[0]?.content, "Hello {{AGENT_ALIAS}}, welcome!");
  });

  it("works with empty text array", () => {
    const response = createResponse({ texts: [] });

    const result = substitutePlaceholders(response, { AGENT_ALIAS: "Jon" });

    assertEquals(result.texts, []);
  });

  it("works with a response that has no texts", () => {
    const { texts: _texts, ...withoutTexts } = baseResponse;
    const response: platformClient.Models.Response = structuredClone(withoutTexts);

    const result = substitutePlaceholders(response, { AGENT_ALIAS: "Jon" });

    assertEquals(result.texts, []);
  });
});
