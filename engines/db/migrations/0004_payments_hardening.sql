-- Hardening for the payments tables (0003) that drizzle-kit cannot express.
-- Custom migration (drizzle-kit generate --custom), applied by the
-- MIGRATION/owner role, not by nile_app.
--
-- Why this migration is required — two gaps, both documented:
--
-- 1. FORCE ROW LEVEL SECURITY. The DO block in 0001_security_hardening.sql
--    walks pg_class and FORCEs RLS on every table that exists AT THAT MOMENT.
--    The 0003 tables did not exist yet, so they would run with RLS enabled but
--    not forced. Without FORCE, the table owner bypasses RLS — and defense in
--    depth (ADR-0005 §7) requires binding the owner too.
--
-- 2. Gap P4-4 (PR #4 review). 0001 ran:
--        ALTER DEFAULT PRIVILEGES ... GRANT SELECT, INSERT, UPDATE, DELETE
--    so every table created afterwards — including these — silently inherits
--    UPDATE and DELETE for nile_app. Payments, tenders, refunds, shifts and
--    closures are ledger records: rewriting or erasing them is exactly the
--    blast radius 0002 removed for the older tables. Revoke it here.
--
-- Consequence, by design: all five tables are APPEND-ONLY for the runtime
-- role. State transitions are new rows (see payments-schema.ts). Cross-row
-- invariants needing serialisation use advisory locks, because PostgreSQL
-- requires UPDATE privilege for SELECT … FOR UPDATE/SHARE and nile_app has
-- none (proposal 0007 fact F5, verified on PostgreSQL 18.4).

ALTER TABLE "cash_shifts"      FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "shift_closures"   FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "payments"         FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "payment_tenders"  FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "refunds"          FORCE ROW LEVEL SECURITY;--> statement-breakpoint

GRANT SELECT, INSERT ON "cash_shifts", "shift_closures", "payments", "payment_tenders", "refunds" TO nile_app;--> statement-breakpoint
REVOKE UPDATE, DELETE ON "cash_shifts"      FROM nile_app;--> statement-breakpoint
REVOKE UPDATE, DELETE ON "shift_closures"   FROM nile_app;--> statement-breakpoint
REVOKE UPDATE, DELETE ON "payments"         FROM nile_app;--> statement-breakpoint
REVOKE UPDATE, DELETE ON "payment_tenders"  FROM nile_app;--> statement-breakpoint
REVOKE UPDATE, DELETE ON "refunds"          FROM nile_app;
