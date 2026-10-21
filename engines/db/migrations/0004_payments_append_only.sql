-- 0004 — append-only hardening for checkout/return/shift tables (no prod impact, isolated tests only).
REVOKE UPDATE, DELETE ON TABLE "cash_shifts" FROM nile_app;--> statement-breakpoint
REVOKE UPDATE, DELETE ON TABLE "cash_shift_closures" FROM nile_app;--> statement-breakpoint
REVOKE UPDATE, DELETE ON TABLE "payments" FROM nile_app;--> statement-breakpoint
REVOKE UPDATE, DELETE ON TABLE "refunds" FROM nile_app;--> statement-breakpoint
REVOKE UPDATE, DELETE ON TABLE "cash_movement_resolutions" FROM nile_app;--> statement-breakpoint
REVOKE UPDATE, DELETE ON TABLE "cash_movements" FROM nile_app;--> statement-breakpoint
ALTER TABLE "cash_shifts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cash_shift_closures" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "payments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "refunds" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cash_movement_resolutions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cash_movements" FORCE ROW LEVEL SECURITY;
