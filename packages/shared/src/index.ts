/**
 * @horamind/shared — contracts used by both the API and the mobile client.
 *
 * Everything here is a Zod schema plus its inferred type, so one definition
 * serves runtime validation on the server, compile-time types on the client,
 * and the generated OpenAPI document. A rule written once cannot drift between
 * the two ends of a request.
 */

export * from './constants.js';
export * from './schemas/common.js';
export * from './schemas/auth.js';
export * from './schemas/birth.js';
export * from './schemas/memory.js';
export * from './schemas/chat.js';
