/**
 * The outcome of evaluating and executing a single rule.
 *
 * Three booleans rather than one, because a rule can fail in three unrelated places and the
 * distinction is the only diagnostic a deployed function produces: {@linkcode ActionResult.isValid}
 * covers the rule's own configuration, {@linkcode ActionResult.isMatched} covers its filter, and
 * {@linkcode ActionResult.isSuccessful} covers the action it ran.
 *
 * Every field is optional-with-`undefined` rather than merely optional: results are assembled from
 * values that may legitimately be absent, and `exactOptionalPropertyTypes` distinguishes the two.
 */
export type ActionResult = Readonly<{
  /** The rule's key, as it appears in the datatable. */
  id: string;

  /** Whether the rule is configured well enough to run — a known action, a usable target. */
  isValid: boolean;

  /** Whether the rule's filter matched this email. A rule with no filter always matches. */
  isMatched: boolean;

  /** Whether the action completed. Only meaningful when the rule was both valid and matched. */
  isSuccessful: boolean;

  /** Human-readable detail: why a rule was skipped, or why its action failed. */
  message?: string | undefined;

  /** The rejection that caused the failure, when there was one. */
  error?: unknown;

  /** Epoch milliseconds at which evaluation of this rule began. */
  startedAt?: number | undefined;

  /** Epoch milliseconds at which evaluation of this rule finished. */
  endedAt?: number | undefined;

  /** Wall-clock milliseconds the rule took, against a function budget of at most 15 seconds. */
  duration?: number | undefined;
}>;
