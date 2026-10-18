-- Ledger and audit history are append-only for the runtime role (ADR-0005 §7).
--
-- 0001 granted nile_app SELECT/INSERT/UPDATE/DELETE on every table. Runtime code
-- only ever INSERTs into these tables (the single runtime UPDATE is the guarded
-- stock decrement on catalog_variants), so UPDATE/DELETE here only widened the
-- blast radius of an application bug or injection: sold prices, totals, stock
-- history and the audit trail could be rewritten or erased without a trace.
--
-- Corrections are new rows (void/return/adjustment entries), never edits.
-- Maintenance jobs that must purge data (e.g. the daily demo reset) run as the
-- owner role, not as nile_app.
REVOKE UPDATE, DELETE ON TABLE "audit_log" FROM nile_app;--> statement-breakpoint
REVOKE UPDATE, DELETE ON TABLE "sales_transactions" FROM nile_app;--> statement-breakpoint
REVOKE UPDATE, DELETE ON TABLE "transaction_lines" FROM nile_app;--> statement-breakpoint
REVOKE UPDATE, DELETE ON TABLE "stock_movements" FROM nile_app;--> statement-breakpoint
REVOKE UPDATE, DELETE ON TABLE "cash_movements" FROM nile_app;
