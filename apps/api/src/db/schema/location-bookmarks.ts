import { pgTable, uuid, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { users } from './users';
import { campusLocations } from './campus-locations';

/**
 * Phase 10.3: a rider favoriting an existing `campus_locations` entry (not an arbitrary custom
 * pin - docs/plan.md §5/10.3 for why) for faster pickup/destination selection.
 */
export const locationBookmarks = pgTable(
  'location_bookmarks',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    campusLocationId: uuid('campus_location_id')
      .notNull()
      .references(() => campusLocations.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // A rider can only favorite a given location once - also the index `findForUser`/
    // `remove` both query by.
    userLocationIdx: uniqueIndex('location_bookmarks_user_location_idx').on(
      table.userId,
      table.campusLocationId,
    ),
  }),
);

export type LocationBookmark = typeof locationBookmarks.$inferSelect;
export type NewLocationBookmark = typeof locationBookmarks.$inferInsert;
