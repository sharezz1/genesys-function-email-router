import type { FilterAst } from "../types/FilterAst.ts";
import { FilterAstKind } from "../types/FilterAstKind.ts";
import { FilterComparator } from "../types/FilterComparator.ts";
import { FilterField } from "../types/FilterField.ts";
import { FilterOperator } from "../types/FilterOperator.ts";
import type { RoutingContext } from "../types/RoutingContext.ts";
import { compileFilter } from "./compile.ts";
import { globMatch } from "./glob.ts";

/**
 * Evaluates a filter expression against the inbound email.
 *
 * @param context - The routing context carrying the message to match.
 * @param filter - The expression, as written in the rule's `filter` column.
 * @returns Whether the message matches.
 * @throws {SyntaxError} If the expression is malformed.
 */
export function evaluateFilter(context: RoutingContext, filter: string): boolean;

/**
 * Evaluates an already-parsed filter against the inbound email.
 *
 * @param context - The routing context carrying the message to match.
 * @param filter - The parsed expression.
 * @returns Whether the message matches.
 */
export function evaluateFilter(context: RoutingContext, filter: FilterAst): boolean;

/**
 * Evaluates a filter, parsing it first if it arrives as text.
 *
 * Recursion walks the tree directly rather than compiling to a predicate: a rule set is evaluated
 * once per email and then discarded, so there is nothing for a compiled form to amortise against.
 *
 * @param context - The routing context carrying the message to match.
 * @param filter - The expression, either as written or already parsed.
 * @returns Whether the message matches.
 * @throws {SyntaxError} If a text expression is malformed.
 *
 * @example
 * ```ts
 * import type { RoutingContext } from "../types/mod.ts";
 * import { evaluateFilter } from "./evaluate.ts";
 *
 * declare const context: RoutingContext;
 *
 * evaluateFilter(context, 'subject ~ "invoice" AND from !* "*noreply*"');
 * ```
 */
export function evaluateFilter(context: RoutingContext, filter: string | FilterAst): boolean {
  const ast = typeof filter === "string" ? compileFilter(filter) : filter;

  switch (ast.kind) {
    case FilterAstKind.Binary:
      return ast.operator === FilterOperator.And
        ? evaluateFilter(context, ast.leftExpr) && evaluateFilter(context, ast.rightExpr)
        : evaluateFilter(context, ast.leftExpr) || evaluateFilter(context, ast.rightExpr);

    case FilterAstKind.Comparison:
      return compareFieldToValue(
        getFieldFromContext(ast.field, context),
        ast.operator,
        ast.value,
      );
  }
}

/**
 * Reads a filterable field off the message.
 *
 * Every field resolves to a string or a list of strings, never `undefined`: an absent header
 * becomes `""` and an absent list becomes `[]`, so a comparison against a field the message does
 * not carry is a clean non-match rather than a rule that throws.
 *
 * @param field - The field to read.
 * @param context - The routing context carrying the message.
 * @returns The field's value.
 * @throws {Error} If the field is not one the language knows. Unreachable through the parser, which
 * rejects unknown field names while lexing.
 */
function getFieldFromContext(field: FilterField, context: RoutingContext): string | string[] {
  switch (field) {
    case FilterField.From:
      return context.message.from.email ?? "";
    case FilterField.ReplyTo:
      return context.message.replyTo?.email ?? "";
    case FilterField.To:
      return context.message.to?.map((to) => to.email).filter((email) => email !== undefined) ?? [];
    case FilterField.Cc:
      return context.message.cc?.map((cc) => cc.email).filter((email) => email !== undefined) ?? [];
    case FilterField.Bcc:
      return context.message.bcc?.map((bcc) => bcc.email).filter((email) => email !== undefined) ?? [];
    case FilterField.Subject:
      return context.message.subject ?? "";
    case FilterField.Body:
      return context.message.textBody ?? "";
    case FilterField.Attachments:
      return context.message.attachments?.map((attachment) => attachment.name)
        .filter((name) => name !== undefined) ?? [];
    default:
      throw new Error(`Unsupported field: ${field}`);
  }
}

/**
 * Applies a comparator between a field's value and a rule's value.
 *
 * Both sides are normalized to lower-case lists, so a single value and a list are compared the same
 * way and every comparison is case-insensitive. The quantifier differs by comparator: affirmative
 * ones ask whether *any* pair matches, negative ones whether *no* pair does. That is what makes
 * `to != "x"` mean "x is not among the recipients" rather than "some recipient is not x".
 *
 * @param left - The field's value.
 * @param operator - The comparator.
 * @param right - The rule's value, or list of values.
 * @returns Whether the comparison holds.
 */
function compareFieldToValue(
  left: string | number | (string | number)[],
  operator: FilterComparator,
  right: string | number | (string | number)[],
): boolean {
  const toLower = (value: string | number): string => value.toString().toLowerCase();

  const normalizedLeft = (Array.isArray(left) ? left : [left]).map(toLower);
  const normalizedRight = (Array.isArray(right) ? right : [right]).map(toLower);

  switch (operator) {
    case FilterComparator.Equals:
      return normalizedLeft.some((value) => normalizedRight.includes(value));

    case FilterComparator.NotEquals:
      return normalizedLeft.every((value) => !normalizedRight.includes(value));

    case FilterComparator.Contains:
      return normalizedLeft.some((value) => normalizedRight.some((needle) => value.includes(needle)));

    case FilterComparator.NotContains:
      return normalizedLeft.every((value) => normalizedRight.every((needle) => !value.includes(needle)));

    case FilterComparator.GlobMatch:
      return normalizedLeft.some((value) => normalizedRight.some((pattern) => globMatch(value, pattern)));

    case FilterComparator.NotGlobMatch:
      return normalizedLeft.every((value) => normalizedRight.every((pattern) => !globMatch(value, pattern)));

    case FilterComparator.Intersects:
      return normalizedLeft.some((value) => normalizedRight.some((pattern) => globMatch(value, pattern)));

    case FilterComparator.RegexMatch:
      return normalizedLeft.some((value) => normalizedRight.some((pattern) => regexMatch(value, pattern)));
  }
}

/**
 * Tests a value against a regular expression written in a rule.
 *
 * An invalid pattern is a non-match rather than a thrown error, so one malformed rule does not stop
 * the rest of the set from being evaluated. The parse failure is invisible from here, which is why
 * a filter is worth testing before it is armed.
 *
 * Both sides have already been lower-cased by the caller, so the `i` flag is belt and braces.
 *
 * This is the one comparator still backed by `RegExp`, and therefore the one that can still be made
 * to run away: a pattern such as `^(a+)+$` backtracks for tens of seconds on a subject of a few
 * dozen characters, which exceeds the function's entire lifetime. The pattern comes from the rule
 * table and so requires administrator access to write, but the *input* is the inbound mail, so an
 * unlucky pattern is a denial of service anyone can trigger. Bounding it properly means either
 * withdrawing the operator or matching it on an engine that cannot backtrack; truncating the input
 * would not help, because the blow-up does not need a long one.
 */
function regexMatch(value: string, pattern: string): boolean {
  try {
    return new RegExp(pattern, "i").test(value);
  } catch {
    return false;
  }
}
