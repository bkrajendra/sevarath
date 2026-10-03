import { pgTable, uuid, text, doublePrecision, timestamp } from 'drizzle-orm/pg-core';
import { rideStatusEnum } from './enums';
import { users } from './users';
import { drivers } from './drivers';
import { vehicles } from './vehicles';

export const rides = pgTable('rides', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  driverId: uuid('driver_id').references(() => drivers.id),
  vehicleId: uuid('vehicle_id').references(() => vehicles.id),

  pickupLatitude: doublePrecision('pickup_latitude').notNull(),
  pickupLongitude: doublePrecision('pickup_longitude').notNull(),
  pickupLocationName: text('pickup_location_name'),

  destinationLatitude: doublePrecision('destination_latitude').notNull(),
  destinationLongitude: doublePrecision('destination_longitude').notNull(),
  destinationLocationName: text('destination_location_name'),

  status: rideStatusEnum('status').notNull().default('REQUESTED'),

  requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
  acceptedAt: timestamp('accepted_at', { withTimezone: true }),
  driverArrivedAt: timestamp('driver_arrived_at', { withTimezone: true }),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Ride = typeof rides.$inferSelect;
export type NewRide = typeof rides.$inferInsert;
