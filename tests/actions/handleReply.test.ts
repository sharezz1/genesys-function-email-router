import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assertEquals } from "@std/assert";
import { restore, stub } from "@std/testing/mock";
import type platformClient from "purecloud-platform-client-v2";
import { handleReply } from "../../src/actions/handleReply.ts";
import type { RoutingContext } from "../../src/types/RoutingContext.ts";
import { RuleAction } from "../../src/types/RuleAction.ts";
import type { Rule } from "../../src/types/Rule.ts";
import { createMockRoutingContext, createRule } from "../fixtures.ts";

/** The library and response every reply rule in this file names. */
const LIBRARY_NAME = "Auto replies";
const RESPONSE_NAME = "Out of hours";

/** The library Response Management returns for {@linkcode LIBRARY_NAME}. */
function createLibrary(): platformClient.Models.Library {
  return { id: "library-0001", name: LIBRARY_NAME };
}

/** A canned response carrying the supplied texts, or none at all when `texts` is omitted. */
function createResponse(texts?: string[]): platformClient.Models.Response {
  return {
    id: "response-0001",
    name: RESPONSE_NAME,
    libraries: [{ id: "library-0001", name: LIBRARY_NAME }],
    ...(texts === undefined ? {} : { texts: texts.map((content) => ({ content, contentType: "text/plain" })) }),
  };
}

describe("Actions => Reply => handleReply()", () => {
  let context: RoutingContext;

  beforeEach(() => {
    context = createMockRoutingContext();
  });

  afterEach(() => restore());

  /** Stubs both sweeps `getResponseByName` performs. */
  function stubResponseManagement(
    libraries: platformClient.Models.Library[],
    responses: platformClient.Models.Response[],
  ): void {
    stub(
      context.responseManagementApi,
      "getResponsemanagementLibraries",
      () => Promise.resolve({ entities: libraries, pageCount: 1 }),
    );
    stub(
      context.responseManagementApi,
      "getResponsemanagementResponses",
      () => Promise.resolve({ entities: responses, pageCount: 1 }),
    );
  }

  /** A reply rule naming the fixture library and response. */
  function createReplyRule(): Rule {
    return createRule({
      action: RuleAction.Reply,
      responseLibrary: LIBRARY_NAME,
      responseName: RESPONSE_NAME,
    });
  }

  it("resolves a response by name and stages its texts", async () => {
    stubResponseManagement([createLibrary()], [createResponse(["Thanks for your email.", "We will be in touch."])]);

    const { context: updated, result } = await handleReply(context, createReplyRule());

    assertEquals(result.isValid, true);
    assertEquals(result.isMatched, true);
    assertEquals(result.isSuccessful, true);
    assertEquals(result.message, undefined);
    assertEquals(updated.replies, ["Thanks for your email.", "We will be in touch."]);
  });

  it("renders newlines as <br>", async () => {
    stubResponseManagement([createLibrary()], [createResponse(["Line one\nLine two\r\nLine three"])]);

    const { context: updated } = await handleReply(context, createReplyRule());

    assertEquals(updated.replies, ["Line one<br>Line two<br>Line three"]);
  });

  it("appends to the existing replies rather than replacing them", async () => {
    context = createMockRoutingContext({ replies: ["An earlier reply"] });
    stubResponseManagement([createLibrary()], [createResponse(["A later reply"])]);

    const { context: updated } = await handleReply(context, createReplyRule());

    assertEquals(updated.replies, ["An earlier reply", "A later reply"]);
  });

  it("trims the library and response names before resolving", async () => {
    stubResponseManagement([createLibrary()], [createResponse(["Thanks for your email."])]);

    const rule = createRule({
      action: RuleAction.Reply,
      responseLibrary: `  ${LIBRARY_NAME}  `,
      responseName: `  ${RESPONSE_NAME}  `,
    });
    const { context: updated, result } = await handleReply(context, rule);

    assertEquals(result.isSuccessful, true);
    assertEquals(updated.replies, ["Thanks for your email."]);
  });

  it("reports isValid false and stages nothing when the response library is missing", async () => {
    const rule = createRule({ action: RuleAction.Reply, responseName: RESPONSE_NAME });
    const { context: updated, result } = await handleReply(context, rule);

    assertEquals(result.isValid, false);
    assertEquals(result.isMatched, true);
    assertEquals(result.isSuccessful, false);
    assertEquals(result.message, `Invalid response library: "undefined"`);
    assertEquals(updated.replies, []);
  });

  it("reports isValid false and stages nothing when the response library is blank", async () => {
    const rule = createRule({ action: RuleAction.Reply, responseLibrary: "   ", responseName: RESPONSE_NAME });
    const { context: updated, result } = await handleReply(context, rule);

    assertEquals(result.isValid, false);
    assertEquals(result.message, `Invalid response library: "   "`);
    assertEquals(updated.replies, []);
  });

  it("reports isValid false and stages nothing when the response name is missing", async () => {
    const rule = createRule({ action: RuleAction.Reply, responseLibrary: LIBRARY_NAME });
    const { context: updated, result } = await handleReply(context, rule);

    assertEquals(result.isValid, false);
    assertEquals(result.isSuccessful, false);
    assertEquals(result.message, `Invalid response name: "undefined"`);
    assertEquals(updated.replies, []);
  });

  it("reports isValid false and stages nothing when the response name is blank", async () => {
    const rule = createRule({ action: RuleAction.Reply, responseLibrary: LIBRARY_NAME, responseName: "   " });
    const { context: updated, result } = await handleReply(context, rule);

    assertEquals(result.isValid, false);
    assertEquals(result.message, `Invalid response name: "   "`);
    assertEquals(updated.replies, []);
  });

  it("reports isSuccessful false and stages nothing when the response cannot be found", async () => {
    stubResponseManagement([createLibrary()], []);

    const { context: updated, result } = await handleReply(context, createReplyRule());

    assertEquals(result.isValid, true);
    assertEquals(result.isSuccessful, false);
    assertEquals(result.message, `Response with name ${RESPONSE_NAME} not found in library ${LIBRARY_NAME}`);
    assertEquals(updated.replies, []);
  });

  it("stages nothing and does not throw when the response has no texts", async () => {
    stubResponseManagement([createLibrary()], [createResponse()]);

    const { context: updated, result } = await handleReply(context, createReplyRule());

    assertEquals(result.isValid, true);
    assertEquals(result.isSuccessful, true);
    assertEquals(result.message, undefined);
    assertEquals(updated.replies, []);
  });

  it("reports an Error rejection by its message", async () => {
    stub(
      context.responseManagementApi,
      "getResponsemanagementLibraries",
      () => Promise.reject(new Error("Response Management is unavailable")),
    );

    const { context: updated, result } = await handleReply(context, createReplyRule());

    assertEquals(result.isSuccessful, false);
    assertEquals(result.message, "Response Management is unavailable");
    assertEquals(updated.replies, []);
  });

  it("serializes an object rejection rather than rendering it as [object Object]", async () => {
    const failure = { status: 404, code: "not.found" };

    stub(
      context.responseManagementApi,
      "getResponsemanagementLibraries",
      () => Promise.reject(failure),
    );

    const { result } = await handleReply(context, createReplyRule());

    assertEquals(result.isSuccessful, false);
    assertEquals(result.message, JSON.stringify(failure, null, 2));
  });

  it("stringifies a primitive rejection", async () => {
    stub(
      context.responseManagementApi,
      "getResponsemanagementLibraries",
      () => Promise.reject("rate limited"),
    );

    const { result } = await handleReply(context, createReplyRule());

    assertEquals(result.isSuccessful, false);
    assertEquals(result.message, "rate limited");
  });

  it("stringifies a null rejection rather than serializing it", async () => {
    stub(
      context.responseManagementApi,
      "getResponsemanagementLibraries",
      () => Promise.reject(null),
    );

    const { result } = await handleReply(context, createReplyRule());

    assertEquals(result.isSuccessful, false);
    assertEquals(result.message, "null");
  });
});
