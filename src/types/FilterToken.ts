import type { FilterComparator } from "./FilterComparator.ts";
import type { FilterField } from "./FilterField.ts";
import type { FilterOperator } from "./FilterOperator.ts";
import type { FilterTokenKind } from "./FilterTokenKind.ts";

/**
 * Represents a lexical token produced from a filter expression string.
 * Tokens are the building blocks used to construct the abstract syntax tree (AST).
 */
export type FilterToken =
  /**
   * A field reference token, representing a known filterable property.
   * Example: `from`, `subject`, `attachments`
   */
  | {
    kind: FilterTokenKind.Field;
    value: FilterField;
  }
  /**
   * A string literal token, typically enclosed in quotes.
   * Used as the right-hand value in comparison operations.
   * Example: `"invoice"`
   */
  | {
    kind: FilterTokenKind.String;
    value: string;
  }
  /**
   * A numeric literal token, supporting numeric comparisons.
   * Example: `100`, `42`
   */
  | {
    kind: FilterTokenKind.Number;
    value: number;
  }
  /**
   * A comparison operator token.
   * Example: `=`, `!=`, `~`, `!*`, `∩`
   */
  | {
    kind: FilterTokenKind.Operator;
    value: FilterComparator;
  }
  /**
   * A logical operator token used to combine expressions.
   * Example: `AND`, `OR`
   */
  | {
    kind: FilterTokenKind.Logical;
    value: FilterOperator;
  }
  /**
   * A structural symbol token used for grouping and lists.
   * Example: `(`, `)`, `,`
   */
  | {
    kind: FilterTokenKind.Symbol;
    value: "(" | ")" | ",";
  };
