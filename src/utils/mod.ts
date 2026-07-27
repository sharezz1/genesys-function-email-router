/**
 * Shared helpers.
 *
 * Small, dependency-light utilities used across the router: email address handling and the
 * pagination loop every Platform API list call needs.
 *
 * @module
 */

export { getEmailRoute, isValidEmail, substitutePlaceholders } from "./email.ts";
export { paginate } from "./paginate.ts";
