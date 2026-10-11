CREATE TABLE IF NOT EXISTS "location_bookmarks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"campus_location_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ride_ratings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ride_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"rating" smallint NOT NULL,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "location_bookmarks" ADD CONSTRAINT "location_bookmarks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "location_bookmarks" ADD CONSTRAINT "location_bookmarks_campus_location_id_campus_locations_id_fk" FOREIGN KEY ("campus_location_id") REFERENCES "public"."campus_locations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ride_ratings" ADD CONSTRAINT "ride_ratings_ride_id_rides_id_fk" FOREIGN KEY ("ride_id") REFERENCES "public"."rides"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ride_ratings" ADD CONSTRAINT "ride_ratings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "location_bookmarks_user_location_idx" ON "location_bookmarks" USING btree ("user_id","campus_location_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ride_ratings_ride_id_idx" ON "ride_ratings" USING btree ("ride_id");--> statement-breakpoint
-- drizzle-kit's generator does not emit CREATE TABLE-time CHECK constraints for this version -
-- added by hand to match the schema.ts definition (ride-ratings.ts's `check()`).
DO $$ BEGIN
 ALTER TABLE "ride_ratings" ADD CONSTRAINT "ride_ratings_rating_range_check" CHECK ("rating" >= 1 AND "rating" <= 5);
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;