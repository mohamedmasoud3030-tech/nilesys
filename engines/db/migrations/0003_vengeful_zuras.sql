CREATE TABLE "cash_movement_resolutions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"movement_id" uuid NOT NULL,
	"resolved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolution" text NOT NULL,
	CONSTRAINT "cash_movement_resolutions_movement_id_unique" UNIQUE("movement_id")
);
--> statement-breakpoint
ALTER TABLE "cash_movement_resolutions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cash_shift_closures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"shift_id" uuid NOT NULL,
	"counted_minor" bigint NOT NULL,
	"expected_minor" bigint NOT NULL,
	"difference_minor" bigint NOT NULL,
	"closed_by" uuid NOT NULL,
	"closed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cash_shift_closures_shift_id_unique" UNIQUE("shift_id")
);
--> statement-breakpoint
ALTER TABLE "cash_shift_closures" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cash_shifts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"register_code" text DEFAULT 'main' NOT NULL,
	"opened_by" uuid NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"opening_minor" bigint NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	CONSTRAINT "cash_shifts_tenant_id_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "cash_shifts_tenant_idem_uq" UNIQUE("tenant_id","idempotency_key")
);
--> statement-breakpoint
ALTER TABLE "cash_shifts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"transaction_id" uuid NOT NULL,
	"method" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"tendered_minor" bigint,
	"change_minor" bigint,
	"external_ref" text,
	"shift_id" uuid,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_tenant_id_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "payments_tenant_idem_uq" UNIQUE("tenant_id","idempotency_key")
);
--> statement-breakpoint
ALTER TABLE "payments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "refunds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"payment_id" uuid NOT NULL,
	"transaction_id" uuid NOT NULL,
	"amount_minor" bigint NOT NULL,
	"reason" text,
	"shift_id" uuid,
	"approved_by" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refunds_tenant_id_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "refunds_tenant_idem_uq" UNIQUE("tenant_id","idempotency_key")
);
--> statement-breakpoint
ALTER TABLE "refunds" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cash_movements" ADD COLUMN "payment_id" uuid;--> statement-breakpoint
ALTER TABLE "cash_movements" ADD COLUMN "refund_id" uuid;--> statement-breakpoint
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_tenant_id_id_uq" UNIQUE("tenant_id","id");--> statement-breakpoint
ALTER TABLE "cash_movement_resolutions" ADD CONSTRAINT "cash_movement_resolutions_tenant_id_organization_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_movement_resolutions" ADD CONSTRAINT "cash_movement_resolutions_movement_fk" FOREIGN KEY ("tenant_id","movement_id") REFERENCES "public"."cash_movements"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_shift_closures" ADD CONSTRAINT "cash_shift_closures_tenant_id_organization_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_shift_closures" ADD CONSTRAINT "cash_shift_closures_shift_fk" FOREIGN KEY ("tenant_id","shift_id") REFERENCES "public"."cash_shifts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_shifts" ADD CONSTRAINT "cash_shifts_tenant_id_organization_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_tenant_id_organization_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_txn_fk" FOREIGN KEY ("tenant_id","transaction_id") REFERENCES "public"."sales_transactions"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_tenant_id_organization_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_fk" FOREIGN KEY ("tenant_id","payment_id") REFERENCES "public"."payments"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_txn_fk" FOREIGN KEY ("tenant_id","transaction_id") REFERENCES "public"."sales_transactions"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cash_shifts_open_idx" ON "cash_shifts" USING btree ("tenant_id","register_code","opened_at");--> statement-breakpoint
CREATE INDEX "payments_txn_idx" ON "payments" USING btree ("tenant_id","transaction_id");--> statement-breakpoint
CREATE INDEX "refunds_payment_idx" ON "refunds" USING btree ("tenant_id","payment_id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cash_movement_resolutions" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cash_shift_closures" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cash_shifts" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "payments" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "refunds" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
