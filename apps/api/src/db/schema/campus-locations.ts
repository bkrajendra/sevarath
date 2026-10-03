import { pgTable, uuid, text, doublePrecision, boolean, timestamp } from 'drizzle-orm/pg-core';
import { campusLocationTypeEnum } from './enums';

export const campusLocations = pgTable('campus_locations', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  type: campusLocationTypeEnum('type').notNull().default('OTHER'),
  latitude: doublePrecision('latitude').notNull(),
  longitude: doublePrecision('longitude').notNull(),
  description: text('description'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type CampusLocation = typeof campusLocations.$inferSelect;
export type NewCampusLocation = typeof campusLocations.$inferInsert;
