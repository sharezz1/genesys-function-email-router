/**
 * Defines logical operators used to combine multiple filter conditions.
 */
export enum FilterOperator {
  /**
   * Logical AND operator. All combined conditions must evaluate to true.
   * Example: `from !* "*noreply*" AND subject ~ "invoice"`
   */
  And = "AND",

  /**
   * Logical OR operator. At least one of the combined conditions must be true.
   * Example: `subject ~ "invoice" OR attachments * "*.zip"`
   */
  Or = "OR",
}
