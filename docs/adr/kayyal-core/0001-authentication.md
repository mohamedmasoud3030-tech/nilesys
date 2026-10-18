# ADR-0001 — Hybrid authentication

**Status:** Accepted (supersedes the withdrawn "full custom auth" position) · **Date:** 2026-08-20
**Sources:** PRD FR-13, Part 4 Security · ARCHITECTURE ADR-07

## Context
Two very different actors. The **owner** is a durable identity holding all financial authority. The **operator** is
a fast, disposable unlock on a device that is often shared, standing at a scale with a truck waiting. Treating them
as the same problem produces either an unusable operator flow or a dangerously homemade password system.

## Decision
**Owner → Supabase Auth** (phone + password). Password storage, hashing, verification, token issuance, refresh and
revocation are delegated. We do not reimplement password authentication.

**Operator → a narrow PIN layer, not an auth system.** A row in our database with an Argon2id `pin_hash`;
rate limiting; 5 failures → 15-minute lockout. On success, an **opaque 256-bit random session** in an
`HttpOnly; Secure; SameSite=Lax` cookie, stored server-side **as a hash**, bound to `operator_id + yard_id + expiry`,
rotatable and instantly revocable by the owner. **No custom JWT** — we have no need for a stateless token.

**Authorization context** is derived from the trusted session only and applied transaction-locally.

## Alternatives rejected
- **Full custom auth** — reinvents password handling with real downside and no upside.
- **Supabase Auth for operators** — requires a unique email/phone per operator, breaks fast device switching, makes owner-side instant revocation awkward.
- **Custom JWT for operators** — stateless tokens cannot be revoked instantly; FR-13 requires instant revocation.
- **Device-bound certificates / biometrics** — wrong cost/benefit for a shared cheap Android.

## Consequences
- Two code paths to maintain, behind one `getAuthContext()` boundary.
- Operators are invisible to Supabase Auth; all operator lifecycle is ours (create, deactivate, reset PIN, revoke).
- Owner password reset, MFA and future SSO come free with the provider.

## Reversibility
**Medium-high.** Both halves sit behind a single boundary; either can be replaced without touching domain code.

## Security implications
Operator sessions are the deliberate weak point: short PINs on shared devices. Mitigated by lockout, 12-hour idle
re-auth, instant revocation, hashed session storage, and — most importantly — by an operator being unable to see
any financial figure even when fully authenticated. A stolen operator session leaks today's weights, not the
business.
