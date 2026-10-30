/**
 * Roles & permissions — Better Auth Organization access control (ADR-0007).
 * Not a custom RBAC system: statements/roles are declared with Better Auth's
 * `createAccessControl`, stored as `member.role`, and evaluated server-side.
 *
 * Permission = resource + action. Product roles mirror the demo accounts in
 * ../demo-seed.ts (one demo login per role, unified password).
 */
import { createAccessControl } from 'better-auth/plugins/access';
import { defaultStatements, adminAc, memberAc, ownerAc } from 'better-auth/plugins/organization/access';

export const statement = {
  ...defaultStatements,
  sale: ['create', 'read', 'void'],
  catalog: ['read', 'manage'],
  stock: ['read', 'adjust'],
  booking: ['create', 'read', 'manage'],
  lead: ['read', 'manage'],
  employee: ['read', 'manage'],
  attendance: ['record', 'read'],
  audit: ['read'],
  /*
   * D-D (ADOPTED for commercial V1, owner decision 2026-10-26 — see
   * docs/DECISIONS.md): financial/admin reports have their own permission so
   * reading a sale (sale:read, needed by cashiers for receipts) never implies
   * reading store revenue figures. History: prepared as a proposal in commit
   * 4153240, adopted as V1 policy at the final release gate.
   */
  report: ['read'],
} as const;

export const ac = createAccessControl(statement);

const all = {
  sale: ['create', 'read', 'void'],
  catalog: ['read', 'manage'],
  stock: ['read', 'adjust'],
  booking: ['create', 'read', 'manage'],
  lead: ['read', 'manage'],
  employee: ['read', 'manage'],
  attendance: ['record', 'read'],
  audit: ['read'],
  report: ['read'],
} as const;

export const roles = {
  owner: ac.newRole({ ...ownerAc.statements, ...all }),
  admin: ac.newRole({ ...adminAc.statements, ...all }),
  member: ac.newRole({ ...memberAc.statements }),

  // POS
  // report:read is granted ONLY to branch-manager among POS roles (D-D, adopted V1).
  'branch-manager': ac.newRole({ sale: ['create', 'read', 'void'], catalog: ['read', 'manage'], stock: ['read', 'adjust'], audit: ['read'], report: ['read'] }),
  cashier: ac.newRole({ sale: ['create', 'read'], catalog: ['read'], stock: ['read'] }),
  // Inventory
  'inventory-manager': ac.newRole({ catalog: ['read', 'manage'], stock: ['read', 'adjust'], sale: ['read'] }),
  storekeeper: ac.newRole({ catalog: ['read'], stock: ['read', 'adjust'] }),
  // Restaurant
  'restaurant-manager': ac.newRole({ sale: ['create', 'read', 'void'], catalog: ['read', 'manage'], booking: ['create', 'read', 'manage'] }),
  waiter: ac.newRole({ sale: ['create', 'read'], catalog: ['read'], booking: ['create', 'read'] }),
  kitchen: ac.newRole({ sale: ['read'], catalog: ['read'] }),
  // Clinic
  'clinic-manager': ac.newRole({ booking: ['create', 'read', 'manage'], sale: ['create', 'read', 'void'], audit: ['read'] }),
  reception: ac.newRole({ booking: ['create', 'read', 'manage'], sale: ['create', 'read'] }),
  doctor: ac.newRole({ booking: ['read'] }),
  // HR
  'hr-manager': ac.newRole({ employee: ['read', 'manage'], attendance: ['record', 'read'], audit: ['read'] }),
  employee: ac.newRole({ attendance: ['record'] }),
  // Courts
  'courts-manager': ac.newRole({ booking: ['create', 'read', 'manage'], sale: ['create', 'read'] }),
  // Public-sites admin
  'site-admin': ac.newRole({ lead: ['read', 'manage'], catalog: ['read', 'manage'], booking: ['read'] }),
};

export type RoleName = keyof typeof roles;
type Statement = typeof statement;
export type PermissionRequest = { [K in keyof Statement]?: Array<Statement[K][number]> };

/**
 * Server-side check. Better Auth stores multiple roles comma-separated;
 * access is granted if ANY held role grants the full request.
 * Unknown role names grant nothing (fail closed).
 */
export function can(roleField: string, request: PermissionRequest): boolean {
  return roleField
    .split(',')
    .map((r) => r.trim())
    .some((r) => {
      const role = (roles as Record<string, (typeof roles)[RoleName] | undefined>)[r];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return role ? role.authorize(request as any).success : false;
    });
}

/** Flattened list for the UI (e.g. "sale:create"). Display only — never trusted. */
export function permissionsOf(roleField: string): string[] {
  const out: string[] = [];
  for (const [resource, actions] of Object.entries(all)) {
    for (const action of actions) {
      if (can(roleField, { [resource]: [action] } as PermissionRequest)) out.push(`${resource}:${action}`);
    }
  }
  return out;
}
