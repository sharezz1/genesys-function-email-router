import type { Handler } from "aws-lambda";
import type { FunctionRequest, FunctionResponse } from "./mod.ts";

/**
 * Type alias for a handler function that processes a {@linkcode FunctionRequest}
 * and returns a {@linkcode FunctionResponse}.
 */
export type FunctionHandler = Handler<FunctionRequest, FunctionResponse>;
