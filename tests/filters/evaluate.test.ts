import { describe, it } from "@std/testing/bdd";
import { assert, assertThrows } from "@std/assert";
import type platformClient from "purecloud-platform-client-v2";
import { evaluateFilter } from "../../src/filters/evaluate.ts";
import { FilterAstKind } from "../../src/types/FilterAstKind.ts";
import { FilterComparator } from "../../src/types/FilterComparator.ts";
import type { FilterField } from "../../src/types/FilterField.ts";
import type { RoutingContext } from "../../src/types/RoutingContext.ts";
import { createMessage, createMockRoutingContext, MESSAGE_ID } from "../fixtures.ts";

/** Builds a routing context around a message, so a test states only the fields it is about. */
function contextFor(message: platformClient.Models.EmailMessage): RoutingContext {
  return createMockRoutingContext({ message });
}

/** A message with every optional filterable field absent, to exercise the empty-value fallbacks. */
function sparseMessage(): platformClient.Models.EmailMessage {
  return { id: MESSAGE_ID, from: {}, to: [], textBody: "" };
}

describe("Filters => Evaluation => evaluateFilter()", () => {
  it("matches exact subject with Equals", () => {
    const context = contextFor({ ...createMessage(), subject: "Invoice 12345" });
    assert(evaluateFilter(context, 'subject = "Invoice 12345"'));
  });

  it("does not match incorrect subject with Equals", () => {
    const context = contextFor({ ...createMessage(), subject: "Wrong" });
    assert(!evaluateFilter(context, 'subject = "Invoice 12345"'));
  });

  it("matches partial subject with Contains", () => {
    const context = contextFor({ ...createMessage(), subject: "Invoice 12345" });
    assert(evaluateFilter(context, 'subject ~ "invoice"'));
  });

  it("matches subject with GlobMatch", () => {
    const context = contextFor({ ...createMessage(), subject: "Invoice 12345" });
    assert(evaluateFilter(context, 'subject * "Invoice*"'));
  });

  it("matches body with Regex", () => {
    const context = contextFor({ ...createMessage(), textBody: "Your invoice is ready" });
    assert(evaluateFilter(context, 'body ~= "invoice\\s+is"'));
  });

  it("matches To field with Intersects", () => {
    const context = contextFor({
      ...createMessage(),
      to: [{ email: "a@example.com" }, { email: "cc2@example.com" }],
    });
    assert(evaluateFilter(context, 'to ∩ ("a@example.com", "b@example.com")'));
  });

  it("matches From field with Contains", () => {
    const context = contextFor({ ...createMessage(), from: { email: "customer@example.net" } });
    assert(evaluateFilter(context, 'from ~ "@example.net"'));
  });

  it("matches Attachments field with GlobMatch", () => {
    const context = contextFor({
      ...createMessage(),
      attachments: [{ attachmentId: "attachment-0001", name: "invoice.pdf" }],
    });
    assert(evaluateFilter(context, 'attachments * "*.pdf"'));
  });

  it("matches replyTo field with Equals", () => {
    const context = contextFor({ ...createMessage(), replyTo: { email: "support@example.com" } });
    assert(evaluateFilter(context, 'replyTo = "support@example.com"'));
  });

  it("matches replyTo field with NotEquals", () => {
    const context = contextFor({ ...createMessage(), replyTo: { email: "support@example.com" } });
    assert(!evaluateFilter(context, 'replyTo != "support@example.com"'));
  });

  it("matches replyTo field with Contains", () => {
    const context = contextFor({ ...createMessage(), replyTo: { email: "support-team@example.com" } });
    assert(evaluateFilter(context, 'replyTo ~ "support"'));
  });

  it("matches replyTo field with NotContains", () => {
    const context = contextFor({ ...createMessage(), replyTo: { email: "support-team@example.com" } });
    assert(!evaluateFilter(context, 'replyTo !~ "support"'));
  });

  it("matches replyTo field with GlobMatch", () => {
    const context = contextFor({ ...createMessage(), replyTo: { email: "support@example.com" } });
    assert(evaluateFilter(context, 'replyTo * "support*@example.com"'));
  });

  it("matches replyTo field with NotGlobMatch", () => {
    const context = contextFor({ ...createMessage(), replyTo: { email: "support@example.com" } });
    assert(!evaluateFilter(context, 'replyTo !* "support*@example.com"'));
  });

  it("matches replyTo field with Regex", () => {
    const context = contextFor({ ...createMessage(), replyTo: { email: "support@example.com" } });
    assert(evaluateFilter(context, 'replyTo ~= "support[@.]example"'));
  });

  it("matches Cc field with Intersects", () => {
    const context = contextFor({
      ...createMessage(),
      cc: [{ email: "cc@example.com" }, { email: "cc2@example.com" }],
    });
    assert(evaluateFilter(context, 'cc ∩ ("cc@example.com")'));
  });

  it("matches Bcc field with NotEquals", () => {
    const context = contextFor({ ...createMessage(), bcc: [{ email: "secret@example.com" }] });
    assert(evaluateFilter(context, 'bcc != "other@example.com"'));
  });

  it("evaluates AND logic", () => {
    const context = contextFor({ ...createMessage(), subject: "Urgent", textBody: "Please read this" });
    assert(evaluateFilter(context, 'subject ~ "Urgent" AND body ~ "read"'));
  });

  it("evaluates OR logic", () => {
    const context = contextFor({ ...createMessage(), subject: "Nothing urgent", textBody: "Generic message" });
    assert(evaluateFilter(context, 'subject ~ "Invoice" OR body ~ "Generic"'));
  });

  it("respects precedence with grouping", () => {
    const context = contextFor({ ...createMessage(), subject: "Invoice", textBody: "please see details" });
    assert(
      evaluateFilter(context, '(subject ~ "Invoice" AND body ~ "details") OR from ~ "someone"'),
    );
  });

  it("handles NotContains logic correctly", () => {
    const context = contextFor({ ...createMessage(), subject: "Invoice Ready" });
    assert(!evaluateFilter(context, 'subject !~ "invoice"'));
  });

  it("handles NotGlobMatch logic correctly", () => {
    const context = contextFor({ ...createMessage(), subject: "Ready to Pay" });
    assert(evaluateFilter(context, 'subject !* "Invoice*"'));
  });

  it("matches empty attachments array with NotContains", () => {
    const context = contextFor({ ...createMessage(), attachments: [] });
    assert(evaluateFilter(context, 'attachments !~ "anyfile.pdf"'));
  });

  it("returns false if regex is invalid", () => {
    const context = contextFor({ ...createMessage(), textBody: "data" });
    assert(!evaluateFilter(context, 'body ~= "[unclosed"'));
  });

  it("Equals is case-insensitive", () => {
    const context = contextFor({ ...createMessage(), subject: "Invoice 12345" });
    assert(evaluateFilter(context, 'subject = "invoice 12345"'));
  });

  it("NotEquals is case-insensitive (should fail when only case differs)", () => {
    const context = contextFor({ ...createMessage(), subject: "Invoice 12345" });
    assert(!evaluateFilter(context, 'subject != "invoice 12345"'));
  });

  it("Contains is case-insensitive (upper needle, lower haystack)", () => {
    const context = contextFor({ ...createMessage(), subject: "invoice 12345" });
    assert(evaluateFilter(context, 'subject ~ "INVOICE"'));
  });

  it("NotContains is case-insensitive", () => {
    const context = contextFor({ ...createMessage(), subject: "Invoice Ready" });
    // should be false because 'invoice' is present ignoring case
    assert(!evaluateFilter(context, 'subject !~ "INVOICE"'));
  });

  it("GlobMatch is case-insensitive", () => {
    const context = contextFor({ ...createMessage(), subject: "invoice 12345" });
    assert(evaluateFilter(context, 'subject * "INVOICE*"'));
  });

  it("NotGlobMatch is case-insensitive", () => {
    const context = contextFor({ ...createMessage(), subject: "invoice 12345" });
    // pattern matches ignoring case → NotGlobMatch should be false
    assert(!evaluateFilter(context, 'subject !* "INVOICE*"'));
  });

  it("Intersects is case-insensitive for address lists", () => {
    const context = contextFor({
      ...createMessage(),
      to: [{ email: "A@Example.com" }, { email: "cc2@example.com" }],
    });
    assert(evaluateFilter(context, 'to ∩ ("a@example.com", "b@example.com")'));
  });

  it("RegexMatch is case-insensitive", () => {
    const context = contextFor({ ...createMessage(), textBody: "your INVOICE is ready" });
    // pattern mixed case, body mixed case; 'i' flag should make it pass
    assert(evaluateFilter(context, 'body ~= "Invoice\\s+is"'));
  });

  it("Equals treats numeric vs string numerals as equal (case-insensitive normalization via stringify)", () => {
    const context = contextFor({ ...createMessage(), subject: "12345" });
    assert(evaluateFilter(context, "subject = 12345"));
  });

  // === GLOB TRANSLATION ===
  it('glob "?" matches exactly one character', () => {
    const context = contextFor({
      ...createMessage(),
      attachments: [{ attachmentId: "attachment-0001", name: "invoice1.pdf" }],
    });
    assert(evaluateFilter(context, 'attachments * "invoice?.pdf"'));
    assert(!evaluateFilter(context, 'attachments * "invoice??.pdf"'));
  });

  it("glob escapes regular-expression punctuation so it matches literally", () => {
    const context = contextFor({ ...createMessage(), subject: "total (net) +vat" });
    assert(evaluateFilter(context, 'subject * "total (net) +vat"'));
    assert(!evaluateFilter(context, 'subject * "total anet +vat"'));
  });

  it("glob treats a backslash-escaped asterisk as a literal asterisk", () => {
    const wildcard = contextFor({ ...createMessage(), subject: "invoice 2026 draft" });
    const literal = contextFor({ ...createMessage(), subject: "invoice* draft" });

    assert(!evaluateFilter(wildcard, 'subject * "invoice\\* draft"'));
    assert(evaluateFilter(literal, 'subject * "invoice\\* draft"'));
  });

  it("glob matches a character class", () => {
    const context = contextFor({ ...createMessage(), subject: "invoice7" });

    assert(evaluateFilter(context, 'subject * "invoice[0-9]"'));
    assert(!evaluateFilter(context, 'subject * "invoice[a-z]"'));
  });

  it("glob matches across newlines in a body", () => {
    const context = contextFor({ ...createMessage(), textBody: "Hello,\nthis is urgent\nregards" });

    assert(evaluateFilter(context, 'body * "*urgent*"'));
  });

  // === ABSENT AND PARTIAL FIELDS ===
  it("treats an absent from address as an empty string", () => {
    const context = contextFor(sparseMessage());
    assert(evaluateFilter(context, 'from = ""'));
  });

  it("treats absent replyTo, subject and body as empty strings", () => {
    const context = contextFor(sparseMessage());
    assert(evaluateFilter(context, 'replyTo = "" AND subject = "" AND body = ""'));
  });

  it("treats absent cc, bcc and attachments as empty lists", () => {
    const context = contextFor(sparseMessage());
    // An empty list satisfies every negative comparator and no affirmative one.
    assert(evaluateFilter(context, 'cc != "anyone@example.com"'));
    assert(evaluateFilter(context, 'bcc !~ "anyone"'));
    assert(evaluateFilter(context, 'attachments !* "*.pdf"'));
    assert(!evaluateFilter(context, 'cc ∩ ("anyone@example.com")'));
  });

  it("skips recipients that carry no address", () => {
    const context = contextFor({
      ...createMessage(),
      to: [{ name: "No Address" }, { email: "real@example.com" }],
      cc: [{ name: "No Address" }],
      bcc: [{ name: "No Address" }],
      attachments: [{ attachmentId: "attachment-0002" }],
    });
    assert(evaluateFilter(context, 'to ∩ ("real@example.com")'));
    assert(!evaluateFilter(context, 'cc ∩ ("real@example.com")'));
    assert(!evaluateFilter(context, 'bcc ∩ ("real@example.com")'));
    assert(!evaluateFilter(context, 'attachments * "*.pdf"'));
  });

  // === PRE-PARSED INPUT ===
  it("accepts an already-parsed expression", () => {
    const context = contextFor({ ...createMessage(), subject: "Invoice 12345" });
    assert(evaluateFilter(context, {
      kind: FilterAstKind.Comparison,
      field: "subject" as FilterField,
      operator: FilterComparator.Contains,
      value: "invoice",
    }));
  });

  it("throws on a field the language does not know", () => {
    const context = contextFor(createMessage());
    assertThrows(
      () =>
        evaluateFilter(context, {
          kind: FilterAstKind.Comparison,
          field: "nonsense" as unknown as FilterField,
          operator: FilterComparator.Equals,
          value: "x",
        }),
      Error,
      "Unsupported field: nonsense",
    );
  });
});
