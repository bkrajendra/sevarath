import { pgTable, uuid, text, boolean, timestamp } from 'drizzle-orm/pg-core';
import { geometry } from './geo';

/**
 * Polygons EV routing must avoid. Passed to Valhalla as `exclude_polygons` per request -
 * toggleable via `isActive` without a Valhalla graph rebuild. See architecture.md §8.2.
 */
export const campusRestrictedZones = pgTable('campus_restricted_zones', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  reason: text('reason'),
  geom: geometry('Polygon')('geom').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type CampusRestrictedZone = typeof campusRestrictedZones.$inferSelect;
export type NewCampusRestrictedZone = typeof campusRestrictedZones.$inferInsert;
