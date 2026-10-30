ALTER TABLE "catalog_items" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "catalog_variants" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;