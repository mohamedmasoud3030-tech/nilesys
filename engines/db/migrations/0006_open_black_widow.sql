ALTER TABLE "cash_shift_closures" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
ALTER TABLE "cash_shift_closures" ADD COLUMN "request_hash" text;--> statement-breakpoint
ALTER TABLE "cash_shift_closures" ADD CONSTRAINT "cash_shift_closures_tenant_idem_uq" UNIQUE("tenant_id","idempotency_key");