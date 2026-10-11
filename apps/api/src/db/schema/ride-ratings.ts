import { pgTable, uuid, text, smallint, timestamp, uniqueIndex, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { rides } from './rides';
import { users } from './users';

/**
 * Phase 10.3: a rider's 1-5 star rating + optional free-text comment for a completed ride.
 * Rating and feedback are one combined submission (docs/plan.md §5/10.3), not two separate
 * mechanisms - `comment` is the "feedback" half.
 */
export const rideRatings = pgTable(
  'ride_ratings',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    rideId: uuid('ride_id')
      .notNull()
      .references(() => rides.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    rating: smallint('rating').notNull(),
    comment: text('comment'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // One rating per ride - also enforces the "already rated" 409 check's uniqueness at the DB
    // level, not just in application code.
    rideIdx: uniqueIndex('ride_ratings_ride_id_idx').on(table.rideId),
    ratingRangeCheck: check('ride_ratings_rating_range_check', sql`${table.rating} >= 1 AND ${table.rating} <= 5`),
  }),
);

export type RideRating = typeof rideRatings.$inferSelect;
export type NewRideRating = typeof rideRatings.$inferInsert;
