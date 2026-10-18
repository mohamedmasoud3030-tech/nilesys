/**
 * Nile offerings readiness registry — 7 systems, 7 websites, 5 Windows entries.
 *
 * WHAT THIS IS
 *   The verified implementation state of every offering the Nile catalogue
 *   advertises (the prototype homepage at prototypes/nilesys/public/assets/js/home.js).
 *   It answers one question per card: "what actually exists for this, and what
 *   is the smallest next step?" — so any surface that presents Nile (including
 *   the LENA umbrella site) can render an honest status instead of a "demo"
 *   button or an invented download.
 *
 * WHAT THIS IS NOT
 *   - Not an architecture decision, not a roadmap commitment, not public copy.
 *   - Not a second product registry for LENA. LENA's own product facts stay in
 *     platform/artifacts/lena/src/content/systems.ts.
 *   - Tier 5 evidence in AGENTS.md terms: it never authorises work.
 *
 * STATUS VOCABULARY (two independent axes — never merge them)
 *   production: is anything being built on the production path
 *               (engines/ + apps/api, ADR-0001..0007)?
 *     'in-progress'  — offering-specific production code exists in the tree this file ships in.
 *     'not-started'  — no offering-specific production code. Reusable engine code
 *                      may exist (listed under `engines`) but is not the offering.
 *   prototype:  what the HISTORICAL plain-Node prototype provides.
 *     'working-legacy' — a runnable legacy screen exists (POS only). Not production.
 *     'card-only'      — only a "soon" tile on the prototype homepage.
 *
 * VERIFICATION
 *   Verified 2026-10-18 against nilesys main 52af469 and published branches
 *   (git ls-remote), plus HTTP checks of every candidate URL.
 *   tools/nile-offerings/offerings.test.ts re-proves the repository facts
 *   mechanically on every run; external facts carry their own `checkedAt`.
 */
import type { DemoAccount } from '../../engines/platform/src/demo-seed.js';
import type { LeadSource } from '../../engines/catalog/src/catalog.js';

export type SystemId = DemoAccount['system'];
export type SiteId = LeadSource;
export type WindowsId = Extract<SystemId, 'pos' | 'inventory' | 'restaurant' | 'clinic' | 'hr'>;

export type OfferingKind = 'system' | 'site' | 'windows';
export type ProductionStatus = 'in-progress' | 'not-started';
export type PrototypeStatus = 'working-legacy' | 'card-only';
export type Locale = 'ar' | 'en';

/** A path inside this repository. The test fails if it does not exist. */
export type RepoPath = string;

export interface EngineReuse {
  /** Directory or file under engines/ that can be reused as-is. */
  path: RepoPath;
  /** What it gives this offering — stated narrowly, from the code. */
  provides: string;
}

export interface LegacyAsset {
  /** Repository in github.com/mohamedmasoud3030-tech. */
  repo: string;
  path: string;
  /** What is reusable. A legacy asset never proves this offering works. */
  note: string;
}

/**
 * A destination is published only with HTTP evidence. As of 2026-10-18 no Nile
 * offering has one: https://nilesys.vercel.app returns 404 (x-vercel-error:
 * NOT_FOUND) at /, /systems/pos.html and /api/health.
 */
export interface VerifiedDestination {
  url: string;
  httpStatus: 200;
  checkedAt: string;
}

export interface Offering {
  kind: OfferingKind;
  id: string;
  /** Names exactly as the prototype card shows them. */
  name: Record<Locale, string>;
  purpose: string;
  production: ProductionStatus;
  prototype: PrototypeStatus;
  /** Who is allowed to change implementation for this offering right now. */
  owner: 'primary-agent' | 'parallel-agent' | 'unassigned';
  destination: VerifiedDestination | null;
  /** In-repo files that prove the stated status. */
  evidence: readonly RepoPath[];
  engines: readonly EngineReuse[];
  legacyAssets: readonly LegacyAsset[];
  /** Claims a card must NOT make for this offering until evidence exists. */
  mustNotClaim: readonly string[];
  /** The smallest meaningful next implementation step. */
  nextStep: string;
  /** What blocks that step, if anything. */
  blockedBy: string | null;
}

const PROTOTYPE_HOME: RepoPath = 'prototypes/nilesys/public/assets/js/home.js';
const DEMO_SEED: RepoPath = 'engines/platform/src/demo-seed.ts';

const NO_LIVE_DEMO = 'live demo link or "try it" button (no verified destination)';
const NO_WINDOWS_FACTS = 'download size, supported Windows versions, trial length or a download link (no build exists)';

/* ------------------------------------------------------------------ */
/* 7 systems                                                           */
/* ------------------------------------------------------------------ */

export const SYSTEMS = [
  {
    kind: 'system',
    id: 'courts',
    name: { ar: 'حجز الملاعب والبادل', en: 'Courts & Padel Booking' },
    purpose: 'Court/padel slot booking with double-booking prevention, deposits and a club panel.',
    production: 'not-started',
    prototype: 'card-only',
    owner: 'unassigned',
    destination: null,
    evidence: [PROTOTYPE_HOME, DEMO_SEED],
    engines: [
      { path: 'engines/booking/src/booking.ts', provides: 'slot generation, overlap check, booking lifecycle, booking codes, Cairo day grouping' },
      { path: 'engines/booking/src/db/schema.ts', provides: 'tenant-scoped resources/bookings tables' },
    ],
    legacyAssets: [
      { repo: 'starting', path: 'scripts/native-db/', note: 'real-PostgreSQL concurrency harness (client project — reuse code patterns only, never the client name)' },
    ],
    mustNotClaim: [NO_LIVE_DEMO, 'that double booking is prevented by the database (G-10 open: no EXCLUDE constraint)'],
    nextStep: 'Add the booking EXCLUDE constraint (G-10) plus a tenant-scoped booking service with tests; no UI yet.',
    blockedBy: 'STATUS.md task 4 (G-10 migration) — new migrations wait on the POS/payments migration sequence owned by the primary agent.',
  },
  {
    kind: 'system',
    id: 'pos',
    name: { ar: 'نظام الكاشير', en: 'POS System' },
    purpose: 'Barcode/visual selling, shifts and drawer counts, returns, printable receipts.',
    production: 'in-progress',
    prototype: 'working-legacy',
    owner: 'primary-agent',
    destination: null,
    evidence: [
      'engines/transactions/src/sale-service.ts',
      'apps/api/src/controllers.ts',
      'apps/api/test/e2e-sale.test.ts',
      'prototypes/nilesys/public/systems/pos.html',
      'prototypes/nilesys/REVIEW.md',
    ],
    engines: [
      { path: 'engines/transactions/src/sale-service.ts', provides: 'persisted, idempotent, atomic sale with lines, stock movements and audit row' },
      { path: 'engines/transactions/src/cash.ts', provides: 'drawer computation and close difference' },
      { path: 'engines/catalog/src/catalog-service.ts', provides: 'catalog listing for the sale screen' },
    ],
    legacyAssets: [],
    mustNotClaim: [
      NO_LIVE_DEMO,
      'payments, refunds or shifts on the production path (payments engine is on unmerged branch feat/nile-payments-engine)',
      'that the legacy prototype is production (it has 6 confirmed defects in REVIEW.md, reproduced 2026-10-18)',
    ],
    nextStep: 'Owned by the primary agent (payments → payments API → cashier UI). Not in this registry\'s scope.',
    blockedBy: null,
  },
  {
    kind: 'system',
    id: 'inventory',
    name: { ar: 'المخازن والمشتريات', en: 'Inventory & Purchases' },
    purpose: 'Items per warehouse, suppliers and balances, purchase invoices, stock counts.',
    production: 'not-started',
    prototype: 'card-only',
    owner: 'unassigned',
    destination: null,
    evidence: [PROTOTYPE_HOME, DEMO_SEED],
    engines: [
      { path: 'engines/catalog/src/catalog.ts', provides: 'items, variants, stock states' },
      { path: 'engines/transactions/src/costing.ts', provides: 'weighted-average costing' },
    ],
    legacyAssets: [
      { repo: 'Lenastore', path: 'supabase/migrations/', note: 'construction-materials manager; payment idempotency migration' },
    ],
    mustNotClaim: [NO_LIVE_DEMO],
    nextStep: 'Define the purchase-receipt contract (zod) that posts stock movements through the existing transactions engine — after POS stock deduction lands, to share one stock-movement path.',
    blockedBy: 'Stock movement semantics are being changed by the POS work (primary agent).',
  },
  {
    kind: 'system',
    id: 'restaurant',
    name: { ar: 'إدارة المطعم', en: 'Restaurant Management' },
    purpose: 'Floor and tables, kitchen screen, delivery/takeaway, reservations, website orders.',
    production: 'not-started',
    prototype: 'card-only',
    owner: 'unassigned',
    destination: null,
    evidence: [PROTOTYPE_HOME, DEMO_SEED],
    engines: [
      { path: 'engines/transactions/src/sale-service.ts', provides: 'order settlement reuses the sale path' },
      { path: 'engines/booking/src/booking.ts', provides: 'table reservations' },
    ],
    legacyAssets: [],
    mustNotClaim: [NO_LIVE_DEMO, 'a live kitchen screen (no table/ticket model exists)'],
    nextStep: 'Write the domain module for tables and kitchen tickets (pure TS + tests) under a new engine; no UI.',
    blockedBy: null,
  },
  {
    kind: 'system',
    id: 'clinic',
    name: { ar: 'إدارة العيادة', en: 'Clinic Management' },
    purpose: 'Per-doctor schedules, patient files, visits, printed prescriptions, online booking.',
    production: 'not-started',
    prototype: 'card-only',
    owner: 'unassigned',
    destination: null,
    evidence: [PROTOTYPE_HOME, DEMO_SEED],
    engines: [
      { path: 'engines/booking/src/booking.ts', provides: 'doctor slots and appointment lifecycle' },
    ],
    legacyAssets: [
      { repo: 'larabeauty-', path: 'src/domain/visit.ts', note: 'salon visit domain in a Result<T,E> clean-architecture layer (single-centre operations)' },
    ],
    mustNotClaim: [NO_LIVE_DEMO, 'patient records or prescriptions (health data needs a privacy decision first)'],
    nextStep: 'Reuse the courts booking service once G-10 lands; add a patient-file domain only after an owner privacy decision.',
    blockedBy: 'Shares the G-10 booking prerequisite; patient data needs an owner privacy decision.',
  },
  {
    kind: 'system',
    id: 'hr',
    name: { ar: 'الموارد البشرية والمرتبات', en: 'HR & Payroll' },
    purpose: 'Employees, attendance with lateness/overtime, leaves, advances, payroll slips.',
    production: 'in-progress',
    prototype: 'card-only',
    owner: 'parallel-agent',
    destination: null,
    evidence: [PROTOTYPE_HOME, DEMO_SEED, 'engines/people/test/people.test.ts', 'engines/people/src/people-service.ts', 'engines/people/test/people-service.test.ts'],
    engines: [
      { path: 'engines/people/src/attendance.ts', provides: 'work hours, lateness and overtime minutes' },
      { path: 'engines/people/src/payroll.ts', provides: 'leave balances, loan schedules, payslips' },
      { path: 'engines/people/src/db/schema.ts', provides: 'tenant-scoped people tables' },
    ],
    legacyAssets: [
      { repo: 'larabeauty-', path: 'src/domain/attendance.ts', note: 'source of the people engine (see docs/REUSE.md)' },
    ],
    mustNotClaim: [NO_LIVE_DEMO, 'an HR API or screen (service layer only)', 'stored payroll runs or automatic loan deduction (payslips are computed, not persisted)'],
    nextStep: 'Expose the people service through apps/api (employee:manage, attendance:record/read) with an e2e test, once routing changes are coordinated with the POS/payments work.',
    blockedBy: 'apps/api routing is shared with the primary agent\'s payments API.',
  },
  {
    kind: 'system',
    id: 'admin',
    name: { ar: 'لوحة تحكم المواقع', en: 'Websites Control Panel' },
    purpose: 'One back office for all 7 sites: units, gym plans, customer requests inbox, site copy.',
    production: 'in-progress',
    prototype: 'card-only',
    owner: 'parallel-agent',
    destination: null,
    evidence: [PROTOTYPE_HOME, DEMO_SEED, 'engines/catalog/src/lead-service.ts', 'engines/catalog/test/lead-service.test.ts'],
    engines: [
      { path: 'engines/catalog/src/catalog.ts', provides: 'lead pipeline: all 7 site sources → one inbox, stage transitions' },
      { path: 'engines/catalog/src/lead-service.ts', provides: 'tenant-scoped captureLead / listLeads / moveLead' },
    ],
    legacyAssets: [
      { repo: 'platform', path: 'artifacts/api-server/src/trpc/routers/inquiries.ts', note: 'LENA inquiry inbox with rate limiting and admin CRUD — the closest working pattern' },
    ],
    mustNotClaim: [NO_LIVE_DEMO, 'a public lead form or admin inbox screen (service layer only)'],
    nextStep: 'Expose lead capture through apps/api: authenticated list/move (lead:read/manage) plus a public POST whose tenant comes from server-side site config.',
    blockedBy: 'Owner decision: how an anonymous public site resolves its tenant; edge rate limiting. apps/api routing is shared with the payments work.',
  },
] as const satisfies readonly (Offering & { id: SystemId })[];

/* ------------------------------------------------------------------ */
/* 7 websites                                                          */
/* ------------------------------------------------------------------ */

const siteBase = {
  kind: 'site',
  production: 'not-started',
  prototype: 'card-only',
  owner: 'unassigned',
  destination: null,
} as const;

const SITE_NEXT = 'Once the admin lead API is exposed: one static page whose single form posts a lead.';

export const SITES = [
  {
    ...siteBase,
    id: 'courts',
    name: { ar: 'موقع حجز الملاعب', en: 'Courts Booking Site' },
    purpose: 'Pick a court and time, request a booking with price and deposit.',
    evidence: [PROTOTYPE_HOME],
    engines: [{ path: 'engines/booking/src/booking.ts', provides: 'available slots' }],
    legacyAssets: [],
    mustNotClaim: [NO_LIVE_DEMO, 'instant confirmed booking'],
    nextStep: SITE_NEXT,
    blockedBy: 'public lead API; courts booking service (G-10).',
  },
  {
    ...siteBase,
    id: 'restaurant',
    name: { ar: 'موقع مطعم', en: 'Restaurant Site' },
    purpose: 'Photo menu, online ordering with tracking, table booking.',
    evidence: [PROTOTYPE_HOME],
    engines: [{ path: 'engines/catalog/src/catalog.ts', provides: 'menu items and storefront validation' }],
    legacyAssets: [],
    mustNotClaim: [NO_LIVE_DEMO, 'live order tracking'],
    nextStep: SITE_NEXT,
    blockedBy: 'public lead API (tenant resolution decision).',
  },
  {
    ...siteBase,
    id: 'clinic',
    name: { ar: 'موقع عيادة', en: 'Clinic Site' },
    purpose: 'Doctors and specialties, booking from genuinely free slots.',
    evidence: [PROTOTYPE_HOME],
    engines: [{ path: 'engines/booking/src/booking.ts', provides: 'free slots' }],
    legacyAssets: [],
    mustNotClaim: [NO_LIVE_DEMO],
    nextStep: SITE_NEXT,
    blockedBy: 'public lead API; booking service (G-10).',
  },
  {
    ...siteBase,
    id: 'realestate',
    name: { ar: 'موقع عقارات', en: 'Real Estate Site' },
    purpose: 'Search and filters, a page per unit with photos, viewing requests.',
    evidence: [PROTOTYPE_HOME],
    engines: [{ path: 'engines/catalog/src/catalog.ts', provides: 'lead source "realestate"' }],
    legacyAssets: [
      { repo: 'malek', path: 'malek-app/src/services/documents/', note: 'MALEK is a live property-operations app (malek-plus.vercel.app, HTTP 200 on 2026-10-18) — an operator tool, not a public listing site' },
    ],
    mustNotClaim: [NO_LIVE_DEMO, 'that MALEK is this website'],
    nextStep: SITE_NEXT,
    blockedBy: 'public lead API (tenant resolution decision).',
  },
  {
    ...siteBase,
    id: 'gym',
    name: { ar: 'موقع جيم', en: 'Gym Site' },
    purpose: 'Plans and pricing, class schedule, trainers, free trial session.',
    evidence: [PROTOTYPE_HOME],
    engines: [{ path: 'engines/booking/src/booking.ts', provides: 'class slots / trial session' }],
    legacyAssets: [],
    mustNotClaim: [NO_LIVE_DEMO],
    nextStep: SITE_NEXT,
    blockedBy: 'public lead API (tenant resolution decision).',
  },
  {
    ...siteBase,
    id: 'mobile',
    name: { ar: 'موقع محل موبايلات', en: 'Mobile Shop Site' },
    purpose: 'Phones and accessories, cart and orders, installments, trade-in and repairs.',
    evidence: [PROTOTYPE_HOME],
    engines: [{ path: 'engines/catalog/src/catalog.ts', provides: 'variants, stock states, monthly installment calculator' }],
    legacyAssets: [],
    mustNotClaim: [NO_LIVE_DEMO, 'online checkout or payment'],
    nextStep: SITE_NEXT,
    blockedBy: 'public lead API (tenant resolution decision).',
  },
  {
    ...siteBase,
    id: 'fashion',
    name: { ar: 'موقع محل ملابس', en: 'Fashion Store Site' },
    purpose: 'Shoppable lookbook, size stock and calculator, per-governorate shipping.',
    evidence: [PROTOTYPE_HOME],
    engines: [{ path: 'engines/catalog/src/catalog.ts', provides: 'size/colour variants and stock states' }],
    legacyAssets: [
      { repo: 'carmen-gallery-', path: 'src/platform/', note: 'dress showroom & rental app (offline/desktop platform layer) — a rental operator tool, not a storefront' },
    ],
    mustNotClaim: [NO_LIVE_DEMO, 'online checkout or shipping'],
    nextStep: SITE_NEXT,
    blockedBy: 'public lead API (tenant resolution decision).',
  },
] as const satisfies readonly (Offering & { id: SiteId })[];

/* ------------------------------------------------------------------ */
/* 5 Windows entries                                                   */
/* ------------------------------------------------------------------ */

const TAURI_FOUNDATION: readonly LegacyAsset[] = [
  { repo: 'carmen-gallery-', path: 'src-tauri/ + src/platform/desktop/', note: 'Tauri shell with an enforced web/desktop boundary test; bundle targets "all"; 0 GitHub releases, CI builds web only (ubuntu)' },
  { repo: 'larabeauty-', path: 'src-tauri/', note: 'Tauri prototype shell (self-described: SQLite and offline sync not implemented)' },
];

const windowsBase = {
  kind: 'windows',
  production: 'not-started',
  prototype: 'card-only',
  owner: 'unassigned',
  destination: null,
  evidence: [PROTOTYPE_HOME],
  engines: [],
  legacyAssets: TAURI_FOUNDATION,
  mustNotClaim: [NO_WINDOWS_FACTS],
} as const;

const winNext = (system: string) =>
  `None until the ${system} web system exists on the production path; then wrap it in a Tauri shell reusing carmen-gallery-'s desktop boundary. Offline mode needs its own decision.`;

export const WINDOWS = [
  { ...windowsBase, id: 'pos', name: { ar: 'نظام الكاشير', en: 'POS System' }, purpose: 'Desktop packaging of the POS system.', nextStep: winNext('POS'), blockedBy: 'POS UI (primary agent).' },
  { ...windowsBase, id: 'inventory', name: { ar: 'المخازن والمشتريات', en: 'Inventory' }, purpose: 'Desktop packaging of Inventory & Purchases.', nextStep: winNext('inventory'), blockedBy: 'inventory system not started.' },
  { ...windowsBase, id: 'restaurant', name: { ar: 'إدارة المطعم', en: 'Restaurant' }, purpose: 'Desktop packaging of Restaurant Management.', nextStep: winNext('restaurant'), blockedBy: 'restaurant system not started.' },
  { ...windowsBase, id: 'clinic', name: { ar: 'إدارة العيادة', en: 'Clinic' }, purpose: 'Desktop packaging of Clinic Management.', nextStep: winNext('clinic'), blockedBy: 'clinic system not started.' },
  { ...windowsBase, id: 'hr', name: { ar: 'الموارد البشرية والمرتبات', en: 'HR & Payroll' }, purpose: 'Desktop packaging of HR & Payroll.', nextStep: winNext('HR'), blockedBy: 'HR system not started.' },
] as const satisfies readonly (Offering & { id: WindowsId })[];

export const ALL_OFFERINGS: readonly Offering[] = [...SYSTEMS, ...SITES, ...WINDOWS];

/**
 * Claims present in the HISTORICAL prototype that no evidence supports.
 * The test asserts each one is still present; when the prototype (or its
 * successor) is corrected, delete the entry here and the test stays green.
 */
export const UNVERIFIED_PROTOTYPE_CLAIMS = [
  {
    file: PROTOTYPE_HOME,
    excerpt: '89 MB · Windows 10/11',
    why: 'No Windows build, installer, release or packaging config exists in nilesys; size and OS support are unmeasured.',
  },
  {
    file: PROTOTYPE_HOME,
    excerpt: 'days trial',
    why: 'No licensing or trial mechanism exists anywhere in the repository.',
  },
] as const;

/* ------------------------------------------------------------------ */
/* Card status — the only function a presentation layer needs          */
/* ------------------------------------------------------------------ */

export type CardTone = 'available' | 'building' | 'planned';

export interface CardStatus {
  tone: CardTone;
  label: string;
  /** null unless a verified destination exists. */
  href: string | null;
}

const LABELS: Record<CardTone, Record<Locale, string>> = {
  available: { ar: 'متاح للتجربة', en: 'Available to try' },
  building: { ar: 'قيد التنفيذ', en: 'In development' },
  planned: { ar: 'مخطط', en: 'Planned' },
};

/**
 * Honest card status. "available" requires a verified destination — a legacy
 * prototype, a sign-in screen or a card never qualifies.
 */
export function cardStatus(o: Offering, locale: Locale): CardStatus {
  const tone: CardTone = o.destination ? 'available' : o.production === 'in-progress' ? 'building' : 'planned';
  return { tone, label: LABELS[tone][locale], href: o.destination?.url ?? null };
}

export function findOffering(kind: OfferingKind, id: string): Offering | undefined {
  return ALL_OFFERINGS.find((o) => o.kind === kind && o.id === id);
}
