import { pgTable, uuid, text, timestamp, index } from 'drizzle-orm/pg-core';
import { users } from './users';

/**
 * Phase 10.1: email-based password reset. A short-lived, single-use 6-digit code, not a
 * tokenized link - see docs/plan.md §5/10.1 for why (no deep-linking/App-Links infra needed).
 *
 * `codeHash` stores a SHA-256 hex digest of the raw 6-digit code, not a bcrypt hash - same
 * reasoning as `refresh_tokens.token_hash`: this needs an indexed exact-match lookup by
 * (userId, codeHash), and unlike `users.passwordHash` the code is single-use and expires in
 * minutes, so a slow KDF buys nothing. Unlike a refresh token though, a 6-digit code is
 * low-entropy (1e6 possibilities) - brute-forcing the hash offline is not the threat model here
 * (an attacker would need the DB already), the real guard is `AuthController`'s per-IP throttle
 * on the request/confirm endpoints plus the short expiry, not the hash choice itself.
 */
export const passwordResetCodes = pgTable(
  'password_reset_codes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    codeHash: text('code_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // Confirm looks up the most recent unused code for a user, not by codeHash directly (a
    // request can be retried, leaving multiple rows) - indexed by userId, not uniquely, since
    // nothing here needs cross-user uniqueness the way refresh_tokens.token_hash does.
    userIdIdx: index('password_reset_codes_user_id_idx').on(table.userId),
  }),
);

export type PasswordResetCode = typeof passwordResetCodes.$inferSelect;
export type NewPasswordResetCode = typeof passwordResetCodes.$inferInsert;
