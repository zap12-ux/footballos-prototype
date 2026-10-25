/**
 * @footballos/contracts — authoritative data and API contracts (zod schemas + inferred types).
 *
 * Import styles:
 *   import { schemas, type types } from '@footballos/contracts';   // schemas.TeamSchema, types.Team
 *   import { TeamSchema, type Team } from '@footballos/contracts';  // direct named imports
 *
 * This package depends on `zod` only and never on the API package.
 */
export * from './schemas.js';
export * as schemas from './schemas.js';
export type * as types from './schemas.js';
