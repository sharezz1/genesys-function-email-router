/**
 * The rule filter language.
 *
 * A rule's `filter` column carries an expression such as `subject ~ "invoice" AND from !* "*noreply*"`.
 * This module turns that text into a decision: {@linkcode tokenizeFilter} lexes it,
 * {@linkcode compileFilter} parses the tokens into an AST, and {@linkcode evaluateFilter} walks the
 * AST against an inbound email.
 *
 * @module
 */

export { compileFilter } from "./compile.ts";
export { evaluateFilter } from "./evaluate.ts";
export { globMatch } from "./glob.ts";
export { tokenizeFilter } from "./tokenize.ts";
