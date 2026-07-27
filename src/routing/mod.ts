/**
 * Rule evaluation.
 *
 * {@linkcode getContext} assembles the {@linkcode RoutingContext} an inbound email is judged
 * against, and {@linkcode handleRule} runs a single rule against it — filter first, then the
 * action, then the audit entry.
 *
 * @module
 */

export { getContext } from "./context.ts";
export { handleRule } from "./rules.ts";
