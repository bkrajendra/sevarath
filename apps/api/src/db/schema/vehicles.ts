import { pgTable, uuid, text, integer, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { vehicleStatusEnum } from './enums';

export const vehicles = pgTable(
  'vehicles',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    vehicleCode: text('vehicle_code').notNull(),
    registrationNumber: text('registration_number'),
    vehicleType: text('vehicle_type').notNull().default('EV'),
    capacity: integer('capacity').notNull().default(4),
    status: vehicleStatusEnum('status').notNull().default('AVAILABLE'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    vehicleCodeIdx: uniqueIndex('vehicles_vehicle_code_idx').on(table.vehicleCode),
  }),
);

export type Vehicle = typeof vehicles.$inferSelect;
export type NewVehicle = typeof vehicles.$inferInsert;
