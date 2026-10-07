import { pgTable, uuid, text, timestamp, uniqueIndex, doublePrecision } from 'drizzle-orm/pg-core';
import { driverStatusEnum, driverAvailabilityEnum } from './enums';
import { users } from './users';
import { vehicles } from './vehicles';

export const drivers = pgTable(
  'drivers',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    driverCode: text('driver_code').notNull(),
    status: driverStatusEnum('status').notNull().default('PENDING'),
    availability: driverAvailabilityEnum('availability').notNull().default('OFFLINE'),
    currentVehicleId: uuid('current_vehicle_id').references(() => vehicles.id),
    // Plain lat/lng snapshot pushed by the driver app - NOT PostGIS (none available in this
    // sandbox, see docs/open-items.md #2). All nullable: a driver who has never pushed a
    // location has none. Used by dispatch's Haversine-based nearest-driver matching.
    currentLatitude: doublePrecision('current_latitude'),
    currentLongitude: doublePrecision('current_longitude'),
    locationUpdatedAt: timestamp('location_updated_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userIdIdx: uniqueIndex('drivers_user_id_idx').on(table.userId),
    driverCodeIdx: uniqueIndex('drivers_driver_code_idx').on(table.driverCode),
  }),
);

export type Driver = typeof drivers.$inferSelect;
export type NewDriver = typeof drivers.$inferInsert;
