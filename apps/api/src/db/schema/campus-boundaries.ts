import { pgTable, uuid, text, boolean, timestamp } from 'drizzle-orm/pg-core';
import { geometry } from './geo';

/**
 * Overall campus boundary polygon(s) - "is this driver/pickup inside campus" for dispatch
 * (architecture.md §4.2 step 3), distinct from `campus_restricted_zones` (which models
 * Valhalla routing-exclusion areas, not the campus perimeter). A point counts as "inside
 * campus" if it falls within any `isActive` row here.
 */
export const campusBoundaries = pgTable('campus_boundaries', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  geom: geometry('Polygon')('geom').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type CampusBoundary = typeof campusBoundaries.$inferSelect;
export type NewCampusBoundary = typeof campusBoundaries.$inferInsert;
