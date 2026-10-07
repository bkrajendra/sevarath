import { pgTable, pgEnum, uuid, text, jsonb, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { users } from './users';

export const idempotencyKeyStatusEnum = pgEnum('idempotency_key_status', [
  'IN_PROGRESS',
  'COMPLETED',
]);

/**
 * specification.md §11.1 / architecture.md §6.2: client-supplied `Idempotency-Key` support for
 * the five mutating ride/dispatch commands. `route` identifies *which endpoint* the key was used
 * on (e.g. "RidesController#cancel" - see idempotency.interceptor.ts for exactly how that string
 * is built), not a literal URL with a specific resource id baked in, so the same key value used by
 * the same user on two different routes - purely by coincidence - doesn't collide with itself.
 *
 * The unique index on (user_id, route, idempotency_key) is the whole mechanism: claiming a key is
 * just an insert that either succeeds (this request won the race and should run the real handler)
 * or hits the unique constraint (someone else already claimed it - look their row up instead of
 * racing a second write). See idempotency.interceptor.ts for the `onConflictDoNothing` claim.
 */
export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    route: text('route').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    status: idempotencyKeyStatusEnum('status').notNull().default('IN_PROGRESS'),
    responseBody: jsonb('response_body'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => ({
    userRouteKeyIdx: uniqueIndex('idempotency_keys_user_route_key_idx').on(
      table.userId,
      table.route,
      table.idempotencyKey,
    ),
  }),
);

export type IdempotencyKeyRow = typeof idempotencyKeys.$inferSelect;
export type NewIdempotencyKeyRow = typeof idempotencyKeys.$inferInsert;
