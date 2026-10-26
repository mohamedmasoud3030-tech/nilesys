/**
 * Audit target resolution & identity verification (final-review fix).
 *
 * The demo audit must never print PASS for the wrong database. Rules:
 *  - Default (production/staging) mode REQUIRES an explicit PostgreSQL URL
 *    via NILE_AUDIT_DATABASE_URL or DATABASE_URL. Missing → NOT VERIFIED.
 *    There is deliberately NO PGlite fallback in this mode.
 *  - The connected database is identified from the server itself
 *    (current_database/current_schema/current_user) and the required tables
 *    must exist in the active schema — otherwise NOT VERIFIED.
 *  - NILE_AUDIT_EXPECT_DB / NILE_AUDIT_EXPECT_SCHEMA, when set, must match the
 *    server-reported identity or the run is NOT VERIFIED (wrong-target guard).
 *  - The session is forced READ ONLY and verified.
 *  - Development mode exists only when NILE_AUDIT_TARGET=dev is set
 *    explicitly; its results are labeled Development and never production.
 *  - Credentials are never printed; only host/database/schema/env are shown.
 */
import pg from 'pg';

export type AuditEnvLabel = 'Production' | 'Staging' | 'Development' | 'Unspecified';

export interface AuditTargetIdentity {
  driver: 'postgres' | 'pglite';
  database: string;
  schema: string;
  env: AuditEnvLabel;
  detail: string; // safe one-line description for the operator
}

export type ResolvedAuditTarget =
  | { kind: 'postgres'; url: string; schema?: string; env: AuditEnvLabel }
  | { kind: 'dev-pglite'; dataDir?: string; env: 'Development' }
  | { kind: 'unverified'; reason: string };

function envLabel(env: Record<string, string | undefined>): AuditEnvLabel {
  const v = (env.NILE_AUDIT_ENV ?? '').trim().toLowerCase();
  if (v === 'production' || v === 'prod') return 'Production';
  if (v === 'staging' || v === 'stage') return 'Staging';
  if (v === 'development' || v === 'dev') return 'Development';
  return env.NODE_ENV === 'production' ? 'Production' : 'Unspecified';
}

/** Pure resolution of WHAT to audit — no connection is made here. */
export function resolveAuditTarget(env: Record<string, string | undefined> = process.env): ResolvedAuditTarget {
  if ((env.NILE_AUDIT_TARGET ?? '').trim().toLowerCase() === 'dev') {
    const requested = envLabel(env);
    if (requested === 'Production' || requested === 'Staging') {
      return {
        kind: 'unverified',
        reason: `وضع التطوير المحلي مرفوض عندما يُطلب فحص ${requested === 'Production' ? 'إنتاج' : 'staging'} — لن تصدر نتيجة عن قاعدة تطوير باسم بيئة حقيقية. أزِل NILE_AUDIT_TARGET=dev وحدّد قاعدة PostgreSQL المقصودة.`,
      };
    }
    return { kind: 'dev-pglite', dataDir: env.NILE_PGLITE_DIR, env: 'Development' };
  }
  const url = env.NILE_AUDIT_DATABASE_URL ?? env.DATABASE_URL;
  if (!url) {
    return {
      kind: 'unverified',
      reason: 'DATABASE_URL (أو NILE_AUDIT_DATABASE_URL) غير مضبوط — فحص الإنتاج يتطلب اختيار قاعدة PostgreSQL المقصودة صراحةً. لم يُفحص أي شيء.',
    };
  }
  let parsed: URL;
  try { parsed = new URL(url); } catch {
    return { kind: 'unverified', reason: 'عنوان اتصال قاعدة البيانات غير صالح صياغةً — لم يُفحص أي شيء.' };
  }
  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    return { kind: 'unverified', reason: 'عنوان الاتصال ليس PostgreSQL — لم يُفحص أي شيء.' };
  }
  return { kind: 'postgres', url, schema: env.NILE_AUDIT_SCHEMA?.trim() || undefined, env: envLabel(env) };
}

/** Safe (credential-free) description of a connection URL. */
export function describeUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname}${u.port ? `:${u.port}` : ''}${u.pathname}`;
  } catch {
    return '(غير قابل للعرض)';
  }
}

export interface OpenedAuditConnection {
  identity: AuditTargetIdentity;
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }>;
  close: () => Promise<void>;
}

/**
 * Connect, force read-only, and verify the target identity. Any failure
 * throws an Error whose message is operator-safe (no credentials) — callers
 * map it to NOT VERIFIED. A PASS-worthy audit requires this to succeed.
 */
export async function openVerifiedAuditConnection(
  target: { url: string; schema?: string; env: AuditEnvLabel },
  env: Record<string, string | undefined> = process.env,
): Promise<OpenedAuditConnection> {
  const client = new pg.Client({ connectionString: target.url });
  await client.connect();
  try {
    await client.query('SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY');
    if (target.schema) await client.query(`SET search_path TO ${quoteIdent(target.schema)}`);
    const ro = await client.query('SHOW transaction_read_only');
    if (ro.rows[0]?.transaction_read_only !== 'on') throw new Error('تعذّر فرض وضع القراءة فقط على الجلسة');

    const id = await client.query(
      `SELECT current_database() AS db, current_schema() AS schema, current_user AS usr,
              (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS is_super,
              (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) AS bypass_rls`,
    );
    const { db, schema, usr, is_super, bypass_rls } = id.rows[0] as { db: string; schema: string; usr: string; is_super: boolean; bypass_rls: boolean };

    // For Production/Staging audits, printing the connected name is NOT
    // enough: the operator must DECLARE the intended database and the server
    // must match it. Without a declaration there is no verdict at all.
    const expectDb = env.NILE_AUDIT_EXPECT_DB?.trim();
    if ((target.env === 'Production' || target.env === 'Staging') && !expectDb) {
      throw new Error(`فحص ${target.env} يتطلب إعلان القاعدة المقصودة صراحةً عبر NILE_AUDIT_EXPECT_DB — رفض إصدار أي حكم`);
    }
    if (expectDb && expectDb !== db) {
      throw new Error(`القاعدة المتصل بها (${db}) لا تطابق القاعدة المتوقعة (${expectDb}) — رفض إصدار أي حكم`);
    }
    const expectSchema = env.NILE_AUDIT_EXPECT_SCHEMA?.trim() || target.schema;
    if (expectSchema && expectSchema !== schema) {
      throw new Error(`الـschema النشطة (${schema}) لا تطابق المتوقعة (${expectSchema}) — رفض إصدار أي حكم`);
    }

    const tables = await client.query(
      `SELECT to_regclass('organization') AS organization, to_regclass('"user"') AS app_user, to_regclass('member') AS member`,
    );
    const t = tables.rows[0] as Record<string, string | null>;
    const missing = ['organization', 'app_user', 'member'].filter((k) => !t[k]);
    if (missing.length) {
      throw new Error(`الـschema (${schema}) لا تحتوي جداول الهوية المطلوبة — غالبًا قاعدة/schema خاطئة، رفض إصدار أي حكم`);
    }

    // Completeness of scope: a PASS requires seeing ALL tenants' identities.
    // That needs SELECT on the identity tables, and — were RLS ever enabled
    // on them — a role that bypasses it. Anything less could hide demo rows.
    const scope = await client.query(
      `SELECT has_table_privilege(current_user, 'organization', 'SELECT') AS p_org,
              has_table_privilege(current_user, '"user"', 'SELECT') AS p_user,
              has_table_privilege(current_user, 'member', 'SELECT') AS p_member,
              (SELECT bool_or(relrowsecurity) FROM pg_class
                WHERE relname IN ('organization','user','member')
                  AND relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = $1)) AS rls_on`,
      [schema],
    );
    const s = scope.rows[0] as { p_org: boolean; p_user: boolean; p_member: boolean; rls_on: boolean | null };
    if (!s.p_org || !s.p_user || !s.p_member) {
      throw new Error('دور الفحص لا يملك صلاحية قراءة كل جداول الهوية — الفحص غير شامل، رفض إصدار أي حكم');
    }
    if (s.rls_on && !is_super && !bypass_rls) {
      throw new Error('RLS مفعّلة على جداول الهوية ودور الفحص لا يتجاوزها — قد تُخفى صفوف مستأجرين، رفض إصدار أي حكم (استخدم دور قراءة BYPASSRLS/مالك)');
    }

    return {
      identity: {
        driver: 'postgres',
        database: db,
        schema,
        env: target.env,
        detail: `PostgreSQL · host/db=${describeUrl(target.url)} · database=${db} · schema=${schema} · role=${usr}${is_super ? ' (SUPERUSER — يُفضَّل دور قراءة مقيّد)' : ''} · env=${target.env} · read-only=on`,
      },
      query: async (text, params) => ({ rows: (await client.query(text, params as any[])).rows }),
      close: async () => { await client.end().catch(() => {}); },
    };
  } catch (e) {
    await client.end().catch(() => {});
    throw e;
  }
}

function quoteIdent(name: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error('اسم schema غير صالح');
  return `"${name}"`;
}
