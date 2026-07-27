import type { FilterAstKind as Kind } from "./FilterAstKind.ts";
import type { FilterOperator } from "./FilterOperator.ts";
import type { FilterField } from "./FilterField.ts";
import type { FilterComparator } from "./FilterComparator.ts";

/**
 * Represents a parsed filter expression in the form of an abstract syntax tree (AST).
 * The AST consists of either a logical binary expression (AND/OR)
 * or a comparison between a field and one or more values.
 */
export type FilterAst =
  /**
   * A binary operation combining two sub-expressions using a logical operator.
   * Example: `A AND B`
   */
  | {
    kind: Kind.Binary;
    operator: FilterOperator.And | FilterOperator.Or;
    leftExpr: FilterAst;
    rightExpr: FilterAst;
  }
  /**
   * A comparison operation between a field and one or more values using a comparator.
   * Example: `subject ~ "invoice"`
   */
  | {
    kind: Kind.Comparison;
    field: FilterField;
    operator: FilterComparator;
    value: string | number | (string | number)[];
  };
