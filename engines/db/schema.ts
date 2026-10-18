/**
 * Aggregated schema barrel — the single input for drizzle-kit (generated,
 * committed migrations per ADR-0004) and for the runtime Drizzle client.
 * Each table stays owned by its module; this file only collects them.
 */
export * from '../platform/src/auth/schema.js';
export * from '../platform/src/db/schema.js';
export * from '../catalog/src/db/schema.js';
export * from '../transactions/src/db/schema.js';
export * from '../transactions/src/db/payments-schema.js';
export * from '../booking/src/db/schema.js';
export * from '../people/src/db/schema.js';
