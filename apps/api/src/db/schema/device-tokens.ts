import { pgTable, uuid, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { users } from './users';
import { devicePlatformEnum } from './enums';

/**
 * Phase 7 (Notifications): one row per registered FCM device-registration token.
 *
 * `token` is UNIQUE, not `(userId, token)` - a given physical device token can only ever be
 * useful to deliver to one user at a time (whoever is currently logged in on that device), so
 * registering it maps the token to exactly one `userId`. When the *same* token re-registers
 * under a *different* user (a shared/resold device, or a user logging out and someone else
 * logging in on the same phone - both real, legitimate cases), the upsert in
 * `DeviceTokensService#register` reassigns the existing row to the new user rather than
 * erroring on the unique constraint - see docs/open-items.md for the full reasoning. The old
 * owner simply stops receiving pushes on that token, which is exactly what should happen once
 * they're no longer the one holding the device.
 */
export const deviceTokens = pgTable(
  'device_tokens',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    token: text('token').notNull(),
    platform: devicePlatformEnum('platform').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tokenIdx: uniqueIndex('device_tokens_token_idx').on(table.token),
  }),
);

export type DeviceToken = typeof deviceTokens.$inferSelect;
export type NewDeviceToken = typeof deviceTokens.$inferInsert;
