/**
 * Boot-safety guard for commercial deployments (G-16).
 *
 * The demo tenant (public password `demo1234`, seeded from demo-seed.ts) is a
 * development/showcase convenience ONLY. In a customer's production deployment
 * those accounts must never exist, so production boot:
 *   - refuses to seed the demo tenant (even if asked),
 *   - requires a real auth secret,
 *   - requires a real PostgreSQL DATABASE_URL (PGlite is dev/test only).
 * Development keeps the demo seed by default (opt out with NILE_SEED_DEMO=0)
 * so local testing stays one command — against an isolated dev database,
 * never customer data.
 */
export interface BootSafety {
  production: boolean;
  seedDemo: boolean;
}

export function assertBootSafety(env: NodeJS.ProcessEnv): BootSafety {
  const production = env.NODE_ENV === 'production';
  const seedFlag = env.NILE_SEED_DEMO;

  if (production) {
    if (seedFlag === '1') {
      throw new Error('NILE_SEED_DEMO=1 is forbidden in production: demo accounts must never be seeded into a customer database.');
    }
    if (!env.BETTER_AUTH_SECRET) {
      throw new Error('BETTER_AUTH_SECRET is required in production');
    }
    if (!env.DATABASE_URL) {
      throw new Error('DATABASE_URL is required in production (embedded PGlite is for development/tests only)');
    }
    return { production: true, seedDemo: false };
  }

  // Development / test: demo seed ON unless explicitly disabled.
  return { production: false, seedDemo: seedFlag !== '0' };
}
