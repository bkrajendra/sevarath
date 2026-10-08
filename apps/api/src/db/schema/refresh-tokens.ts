import { pgTable, uuid, text, timestamp, uniqueIndex, index, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { users } from './users';

/**
 * Phase 9 (Hardening): server-side refresh-token rotation + revocation.
 *
 * Refresh JWTs are still signed/verified exactly as before (`JWT_REFRESH_SECRET`/
 * `JWT_REFRESH_TTL`) - this table does not replace that, it adds a revocation layer on top: a
 * refresh token is only honored by `AuthService#refresh` if BOTH its signature/expiry verify
 * AND a matching, unrevoked, unexpired row exists here. Every refresh token this app ever signs
 * (initial login/register, and every rotation) gets a row; a token that was never recorded here
 * is never treated as valid, which is what makes logout and reuse-detection possible at all for
 * an otherwise-stateless JWT.
 *
 * `tokenHash` stores a SHA-256 hex digest of the raw refresh JWT string, not a bcrypt hash - see
 * docs/open-items.md for the full reasoning (short version: the token itself is already a
 * high-entropy signed secret, not a low-entropy password, so a slow, randomly-salted KDF buys
 * nothing here and would force a linear table scan with bcrypt.compare instead of an indexed
 * exact-match lookup; a deliberate deviation from this repo's one other hashing precedent,
 * `users.passwordHash`'s bcrypt usage).
 *
 * `expiresAt` is copied from the signed JWT's own `exp` claim at issue time (via
 * `jwtService.decode(token)`), not independently recomputed from `JWT_REFRESH_TTL` - so this
 * row's notion of "expired" can never drift from what the JWT itself actually encodes.
 *
 * `replacedByTokenId` is a nullable self-reference: when a token is rotated, the OLD row gets
 * `revokedAt` set and `replacedByTokenId` pointed at the NEW row's id, forming a traceable
 * rotation chain. Drizzle needs the lazy `() => refreshTokens.id` callback form for a table to
 * reference its own (not-yet-defined-at-this-point) column.
 */
export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    tokenHash: text('token_hash').notNull(),
    issuedAt: timestamp('issued_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    replacedByTokenId: uuid('replaced_by_token_id').references(
      (): AnyPgColumn => refreshTokens.id,
    ),
  },
  (table) => ({
    tokenHashIdx: uniqueIndex('refresh_tokens_token_hash_idx').on(table.tokenHash),
    // Reuse-detection ("revoke every active row for this user") and the cleanup sweep both
    // filter/scan by userId - an index keeps both from degrading into a full table scan as this
    // table grows.
    userIdIdx: index('refresh_tokens_user_id_idx').on(table.userId),
  }),
);

export type RefreshToken = typeof refreshTokens.$inferSelect;
export type NewRefreshToken = typeof refreshTokens.$inferInsert;
