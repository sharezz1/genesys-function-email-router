import { describe, it } from "@std/testing/bdd";
import { compileFilter } from "../../src/filters/compile.ts";
import type { FilterAst } from "../../src/types/FilterAst.ts";
import { FilterAstKind } from "../../src/types/FilterAstKind.ts";
import { FilterComparator } from "../../src/types/FilterComparator.ts";
import { FilterField } from "../../src/types/FilterField.ts";
import { FilterOperator } from "../../src/types/FilterOperator.ts";
import { assert } from "@std/assert/assert";
import { assertEquals } from "@std/assert/equals";
import { assertThrows } from "@std/assert/throws";

function isComparison(ast: FilterAst): ast is Extract<FilterAst, { kind: FilterAstKind.Comparison }> {
  return ast.kind === FilterAstKind.Comparison;
}

function isBinary(ast: FilterAst): ast is Extract<FilterAst, { kind: FilterAstKind.Binary }> {
  return ast.kind === FilterAstKind.Binary;
}

describe("Filters => AST Compilation => compileFilter", () => {
  describe("Basic Comparison Expressions", () => {
    it("parses field ~ string", () => {
      const ast = compileFilter(`subject ~ "invoice"`);
      assert(isComparison(ast));
      assertEquals(ast.field, FilterField.Subject);
      assertEquals(ast.operator, FilterComparator.Contains);
      assertEquals(ast.value, "invoice");
    });

    it("parses field = number", () => {
      const ast = compileFilter(`body = 42`);
      assert(isComparison(ast));
      assertEquals(ast.field, FilterField.Body);
      assertEquals(ast.operator, FilterComparator.Equals);
      assertEquals(ast.value, 42);
    });

    it("parses field ∩ string list", () => {
      const ast = compileFilter(`to ∩ ("a", "b")`);
      assert(isComparison(ast));
      assertEquals(ast.field, FilterField.To);
      assertEquals(ast.operator, FilterComparator.Intersects);
      assertEquals(ast.value, ["a", "b"]);
    });

    it("parses field ∩ mixed-type list", () => {
      const ast = compileFilter(`to ∩ ("a", 1, "b", 2)`);
      assert(isComparison(ast));
      assertEquals(ast.value, ["a", 1, "b", 2]);
    });

    it("parses replyTo field", () => {
      const ast = compileFilter('replyTo = "support@example.com"');
      assert(isComparison(ast));
      assertEquals(ast.field, FilterField.ReplyTo);
      assertEquals(ast.operator, FilterComparator.Equals);
      assertEquals(ast.value, "support@example.com");
    });
  });

  describe("All FilterComparator variants", () => {
    it("parses = operator", () => {
      const ast = compileFilter(`from = "x"`);
      assert(isComparison(ast));
      assertEquals(ast.operator, FilterComparator.Equals);
    });

    it("parses != operator", () => {
      const ast = compileFilter(`subject != "x"`);
      assert(isComparison(ast));
      assertEquals(ast.operator, FilterComparator.NotEquals);
    });

    it("parses ~ operator", () => {
      const ast = compileFilter(`subject ~ "x"`);
      assert(isComparison(ast));
      assertEquals(ast.operator, FilterComparator.Contains);
    });

    it("parses !~ operator", () => {
      const ast = compileFilter(`subject !~ "x"`);
      assert(isComparison(ast));
      assertEquals(ast.operator, FilterComparator.NotContains);
    });

    it("parses * operator", () => {
      const ast = compileFilter(`attachments * "*.pdf"`);
      assert(isComparison(ast));
      assertEquals(ast.operator, FilterComparator.GlobMatch);
    });

    it("parses !* operator", () => {
      const ast = compileFilter(`from !* "*noreply*"`);
      assert(isComparison(ast));
      assertEquals(ast.operator, FilterComparator.NotGlobMatch);
    });

    it("parses ∩ operator", () => {
      const ast = compileFilter(`to ∩ ("a")`);
      assert(isComparison(ast));
      assertEquals(ast.operator, FilterComparator.Intersects);
    });

    it("parses ~= regex operator", () => {
      const ast = compileFilter(`subject ~= "x[0-9]+"`);
      assert(isComparison(ast));
      assertEquals(ast.operator, FilterComparator.RegexMatch);
    });
  });

  describe("Value lists", () => {
    it("parses a single-element list", () => {
      const ast = compileFilter(`to ∩ ("a")`);
      assert(isComparison(ast));
      assertEquals(ast.value, ["a"]);
    });

    it("parses a list of numbers", () => {
      const ast = compileFilter(`subject ∩ (1, 2, 3)`);
      assert(isComparison(ast));
      assertEquals(ast.value, [1, 2, 3]);
    });

    it("tolerates a trailing comma inside a list", () => {
      const ast = compileFilter(`to ∩ ("a", "b",)`);
      assert(isComparison(ast));
      assertEquals(ast.value, ["a", "b"]);
    });

    it("parses a list whose elements are separated only by whitespace", () => {
      const ast = compileFilter(`to ∩ ("a" "b")`);
      assert(isComparison(ast));
      assertEquals(ast.value, ["a", "b"]);
    });

    it("throws on end of input inside a list", () => {
      assertThrows(() => compileFilter(`to ∩ ("a",`), SyntaxError, "Unexpected end of input");
    });
  });

  describe("Logical Combinations", () => {
    it("parses AND expression", () => {
      const ast = compileFilter(`subject ~ "invoice" AND body ~ "attached"`);
      assert(isBinary(ast));
      assertEquals(ast.operator, FilterOperator.And);
      assertEquals(ast.leftExpr.kind, FilterAstKind.Comparison);
      assertEquals(ast.rightExpr.kind, FilterAstKind.Comparison);
    });

    it("parses OR expression", () => {
      const ast = compileFilter(`from = "a" OR to ∩ ("b")`);
      assert(isBinary(ast));
      assertEquals(ast.operator, FilterOperator.Or);
      assertEquals(ast.leftExpr.kind, FilterAstKind.Comparison);
      assertEquals(ast.rightExpr.kind, FilterAstKind.Comparison);
    });

    it("respects AND before OR", () => {
      const ast = compileFilter(`subject ~ "x" AND body ~ "y" OR from ~ "z"`);
      assert(isBinary(ast));
      assertEquals(ast.operator, FilterOperator.Or);
      assertEquals(ast.leftExpr.kind, FilterAstKind.Binary);
      assertEquals(ast.rightExpr.kind, FilterAstKind.Comparison);
    });

    it("parses nested binary expression", () => {
      const ast = compileFilter(`from = "a" AND (to = "b" OR (subject = "c" AND body = "d"))`);
      assert(isBinary(ast));
      assertEquals(ast.operator, FilterOperator.And);
      assertEquals(ast.leftExpr.kind, FilterAstKind.Comparison);
      assertEquals(ast.rightExpr.kind, FilterAstKind.Binary);
    });

    it("chains repeated AND operands to the left", () => {
      const ast = compileFilter(`subject ~ "a" AND body ~ "b" AND from ~ "c"`);
      assert(isBinary(ast));
      assertEquals(ast.operator, FilterOperator.And);
      assertEquals(ast.leftExpr.kind, FilterAstKind.Binary);
      assertEquals(ast.rightExpr.kind, FilterAstKind.Comparison);
    });

    it("chains repeated OR operands to the left", () => {
      const ast = compileFilter(`subject ~ "a" OR body ~ "b" OR from ~ "c"`);
      assert(isBinary(ast));
      assertEquals(ast.operator, FilterOperator.Or);
      assertEquals(ast.leftExpr.kind, FilterAstKind.Binary);
      assertEquals(ast.rightExpr.kind, FilterAstKind.Comparison);
    });
  });

  describe("Parentheses & Grouping", () => {
    it("groups AND inside OR via parentheses", () => {
      const ast = compileFilter(`(subject ~ "invoice" AND body ~ "attached") OR from !* "*noreply*"`);
      assert(isBinary(ast));
      assertEquals(ast.operator, FilterOperator.Or);
      assertEquals(ast.leftExpr.kind, FilterAstKind.Binary);
      assertEquals(ast.rightExpr.kind, FilterAstKind.Comparison);
    });

    it("parses redundant parentheses", () => {
      const ast = compileFilter(`((subject ~ "x"))`);
      assertEquals(ast.kind, FilterAstKind.Comparison);
      assert(isComparison(ast));
      assertEquals(ast.field, FilterField.Subject);
    });

    it("parses deeply nested parentheses", () => {
      const ast = compileFilter(`(((((subject ~ "x")))))`);
      assert(isComparison(ast));
      assertEquals(ast.field, FilterField.Subject);
      assertEquals(ast.value, "x");
    });

    it("throws on unbalanced left parenthesis", () => {
      assertThrows(() => compileFilter(`(from = "a"`), SyntaxError);
    });

    it("throws on unbalanced right parenthesis", () => {
      assertThrows(() => compileFilter(`from = "a")`), SyntaxError);
    });

    it("throws when a group is closed by a symbol other than a right parenthesis", () => {
      // A comma is a symbol too. The parser must demand ")" specifically, not merely "some symbol".
      assertThrows(() => compileFilter(`(subject ~ "a" ,`), SyntaxError, 'Expected ")"');
    });
  });

  describe("Syntax Error Handling", () => {
    it("throws on empty input", () => {
      assertThrows(() => compileFilter(``), SyntaxError, "Filter parse error at token #0");
    });

    it("throws on whitespace-only input", () => {
      assertThrows(() => compileFilter(`   `), SyntaxError, "Filter parse error at token #0");
    });

    it("throws on missing value", () => {
      assertThrows(() => compileFilter(`subject ~`), SyntaxError);
    });

    it("throws on missing field", () => {
      assertThrows(() => compileFilter(`~ "value"`), SyntaxError);
    });

    it("throws on missing operator", () => {
      assertThrows(() => compileFilter(`subject "value"`), SyntaxError, "Expected token of kind operator");
    });

    it("throws on trailing AND operator", () => {
      assertThrows(() => compileFilter(`subject ~ "invoice" AND`), SyntaxError);
    });

    it("throws on unexpected trailing token", () => {
      assertThrows(() => compileFilter(`subject = "x" !`), SyntaxError);
    });

    it("throws on trailing tokens after a complete expression", () => {
      assertThrows(() => compileFilter(`subject = "x" body = "y"`), SyntaxError, "Unexpected trailing tokens");
    });

    it("throws on empty value list", () => {
      assertThrows(() => compileFilter(`to ∩ ()`), SyntaxError, "Expected a string or number literal");
    });
  });
});
