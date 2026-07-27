/**
 * Defines the set of comparison operators used in filter expressions.
 * These operators are applied between a field and one or more values.
 */
export enum FilterComparator {
  /**
   * Checks whether the field value is equal to the comparison value.
   * Example: `from = "john@corp.com"`
   */
  Equals = "=",

  /**
   * Checks whether the field value is not equal to the comparison value.
   * Example: `subject != "spam"`
   */
  NotEquals = "!=",

  /**
   * Checks whether the field value contains the comparison value as a substring.
   * Example: `subject ~ "invoice"`
   */
  Contains = "~",

  /**
   * Checks whether the field value does not contain the comparison value.
   * Example: `body !~ "unsubscribe"`
   */
  NotContains = "!~",

  /**
   * Checks whether the field value matches the specified glob pattern.
   * Example: `attachments * "*.pdf"`
   */
  GlobMatch = "*",

  /**
   * Checks whether the field value does not match the specified glob pattern.
   * Example: `from !* "*noreply*"`
   */
  NotGlobMatch = "!*",

  /**
   * Checks whether the field value (as a list) intersects with the comparison list.
   * Example: `to ∩ ("support@corp.com", "finance@corp.com")`
   */
  Intersects = "∩",

  /**
   * Checks whether the field value matches the given regular expression(s).
   * Regex is evaluated case-insensitively and supports full JavaScript syntax.
   * Example: `subject ~= "invoice [0-9]+"`
   */
  RegexMatch = "~=",
}
