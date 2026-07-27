/**
 * One element of a compiled glob pattern.
 *
 * Compiling to tokens once, rather than interpreting the pattern string during the match, keeps the
 * matcher's inner loop free of escape and bracket handling — which is where the previous
 * implementation's bugs lived.
 */
type GlobToken =
  /** A character that must appear exactly. */
  | { readonly kind: "literal"; readonly value: string }
  /** `?` — exactly one character, whatever it is. */
  | { readonly kind: "any" }
  /** `*` — any run of characters, including none. */
  | { readonly kind: "star" }
  /** `[...]` — one character drawn from a set. */
  | {
    readonly kind: "class";
    readonly negated: boolean;
    readonly chars: ReadonlySet<string>;
    readonly ranges: readonly (readonly [string, string])[];
  };

/**
 * Compiles a glob pattern into tokens.
 *
 * Total by construction: every input produces a pattern. A `[` with no closing bracket becomes a
 * literal `[` rather than an error, because the alternative — the previous implementation's
 * behaviour — was to build an invalid regular expression and throw from inside the comparison,
 * which surfaced to the rule author as "Filter evaluation error" on a rule that looked fine.
 */
function compile(pattern: string): GlobToken[] {
  const tokens: GlobToken[] = [];
  let index = 0;

  while (index < pattern.length) {
    const character = pattern.charAt(index);

    if (character === "\\") {
      // A trailing backslash is a literal backslash; there is nothing left to escape.
      const escaped = index + 1 < pattern.length ? pattern.charAt(index + 1) : "\\";
      tokens.push({ kind: "literal", value: escaped });
      index += index + 1 < pattern.length ? 2 : 1;
      continue;
    }

    if (character === "*") {
      // Consecutive stars are the same as one, and collapsing them here bounds the match: the
      // matcher backtracks per star, so `***` would otherwise multiply work for no expressiveness.
      if (tokens[tokens.length - 1]?.kind !== "star") {
        tokens.push({ kind: "star" });
      }
      index += 1;
      continue;
    }

    if (character === "?") {
      tokens.push({ kind: "any" });
      index += 1;
      continue;
    }

    if (character === "[") {
      const parsed = parseClass(pattern, index);

      if (parsed === undefined) {
        tokens.push({ kind: "literal", value: "[" });
        index += 1;
        continue;
      }

      tokens.push(parsed.token);
      index = parsed.next;
      continue;
    }

    tokens.push({ kind: "literal", value: character });
    index += 1;
  }

  return tokens;
}

/**
 * Parses a `[...]` character class beginning at `start`.
 *
 * @returns The token and the index just past the closing bracket, or `undefined` when the class is
 * never closed — in which case the caller treats the `[` as a literal.
 */
function parseClass(
  pattern: string,
  start: number,
): { readonly token: GlobToken; readonly next: number } | undefined {
  let index = start + 1;
  let negated = false;

  if (pattern.charAt(index) === "^") {
    negated = true;
    index += 1;
  }

  const chars = new Set<string>();
  const ranges: [string, string][] = [];

  // A `]` in the first position is a literal, following POSIX. Without this the only way to match a
  // closing bracket would be to escape it, and `[]]` would read as an empty, unclosable class.
  let first = true;

  while (index < pattern.length) {
    const character = pattern.charAt(index);

    if (character === "]" && !first) {
      return {
        token: { kind: "class", negated, chars, ranges },
        next: index + 1,
      };
    }

    first = false;

    // Escapes work inside a class too, so `[\]]` and `[a\-z]` mean what they look like.
    let value = character;
    if (character === "\\" && index + 1 < pattern.length) {
      value = pattern.charAt(index + 1);
      index += 1;
    }

    // A `-` that is not between two characters is a literal `-`, as in `[a-]` or `[-a]`.
    const isRange = pattern.charAt(index + 1) === "-" &&
      index + 2 < pattern.length &&
      pattern.charAt(index + 2) !== "]";

    if (isRange) {
      ranges.push([value, pattern.charAt(index + 2)]);
      index += 3;
      continue;
    }

    chars.add(value);
    index += 1;
  }

  return undefined;
}

/** Reports whether a single character satisfies one non-star token. */
function matchesToken(token: GlobToken, character: string): boolean {
  switch (token.kind) {
    case "literal":
      return token.value === character;

    case "any":
      return true;

    case "class": {
      const inSet = token.chars.has(character) ||
        token.ranges.some(([low, high]) => character >= low && character <= high);
      return token.negated ? !inSet : inSet;
    }

    case "star":
      return false;
  }
}

/**
 * Matches a value against a glob pattern.
 *
 * Supports `*` (any run, including none), `?` (exactly one character), `[abc]` / `[a-z]` /
 * `[^abc]` character classes, and `\` to make the next character literal. Everything else matches
 * itself, so regular-expression punctuation such as `.` or `+` is literal — a rule author writing
 * `attachments * "*.pdf"` means a dot.
 *
 * Comparison is exact. Callers normalize case before calling, and both sides of a filter comparison
 * are lower-cased, which is what makes the language case-insensitive.
 *
 * Deliberately not implemented with `RegExp`. Translating a glob to a regular expression is what
 * made `body * "*urgent*payment*overdue*"` — three ordinary words — take seconds on a large body
 * and tens of seconds on a crafted one, because the engine backtracks exponentially. This runs in
 * O(text × pattern) with no recursion: each star records one resume point, and a failed branch
 * advances that point by exactly one character rather than exploring the tree beneath it.
 *
 * @param text - The value to test.
 * @param pattern - The glob pattern.
 * @returns Whether the whole value matches the whole pattern.
 *
 * @example
 * ```ts
 * import { globMatch } from "./glob.ts";
 *
 * globMatch("invoice.pdf", "*.pdf");      // true
 * globMatch("invoice7.pdf", "*[0-9].pdf"); // true
 * globMatch("report.pdf", "report\\*.pdf"); // false — the pattern wants a literal asterisk
 * ```
 */
export function globMatch(text: string, pattern: string): boolean {
  const tokens = compile(pattern);

  let textIndex = 0;
  let tokenIndex = 0;

  /** Where to resume from after the most recent star, and how much it has already consumed. */
  let starToken = -1;
  let starText = 0;

  while (textIndex < text.length) {
    const token = tokens[tokenIndex];

    if (token !== undefined && token.kind === "star") {
      starToken = tokenIndex;
      starText = textIndex;
      tokenIndex += 1;
      continue;
    }

    if (token !== undefined && matchesToken(token, text.charAt(textIndex))) {
      tokenIndex += 1;
      textIndex += 1;
      continue;
    }

    if (starToken === -1) {
      return false;
    }

    // Let the last star swallow one more character and try again from just after it. This is the
    // whole backtracking budget: linear in the text, not exponential in the number of stars.
    starText += 1;
    tokenIndex = starToken + 1;
    textIndex = starText;
  }

  // Trailing stars may still match the empty remainder.
  while (tokens[tokenIndex]?.kind === "star") {
    tokenIndex += 1;
  }

  return tokenIndex === tokens.length;
}
