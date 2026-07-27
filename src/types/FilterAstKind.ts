/**
 * Identifies the type of node used in a filter's abstract syntax tree (AST).
 */
export enum FilterAstKind {
  /**
   * A binary expression combining two sub-expressions with a logical operator.
   * Example: `A AND B`
   */
  Binary = "binary",

  /**
   * A comparison expression evaluating a field against one or more values.
   * Example: `subject ~ "invoice"`
   */
  Comparison = "comparison",
}
