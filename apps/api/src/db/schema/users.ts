import { pgTable, uuid, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { userRoleEnum, userStatusEnum } from './enums';

export const users = pgTable(
  'users',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: text('name').notNull(),
    mobile: text('mobile').notNull(),
    email: text('email'),
    passwordHash: text('password_hash'),
    role: userRoleEnum('role').notNull().default('USER'),
    status: userStatusEnum('status').notNull().default('ACTIVE'),
    firebaseUid: text('firebase_uid'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    mobileIdx: uniqueIndex('users_mobile_idx').on(table.mobile),
    firebaseUidIdx: uniqueIndex('users_firebase_uid_idx').on(table.firebaseUid),
  }),
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
