CREATE TABLE "cash_shifts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"register" text DEFAULT 'main' NOT NULL,
	"opening_float_minor" bigint DEFAULT 0 NOT NULL,
	"opened_by" uuid NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cash_shifts_tenant_id_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "cash_shifts_tenant_idem_uq" UNIQUE("tenant_id","idempotency_key"),
	CONSTRAINT "cash_shifts_float_non_negative" CHECK ("cash_shifts"."opening_float_minor" >= 0)
);
--> statement-breakpoint
ALTER TABLE "cash_shifts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "payment_tenders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"payment_id" uuid NOT NULL,
	"method" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"change_minor" bigint DEFAULT 0 NOT NULL,
	"external_ref" text,
	CONSTRAINT "payment_tenders_tenant_id_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "payment_tenders_amount_positive" CHECK ("payment_tenders"."amount_minor" > 0),
	CONSTRAINT "payment_tenders_change_non_negative" CHECK ("payment_tenders"."change_minor" >= 0),
	CONSTRAINT "payment_tenders_change_ne_exceeds_amount" CHECK ("payment_tenders"."change_minor" <= "payment_tenders"."amount_minor"),
	CONSTRAINT "payment_tenders_method_known" CHECK ("payment_tenders"."method" IN ('cash', 'card', 'wallet', 'bank')),
	CONSTRAINT "payment_tenders_change_only_for_cash" CHECK ("payment_tenders"."method" <> 'cash' OR "payment_tenders"."change_minor" >= 0),
	CONSTRAINT "payment_tenders_non_cash_needs_ref_when_referenced" CHECK ("payment_tenders"."external_ref" IS NULL OR length("payment_tenders"."external_ref") > 0)
);
--> statement-breakpoint
ALTER TABLE "payment_tenders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"sale_id" uuid NOT NULL,
	"shift_id" uuid NOT NULL,
	"total_minor" bigint NOT NULL,
	"currency" text DEFAULT 'EGP' NOT NULL,
	"created_by" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_tenant_id_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "payments_tenant_idem_uq" UNIQUE("tenant_id","idempotency_key"),
	CONSTRAINT "payments_total_positive" CHECK ("payments"."total_minor" > 0)
);
--> statement-breakpoint
ALTER TABLE "payments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "refunds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"payment_id" uuid NOT NULL,
	"amount_minor" bigint NOT NULL,
	"method" text NOT NULL,
	"reason" text,
	"refunded_by" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refunds_tenant_id_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "refunds_tenant_idem_uq" UNIQUE("tenant_id","idempotency_key"),
	CONSTRAINT "refunds_amount_positive" CHECK ("refunds"."amount_minor" > 0),
	CONSTRAINT "refunds_method_known" CHECK ("refunds"."method" IN ('cash', 'card', 'wallet', 'bank'))
);
--> statement-breakpoint
ALTER TABLE "refunds" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "shift_closures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"shift_id" uuid NOT NULL,
	"counted_minor" bigint NOT NULL,
	"expected_minor" bigint NOT NULL,
	"difference_minor" bigint NOT NULL,
	"counted_by" uuid NOT NULL,
	"closed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	CONSTRAINT "shift_closures_tenant_id_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "shift_closures_tenant_shift_uq" UNIQUE("tenant_id","shift_id"),
	CONSTRAINT "shift_closures_tenant_idem_uq" UNIQUE("tenant_id","idempotency_key"),
	CONSTRAINT "shift_closures_counted_non_negative" CHECK ("shift_closures"."counted_minor" >= 0),
	CONSTRAINT "shift_closures_difference_consistent" CHECK ("shift_closures"."difference_minor" = "shift_closures"."counted_minor" - "shift_closures"."expected_minor")
);
--> statement-breakpoint
ALTER TABLE "shift_closures" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cash_shifts" ADD CONSTRAINT "cash_shifts_tenant_id_organization_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_tenders" ADD CONSTRAINT "payment_tenders_tenant_id_organization_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_tenders" ADD CONSTRAINT "payment_tenders_payment_fk" FOREIGN KEY ("tenant_id","payment_id") REFERENCES "public"."payments"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_tenant_id_organization_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_sale_fk" FOREIGN KEY ("tenant_id","sale_id") REFERENCES "public"."sales_transactions"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_shift_fk" FOREIGN KEY ("tenant_id","shift_id") REFERENCES "public"."cash_shifts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_tenant_id_organization_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_fk" FOREIGN KEY ("tenant_id","payment_id") REFERENCES "public"."payments"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_closures" ADD CONSTRAINT "shift_closures_tenant_id_organization_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_closures" ADD CONSTRAINT "shift_closures_shift_fk" FOREIGN KEY ("tenant_id","shift_id") REFERENCES "public"."cash_shifts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cash_shifts_open_idx" ON "cash_shifts" USING btree ("tenant_id","register","opened_at");--> statement-breakpoint
CREATE INDEX "payment_tenders_payment_idx" ON "payment_tenders" USING btree ("tenant_id","payment_id");--> statement-breakpoint
CREATE INDEX "payments_sale_idx" ON "payments" USING btree ("tenant_id","sale_id");--> statement-breakpoint
CREATE INDEX "refunds_payment_idx" ON "refunds" USING btree ("tenant_id","payment_id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cash_shifts" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "payment_tenders" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "payments" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "refunds" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "shift_closures" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);