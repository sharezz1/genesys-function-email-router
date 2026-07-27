import { describe, it } from "@std/testing/bdd";
import { assertEquals, assertThrows } from "@std/assert";
import { tokenizeFilter } from "../../src/filters/tokenize.ts";
import { FilterComparator } from "../../src/types/FilterComparator.ts";
import { FilterField } from "../../src/types/FilterField.ts";
import { FilterOperator } from "../../src/types/FilterOperator.ts";
import { FilterTokenKind } from "../../src/types/FilterTokenKind.ts";

describe("Filters => Tokenization => tokenizeFilter", () => {
  // === FIELD TESTS ===
  describe("Field tokens", () => {
    for (const field of Object.values(FilterField)) {
      it(`recognizes field: ${field}`, () => {
        const tokens = [...tokenizeFilter(`${field} = "x"`)];
        assertEquals(tokens[0], { kind: FilterTokenKind.Field, value: field });
      });
    }

    it("recognizes a field written in mixed case", () => {
      const tokens = [...tokenizeFilter(`ReplyTo = "x"`)];
      assertEquals(tokens[0], { kind: FilterTokenKind.Field, value: FilterField.ReplyTo });
    });

    it("throws on unknown field", () => {
      assertThrows(() => [...tokenizeFilter(`notafield = "bad"`)], SyntaxError, 'Unknown field "notafield"');
    });
  });

  // === COMPARISON OPERATOR TESTS ===
  describe("Comparison operator tokens", () => {
    const cases: [string, FilterComparator][] = [
      [`subject = "x"`, FilterComparator.Equals],
      [`subject != "x"`, FilterComparator.NotEquals],
      [`subject ~ "x"`, FilterComparator.Contains],
      [`subject !~ "x"`, FilterComparator.NotContains],
      [`subject * "x"`, FilterComparator.GlobMatch],
      [`subject !* "x"`, FilterComparator.NotGlobMatch],
      [`subject ∩ ("x")`, FilterComparator.Intersects],
      [`subject ~= "x"`, FilterComparator.RegexMatch],
    ];

    for (const [expr, op] of cases) {
      it(`recognizes operator: ${op}`, () => {
        const tokens = [...tokenizeFilter(expr)];
        assertEquals(tokens[1], { kind: FilterTokenKind.Operator, value: op });
      });
    }

    it("prefers the two-character operator over its one-character prefix", () => {
      const tokens = [...tokenizeFilter(`subject ~= "x"`)];
      assertEquals(tokens.length, 3);
      assertEquals(tokens[1], { kind: FilterTokenKind.Operator, value: FilterComparator.RegexMatch });
    });
  });

  // === LOGICAL OPERATOR TESTS ===
  describe("Logical operator tokens", () => {
    it("recognizes logical AND", () => {
      const tokens = [...tokenizeFilter(`subject ~ "x" AND from = "y"`)];
      assertEquals(tokens[3], { kind: FilterTokenKind.Logical, value: FilterOperator.And });
    });

    it("recognizes mixed-case logical OR", () => {
      const tokens = [...tokenizeFilter(`subject ~ "x" oR from = "y"`)];
      assertEquals(tokens[3], { kind: FilterTokenKind.Logical, value: FilterOperator.Or });
    });
  });

  // === STRING TESTS ===
  describe("String literal tokens", () => {
    it("handles double-quoted string", () => {
      const tokens = [...tokenizeFilter(`subject = "invoice"`)];
      assertEquals(tokens[2], { kind: FilterTokenKind.String, value: "invoice" });
    });

    it("handles single-quoted string", () => {
      const tokens = [...tokenizeFilter(`subject = 'welcome'`)];
      assertEquals(tokens[2], { kind: FilterTokenKind.String, value: "welcome" });
    });

    it("handles escaped quotes in double-quoted string", () => {
      const tokens = [...tokenizeFilter(`subject = "He said \\"hello\\""`)];
      assertEquals(tokens[2], { kind: FilterTokenKind.String, value: `He said "hello"` });
    });

    it("handles escaped quote in single-quoted string", () => {
      const tokens = [...tokenizeFilter(`subject = 'don\\'t'`)];
      assertEquals(tokens[2], { kind: FilterTokenKind.String, value: `don't` });
    });

    it("keeps a backslash that does not escape the closing quote", () => {
      const tokens = [...tokenizeFilter(String.raw`attachments * "invoice\*.pdf"`)];
      assertEquals(tokens[2], { kind: FilterTokenKind.String, value: String.raw`invoice\*.pdf` });
    });

    it("does not treat the other quote style as an escape", () => {
      const tokens = [...tokenizeFilter(`subject = "it's here"`)];
      assertEquals(tokens[2], { kind: FilterTokenKind.String, value: "it's here" });
    });

    it("handles an empty string literal", () => {
      const tokens = [...tokenizeFilter(`subject = ""`)];
      assertEquals(tokens[2], { kind: FilterTokenKind.String, value: "" });
    });

    it("throws on unterminated string", () => {
      assertThrows(() => [...tokenizeFilter(`subject = "unterminated`)], SyntaxError, "Unterminated string literal");
    });

    it("throws on a string that ends on a trailing backslash", () => {
      // Ends on a lone backslash, so the escape lookahead reads past the end of the input.
      assertThrows(
        () => [...tokenizeFilter('subject = "unterminated\\')],
        SyntaxError,
        "Unterminated string literal",
      );
    });
  });

  // === NUMBER TESTS ===
  describe("Number tokens", () => {
    it("recognizes a numeric literal", () => {
      const tokens = [...tokenizeFilter(`body = 123`)];
      assertEquals(tokens[2], { kind: FilterTokenKind.Number, value: 123 });
    });

    it("recognizes multiple numeric literals", () => {
      const tokens = [...tokenizeFilter(`body = 123 456`)];
      const numbers = tokens.filter((t) => t.kind === FilterTokenKind.Number).map((t) => t.value);
      assertEquals(numbers, [123, 456]);
    });
  });

  // === SYMBOL TESTS ===
  describe("Symbol tokens", () => {
    it("recognizes parentheses and comma", () => {
      const tokens = [...tokenizeFilter(`to ∩ ("a", "b")`)];
      const symbols = tokens.filter((t) => t.kind === FilterTokenKind.Symbol).map((t) => t.value);
      assertEquals(symbols, ["(", ",", ")"]);
    });
  });

  // === COMPLEX/COMBINED EXPRESSION TESTS ===
  describe("Complex and spacing behavior", () => {
    it("tokenizes complex nested expression", () => {
      const tokens = [...tokenizeFilter(`(from !* "*noreply*") OR subject ~ "invoice" AND attachments * ("a", "b")`)];
      const kinds = tokens.map((t) => t.kind);
      assertEquals(kinds, [
        FilterTokenKind.Symbol,
        FilterTokenKind.Field,
        FilterTokenKind.Operator,
        FilterTokenKind.String,
        FilterTokenKind.Symbol,
        FilterTokenKind.Logical,
        FilterTokenKind.Field,
        FilterTokenKind.Operator,
        FilterTokenKind.String,
        FilterTokenKind.Logical,
        FilterTokenKind.Field,
        FilterTokenKind.Operator,
        FilterTokenKind.Symbol,
        FilterTokenKind.String,
        FilterTokenKind.Symbol,
        FilterTokenKind.String,
        FilterTokenKind.Symbol,
      ]);
    });

    it("handles leading, trailing and excessive whitespace", () => {
      const tokens = [...tokenizeFilter(`   subject    ~   "invoice"   `)];
      assertEquals(tokens.length, 3);
    });

    it("returns empty array for empty input", () => {
      const tokens = [...tokenizeFilter(``)];
      assertEquals(tokens, []);
    });

    it("throws on unexpected character", () => {
      assertThrows(() => [...tokenizeFilter(`subject ~ "invoice"$`)], SyntaxError, "Unexpected character '$'");
    });

    it("reports the position of the unexpected character", () => {
      assertThrows(() => [...tokenizeFilter(`subject ~ !`)], SyntaxError, "Unexpected character '!' at position 10");
    });
  });
});
