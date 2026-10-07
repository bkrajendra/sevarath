import { pgTable, uuid, timestamp } from 'drizzle-orm/pg-core';
import { rideOfferResultEnum } from './enums';
import { rides } from './rides';
import { drivers } from './drivers';

/**
 * Tracks the per-driver notify/accept/reject/expire cascade during SEARCHING_DRIVER -
 * see architecture.md §4.2. `rides.status` covers the whole cascade; this table records which
 * individual driver currently holds (or held) the live offer and how it was resolved.
 */
export const rideOffers = pgTable('ride_offers', {
  id: uuid('id').defaultRandom().primaryKey(),
  rideId: uuid('ride_id')
    .notNull()
    .references(() => rides.id),
  driverId: uuid('driver_id')
    .notNull()
    .references(() => drivers.id),
  offeredAt: timestamp('offered_at', { withTimezone: true }).notNull().defaultNow(),
  respondedAt: timestamp('responded_at', { withTimezone: true }),
  result: rideOfferResultEnum('result').notNull().default('PENDING'),
});

export type RideOffer = typeof rideOffers.$inferSelect;
export type NewRideOffer = typeof rideOffers.$inferInsert;
