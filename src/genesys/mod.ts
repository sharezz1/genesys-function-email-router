/**
 * Genesys Cloud helper kit.
 *
 * Batteries for a Genesys Cloud Function: an authenticated API client with token reuse, and the
 * Platform API calls this router makes on top of it — reading the rule datatable, reading and
 * mutating the email conversation, and resolving canned responses. Import from here rather than
 * from the individual modules.
 *
 * @module
 */

export { clearTokenCache, getClient } from "./client.ts";
export { getCredentials } from "./context.ts";
export { forwardEmail, getAttributes, sendEmail, setAttributes } from "./conversation.ts";
export { getDatatableRows, getRules } from "./datatable.ts";
export { getLibraries, getResponseByName, getResponses } from "./responses.ts";
