import type { FilterAst } from "../types/FilterAst.ts";
import { FilterAstKind } from "../types/FilterAstKind.ts";
import { FilterOperator } from "../types/FilterOperator.ts";
import type { FilterToken } from "../types/FilterToken.ts";
import { FilterTokenKind } from "../types/FilterTokenKind.ts";
import { tokenizeFilter } from "./tokenize.ts";

/**
 * A single parse in progress.
 *
 * The cursor lives here rather than at module scope. Lambda reuses a warm container, so module
 * state outlives an invocation: a parse that threw part-way would leave the cursor mid-expression
 * for whatever ran next, and the failure would surface as an unrelated rule failing to compile.
 * Scoping the state to one call removes the possibility rather than relying on every path to reset
 * it.
 */
type ParseState = {
  readonly tokens: readonly FilterToken[];
  position: number;
};

/** Reports the token under the cursor, or `undefined` at the end of the stream. */
function peek(state: ParseState): FilterToken | undefined {
  return state.tokens[state.position];
}

/** Reports whether the cursor sits on a token of the given kind, and optionally of a given value. */
function isNext(state: ParseState, kind: FilterTokenKind, value?: unknown): boolean {
  const token = peek(state);

  if (token?.kind !== kind) {
    return false;
  }

  return value === undefined || token.value === value;
}

/** Builds a parse error naming the position, which is the only locator a rule author gets. */
function syntaxError(state: ParseState, message: string): SyntaxError {
  return new SyntaxError(`Filter parse error at token #${state.position}: ${message}`);
}

/** Advances past the current token and returns it. */
function consume(state: ParseState): FilterToken {
  const token = peek(state);

  if (token === undefined) {
    throw syntaxError(state, "Unexpected end of input");
  }

  state.position += 1;

  return token;
}

/** Advances past the current token, requiring it to be of the given kind. */
function expect<K extends FilterTokenKind>(state: ParseState, kind: K): Extract<FilterToken, { kind: K }> {
  if (!isNext(state, kind)) {
    throw syntaxError(state, `Expected token of kind ${kind}`);
  }

  return consume(state) as Extract<FilterToken, { kind: K }>;
}

/** Advances past a specific structural symbol, requiring it to be there. */
function expectSymbol(state: ParseState, symbol: "(" | ")" | ","): void {
  if (!isNext(state, FilterTokenKind.Symbol, symbol)) {
    throw syntaxError(state, `Expected "${symbol}"`);
  }

  consume(state);
}

/**
 * Parses a scalar literal.
 *
 * Grammar: `literal := STRING | NUMBER`
 */
function parseLiteral(state: ParseState): string | number {
  const token = peek(state);

  if (token === undefined) {
    throw syntaxError(state, "Unexpected end of input");
  }

  if (token.kind !== FilterTokenKind.String && token.kind !== FilterTokenKind.Number) {
    throw syntaxError(state, "Expected a string or number literal");
  }

  consume(state);

  return token.value;
}

/**
 * Parses the right-hand side of a comparison.
 *
 * Grammar: `rhs := literal | "(" literal ( "," literal )* ")"`
 */
function parseRightHandSide(state: ParseState): string | number | (string | number)[] {
  if (!isNext(state, FilterTokenKind.Symbol, "(")) {
    return parseLiteral(state);
  }

  consume(state);

  const values: (string | number)[] = [];

  do {
    values.push(parseLiteral(state));

    if (isNext(state, FilterTokenKind.Symbol, ",")) {
      consume(state);
    }
  } while (!isNext(state, FilterTokenKind.Symbol, ")"));

  expectSymbol(state, ")");

  return values;
}

/**
 * Parses a comparison.
 *
 * Grammar: `comparison := FIELD OPERATOR rhs`
 */
function parseComparison(state: ParseState): FilterAst {
  const field = expect(state, FilterTokenKind.Field);
  const operator = expect(state, FilterTokenKind.Operator);

  return {
    kind: FilterAstKind.Comparison,
    field: field.value,
    operator: operator.value,
    value: parseRightHandSide(state),
  };
}

/**
 * Parses a primary expression.
 *
 * Grammar: `primary := "(" or ")" | comparison`
 */
function parsePrimary(state: ParseState): FilterAst {
  if (!isNext(state, FilterTokenKind.Symbol, "(")) {
    return parseComparison(state);
  }

  consume(state);

  const inner = parseOr(state);

  expectSymbol(state, ")");

  return inner;
}

/**
 * Parses a conjunction.
 *
 * Grammar: `and := primary ( "AND" primary )*`. Binds tighter than `OR`.
 */
function parseAnd(state: ParseState): FilterAst {
  let node = parsePrimary(state);

  while (isNext(state, FilterTokenKind.Logical, FilterOperator.And)) {
    consume(state);
    node = {
      kind: FilterAstKind.Binary,
      operator: FilterOperator.And,
      leftExpr: node,
      rightExpr: parsePrimary(state),
    };
  }

  return node;
}

/**
 * Parses a disjunction.
 *
 * Grammar: `or := and ( "OR" and )*`. The lowest-precedence production, and the entry point.
 */
function parseOr(state: ParseState): FilterAst {
  let node = parseAnd(state);

  while (isNext(state, FilterTokenKind.Logical, FilterOperator.Or)) {
    consume(state);
    node = {
      kind: FilterAstKind.Binary,
      operator: FilterOperator.Or,
      leftExpr: node,
      rightExpr: parseAnd(state),
    };
  }

  return node;
}

/**
 * Parses a filter expression into an abstract syntax tree.
 *
 * `AND` binds tighter than `OR`, and parentheses override both. The whole expression must be
 * consumed: trailing tokens are an error rather than being ignored, so a typo that truncates a
 * filter fails loudly instead of silently matching more mail than intended.
 *
 * @param text - The filter expression, as written in the rule's `filter` column.
 * @returns The parsed expression.
 * @throws {SyntaxError} If the expression is malformed. The message carries the token index.
 *
 * @example
 * ```ts
 * import { compileFilter } from "./compile.ts";
 *
 * const ast = compileFilter('subject ~ "invoice" AND from !* "*noreply*"');
 * // ast.kind === "binary"
 * ```
 */
export function compileFilter(text: string): FilterAst {
  const state: ParseState = { tokens: [...tokenizeFilter(text)], position: 0 };

  const ast = parseOr(state);

  if (state.position < state.tokens.length) {
    throw syntaxError(state, "Unexpected trailing tokens");
  }

  return ast;
}
