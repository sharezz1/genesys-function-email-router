/**
 * Identifies the type of token encountered in a filter expression.
 * Used during lexical analysis to classify parts of the syntax.
 */
export enum FilterTokenKind {
  /**
   * A token representing a field name, such as `subject` or `from`.
   */
  Field = "field",

  /**
   * A token representing a quoted string literal.
   * Example: `"invoice"`
   */
  String = "string",

  /**
   * A token representing a numeric literal.
   * Example: `42`
   */
  Number = "number",

  /**
   * A token representing a comparison operator.
   * Example: `=`, `!=`, `~`
   */
  Operator = "operator",

  /**
   * A token representing a logical operator.
   * Example: `AND`, `OR`
   */
  Logical = "logical",

  /**
   * A token representing a structural symbol.
   * Example: `(`, `)`, `,`
   */
  Symbol = "symbol",
}
