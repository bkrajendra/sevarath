import { pgTable, uuid, text, boolean, timestamp } from 'drizzle-orm/pg-core';
import { geometry } from './geo';

/**
 * Campus-private road/path geometry not present in public OSM data. Exported to an OSM
 * overlay and merged into the Valhalla routing graph on each rebuild - see
 * architecture.md §8.2.
 */
export const campusRoads = pgTable('campus_roads', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  geom: geometry('LineString')('geom').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type CampusRoad = typeof campusRoads.$inferSelect;
export type NewCampusRoad = typeof campusRoads.$inferInsert;
