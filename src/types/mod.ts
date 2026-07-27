/**
 * Public type surface for the Genesys Cloud function.
 *
 * The contract types — {@linkcode FunctionRequest}, {@linkcode FunctionResponse} and
 * {@linkcode FunctionHandler} — describe what the data action exchanges with the Architect flow.
 * Everything else describes the rule set: how a rule is shaped, how its filter parses, and what
 * executing it produces.
 *
 * @module
 */

export type { ActionHandler } from "./ActionHandler.ts";
export type { ActionOutcome } from "./ActionOutcome.ts";
export type { ActionResult } from "./ActionResult.ts";
export type { Credentials } from "./Credentials.ts";
export type { FilterAst } from "./FilterAst.ts";
export { FilterAstKind } from "./FilterAstKind.ts";
export { FilterComparator } from "./FilterComparator.ts";
export { FilterField } from "./FilterField.ts";
export { FilterOperator } from "./FilterOperator.ts";
export type { FilterToken } from "./FilterToken.ts";
export { FilterTokenKind } from "./FilterTokenKind.ts";
export type { FunctionHandler } from "./FunctionHandler.ts";
export type { FunctionRequest } from "./FunctionRequest.ts";
export type { FunctionResponse } from "./FunctionResponse.ts";
export type { RoutingContext } from "./RoutingContext.ts";
export { RoutingDecision } from "./RoutingDecision.ts";
export type { Rule } from "./Rule.ts";
export { RuleAction } from "./RuleAction.ts";
export { RuleTarget } from "./RuleTarget.ts";
