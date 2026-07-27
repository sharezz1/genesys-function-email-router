import { FilterComparator } from "../types/FilterComparator.ts";
import { FilterField } from "../types/FilterField.ts";
import { FilterOperator } from "../types/FilterOperator.ts";
import type { FilterToken } from "../types/FilterToken.ts";
import { FilterTokenKind } from "../types/FilterTokenKind.ts";

/** Matches an identifier: a field name, or one of the logical keywords. */
const FIELD_PATTERN = /^[A-Za-z_][A-Za-z0-9_.]*/;

/** Matches a numeric literal. Integers only — the language has no fractional values. */
const NUMBER_PATTERN = /^[0-9]+/;

/** Field names, keyed by their lower-case spelling, so lookups can ignore case. */
const FIELD_LOOKUP = new Map<string, FilterField>(
  Object.values(FilterField).map((field) => [field, field]),
);

/**
 * Two-character comparators.
 *
 * Tested before the one-character set, because each begins with a character that is itself a
 * comparator or the prefix of one. Matching greedily is what keeps `!~` from lexing as `!` followed
 * by `~`, and `~=` from lexing as a bare `~`.
 */
const TWO_CHAR_OPERATORS = new Set<string>([
  FilterComparator.NotEquals,
  FilterComparator.NotContains,
  FilterComparator.NotGlobMatch,
  FilterComparator.RegexMatch,
]);

/** One-character comparators. */
const ONE_CHAR_OPERATORS = new Set<string>([
  FilterComparator.Equals,
  FilterComparator.Contains,
  FilterComparator.GlobMatch,
  FilterComparator.Intersects,
]);

/**
 * Splits a filter expression into tokens.
 *
 * Yields lazily, so a malformed expression throws at the character that broke it rather than after
 * scanning the whole string.
 *
 * @param text - The filter expression, as written in the rule's `filter` column.
 * @returns The tokens, in source order.
 * @throws {SyntaxError} On an unterminated string literal, an unknown field name, or a character
 * that begins no valid token.
 *
 * @example
 * ```ts
 * import { tokenizeFilter } from "./tokenize.ts";
 *
 * const tokens = [...tokenizeFilter('subject ~ "invoice"')];
 * // tokens.length === 3
 * ```
 */
export function* tokenizeFilter(text: string): IterableIterator<FilterToken> {
  let position = 0;

  // charAt rather than indexing: it reports the end of input as "" instead of undefined, and no
  // token can begin with "", so every comparison below stays total without a guard on each one.
  const current = (): string => text.charAt(position);
  const isEnd = (): boolean => position >= text.length;

  while (!isEnd()) {
    const character = current();

    if (/\s/.test(character)) {
      position += 1;
      continue;
    }

    if (character === "'" || character === '"') {
      const quote = character;
      let buffer = "";

      for (position += 1; !isEnd() && current() !== quote; position += 1) {
        if (current() === "\\" && text.charAt(position + 1) === quote) {
          position += 1;
        }

        buffer += current();
      }

      if (current() !== quote) {
        throw new SyntaxError("Unterminated string literal");
      }

      position += 1;

      yield { kind: FilterTokenKind.String, value: buffer };
      continue;
    }

    const numberMatch = NUMBER_PATTERN.exec(text.slice(position));
    if (numberMatch) {
      const [number] = numberMatch;
      position += number.length;
      yield { kind: FilterTokenKind.Number, value: Number(number) };
      continue;
    }

    const twoChar = text.slice(position, position + 2);
    if (TWO_CHAR_OPERATORS.has(twoChar)) {
      position += 2;
      yield { kind: FilterTokenKind.Operator, value: twoChar as FilterComparator };
      continue;
    }

    const oneChar = text.slice(position, position + 1);
    if (ONE_CHAR_OPERATORS.has(oneChar)) {
      position += 1;
      yield { kind: FilterTokenKind.Operator, value: oneChar as FilterComparator };
      continue;
    }

    if (character === "(" || character === ")" || character === ",") {
      position += 1;
      yield { kind: FilterTokenKind.Symbol, value: character };
      continue;
    }

    const fieldMatch = FIELD_PATTERN.exec(text.slice(position));
    if (fieldMatch) {
      const [identifier] = fieldMatch;
      position += identifier.length;

      const keyword = identifier.toUpperCase();
      if (keyword === FilterOperator.And || keyword === FilterOperator.Or) {
        yield { kind: FilterTokenKind.Logical, value: keyword as FilterOperator };
        continue;
      }

      const field = FIELD_LOOKUP.get(identifier.toLowerCase());
      if (!field) {
        throw new SyntaxError(`Unknown field "${identifier}"`);
      }

      yield { kind: FilterTokenKind.Field, value: field };
      continue;
    }

    throw new SyntaxError(`Unexpected character '${character}' at position ${position}`);
  }
}
