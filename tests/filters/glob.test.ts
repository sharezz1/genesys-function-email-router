import { assert, assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { globMatch } from "../../src/filters/glob.ts";

describe("Filters => Glob => globMatch()", () => {
  describe("Literals", () => {
    it("matches an identical string", () => {
      assert(globMatch("invoice.pdf", "invoice.pdf"));
    });

    it("requires the whole value to match, not a prefix or a substring", () => {
      assert(!globMatch("invoice.pdf.bak", "invoice.pdf"));
      assert(!globMatch("my invoice.pdf", "invoice.pdf"));
      assert(!globMatch("invoice", "invoice.pdf"));
    });

    it("treats regular-expression punctuation as literal", () => {
      // The whole reason a glob is not a regex: `.` is a dot, `+` is a plus.
      assert(globMatch("total (net) +vat", "total (net) +vat"));
      assert(!globMatch("totalXanetX +vat", "total (net) +vat"));
      assert(globMatch("a.b", "a.b"));
      assert(!globMatch("axb", "a.b"));
    });

    it("matches empty against empty", () => {
      assert(globMatch("", ""));
      assert(!globMatch("x", ""));
      assert(!globMatch("", "x"));
    });
  });

  describe("Wildcards", () => {
    it("expands * to any run of characters, including none", () => {
      assert(globMatch("invoice.pdf", "*.pdf"));
      assert(globMatch(".pdf", "*.pdf"));
      assert(globMatch("anything at all", "*"));
      assert(globMatch("", "*"));
    });

    it("matches ? against exactly one character", () => {
      assert(globMatch("invoice1.pdf", "invoice?.pdf"));
      assert(!globMatch("invoice.pdf", "invoice?.pdf"));
      assert(!globMatch("invoice12.pdf", "invoice?.pdf"));
    });

    it("crosses newlines, so body patterns work on real mail", () => {
      // The previous implementation compiled to an unanchored-to-newline regex, which made every
      // `body * "*word*"` rule silently inert on multi-line messages — that is, on all of them.
      assert(globMatch("hello,\nthis is urgent\nregards", "*urgent*"));
      assert(globMatch("a\nb", "a?b"));
    });

    it("handles several stars", () => {
      assert(globMatch("urgent payment overdue", "*payment*"));
      assert(globMatch("a-b-c-d", "*-*-*"));
      assert(!globMatch("abc", "*-*-*"));
    });

    it("collapses consecutive stars", () => {
      assert(globMatch("abc", "***"));
      assert(globMatch("abc", "a***c"));
      assert(!globMatch("abc", "a***d"));
    });

    it("matches a trailing star against an empty remainder", () => {
      assert(globMatch("invoice", "invoice*"));
      assert(globMatch("invoice", "invoice**"));
    });
  });

  describe("Character classes", () => {
    it("matches one character from a set", () => {
      assert(globMatch("invoice7.pdf", "*[0-9].pdf"));
      assert(!globMatch("invoiceX.pdf", "*[0-9].pdf"));
      assert(globMatch("cat", "[bc]at"));
      assert(!globMatch("hat", "[bc]at"));
    });

    it("supports ranges, and several of them", () => {
      assert(globMatch("a", "[a-z]"));
      assert(!globMatch("1", "[a-z]"));
      assert(globMatch("5", "[a-z0-9]"));
      assert(globMatch("q", "[a-z0-9]"));
      assert(!globMatch("-", "[a-z0-9]"));
    });

    it("negates with a leading caret", () => {
      assert(globMatch("hat", "[^bc]at"));
      assert(!globMatch("bat", "[^bc]at"));
      assert(globMatch("x", "[^0-9]"));
      assert(!globMatch("7", "[^0-9]"));
    });

    it("treats a closing bracket in first position as a literal", () => {
      assert(globMatch("]", "[]]"));
      assert(globMatch("a]b", "a[]]b"));
    });

    it("treats a hyphen at either edge as a literal", () => {
      assert(globMatch("-", "[-a]"));
      assert(globMatch("a", "[-a]"));
      assert(globMatch("-", "[a-]"));
    });

    it("honours escapes inside a class", () => {
      assert(globMatch("]", "[\\]]"));
      assert(globMatch("-", "[a\\-z]"));
      assert(!globMatch("b", "[a\\-z]"));
    });

    it("treats an unclosed bracket as a literal instead of throwing", () => {
      // Previously this built an invalid regular expression and threw from inside the comparison,
      // which reached the rule author as "Filter evaluation error" on a rule that looked fine.
      assert(globMatch("a[b.pdf", "a[b.pdf"));
      assert(globMatch("[", "["));
      assert(!globMatch("x", "[abc"));
    });
  });

  describe("Escapes", () => {
    it("makes an escaped asterisk a literal asterisk", () => {
      // The previous implementation parked `\*` on a NUL byte, but escaped the backslash first, so
      // the sentinel matched the wrong pair: `report\*.pdf` matched `report.pdf` and failed to
      // match `report*.pdf` — precisely inverted.
      assert(globMatch("report*.pdf", "report\\*.pdf"));
      assert(!globMatch("report.pdf", "report\\*.pdf"));
      assert(!globMatch("reportX.pdf", "report\\*.pdf"));
    });

    it("makes an escaped question mark a literal", () => {
      assert(globMatch("what?", "what\\?"));
      assert(!globMatch("whatX", "what\\?"));
    });

    it("makes an escaped bracket a literal", () => {
      assert(globMatch("a[0]b", "a\\[0\\]b"));
    });

    it("makes a doubled backslash a literal backslash", () => {
      assert(globMatch("a\\b", "a\\\\b"));
    });

    it("treats a trailing backslash as a literal backslash", () => {
      assert(globMatch("a\\", "a\\"));
    });
  });

  describe("Bounded work", () => {
    it("answers a pattern that made the previous implementation run for half a minute", () => {
      // `*a*a*a*zzz` against a run of "a" took 26 seconds at 800 characters and grew about 13x per
      // doubling — past the platform's 15-second kill, reachable by anyone who can send mail. If
      // this ever regresses to a backtracking engine, this test stops terminating rather than
      // failing an assertion, which is the loudest signal available.
      assertEquals(globMatch("a".repeat(20_000), "*a*a*a*zzz"), false);
    });

    it("answers an ordinary multi-word pattern against a large body", () => {
      assertEquals(globMatch("urgent payment ".repeat(7_000), "*urgent*payment*overdue*"), false);
    });

    it("still matches correctly at size", () => {
      assert(globMatch("a".repeat(10_000) + "zzz", "*a*a*a*zzz"));
    });
  });
});
