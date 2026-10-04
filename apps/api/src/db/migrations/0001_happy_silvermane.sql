ALTER TABLE "users" ALTER COLUMN "firebase_uid" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "password_hash" text;