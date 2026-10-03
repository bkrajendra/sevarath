import { pgTable, uuid, text, jsonb, timestamp } from 'drizzle-orm/pg-core';
import { rides } from './rides';

export const rideEvents = pgTable('ride_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  rideId: uuid('ride_id')
    .notNull()
    .references(() => rides.id),
  eventType: text('event_type').notNull(),
  actorType: text('actor_type').notNull(),
  actorId: uuid('actor_id'),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type RideEvent = typeof rideEvents.$inferSelect;
export type NewRideEvent = typeof rideEvents.$inferInsert;
