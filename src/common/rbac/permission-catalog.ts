/**
 * Dynamic RBAC — single source of truth for the permission catalog and the
 * system-role presets (RBAC Phase 1).
 *
 * Permissions are CODE, not data: every key maps to a real guard check, so new
 * permissions ship with code. Roles are DATA (the `roles` table): the 5+1 system
 * roles below are seeded, and new custom roles can be created from the UI by
 * combining existing permission keys.
 *
 * Keys are `section[.subsection].action`. The flat key is what gets stored on a
 * role and checked by the guard; `section`/`subsection` only drive the grouped
 * UI tree. Growing the app = add entries here (+ the matching guard checks);
 * existing roles simply lack the new key until it is granted.
 *
 * This module has NO framework dependencies so it can be imported by the seed,
 * services, guards, and mirrored to the web client.
 */

export type PermissionScope = 'tenant' | 'platform';

export interface PermissionDef {
  /** Flat dotted key — stored on roles and checked by the guard. */
  key: string;
  /** Top-level grouping for the UI tree (i18n key: `rbac.section.<section>`). */
  section: string;
  /** Optional second-level grouping. */
  subsection?: string;
  /** Action verb (read/create/manage/...) — i18n key: `rbac.action.<action>`. */
  action: string;
  /** Tenant-scoped vs platform-wide (cross-condominium / technical). */
  scope: PermissionScope;
}

const p = (
  key: string,
  section: string,
  action: string,
  scope: PermissionScope,
  subsection?: string,
): PermissionDef => ({ key, section, action, scope, subsection });

// ─── Catalog ──────────────────────────────────────────────────────────────────
export const PERMISSION_CATALOG: readonly PermissionDef[] = [
  // Tenant — operational modules
  p('dashboard.read', 'dashboard', 'read', 'tenant'),

  p('imports.read', 'imports', 'read', 'tenant'),
  p('imports.create', 'imports', 'create', 'tenant'),

  p('transactions.read', 'transactions', 'read', 'tenant'),
  p('transactions.override', 'transactions', 'override', 'tenant'),

  p('reports.read', 'reports', 'read', 'tenant'),

  p('residents.read', 'residents', 'read', 'tenant'),
  p('residents.manage', 'residents', 'manage', 'tenant'),
  // Resident dossier (antecedentes) — Capa 2. Three view tiers gate per-record
  // confidentiality (STANDARD / RESTRICTED / LEGAL_CONFIDENTIAL); `manage`
  // covers create/edit/delete. Distinct action verbs (not `read`) keep them out
  // of the broad READ() sweep so each role is granted them explicitly.
  p('residents.dossier.view', 'residents', 'view', 'tenant', 'dossier'),
  p('residents.dossier.viewRestricted', 'residents', 'viewRestricted', 'tenant', 'dossier'),
  p('residents.dossier.viewLegal', 'residents', 'viewLegal', 'tenant', 'dossier'),
  p('residents.dossier.manage', 'residents', 'manage', 'tenant', 'dossier'),
  // ARCO export (Capa 2C) — per-resident dossier export. A read verb, not a
  // write one, so an auditor can export for compliance without edit rights; it
  // still respects the exporter's confidentiality tier in the service.
  p('residents.dossier.export', 'residents', 'export', 'tenant', 'dossier'),
  // ARCO subject packet (Capa 2D) — the resident's own personal data compiled
  // for an LFPDPPP "Acceso" request. A compliance action (admin/root), audited
  // separately from the internal export; the packet excludes LEGAL_CONFIDENTIAL.
  p('residents.dossier.exportArco', 'residents', 'exportArco', 'tenant', 'dossier'),
  // ARCO data-subject request tracker (Capa 2F) — log + track LFPDPPP
  // Acceso/Rectificación/Cancelación/Oposición requests. `view` is a read verb
  // (auditor/supervisor can oversee compliance); `manage` covers create/track/resolve.
  p('residents.arco.view', 'residents', 'view', 'tenant', 'arco'),
  p('residents.arco.manage', 'residents', 'manage', 'tenant', 'arco'),

  p('calendar.read', 'calendar', 'read', 'tenant'),
  p('calendar.manage', 'calendar', 'manage', 'tenant'),
  // Visibility tiers (Phase 4 — CAL-001/032). Distinct action verbs (NOT `read`)
  // keep them out of the broad READ() sweep, so each role is granted them
  // explicitly. They gate which CalendarEventVisibility levels a caller can see:
  // viewCouncil → +COUNCIL_ONLY, viewPrivate → +PRIVATE. `calendar.manage` already
  // implies full visibility (a manager must see what it can edit). visibility.util.ts.
  p('calendar.viewCouncil', 'calendar', 'viewCouncil', 'tenant'),
  p('calendar.viewPrivate', 'calendar', 'viewPrivate', 'tenant'),

  p('communications.read', 'communications', 'read', 'tenant'),
  p('communications.send', 'communications', 'send', 'tenant'),

  p('notifications.read', 'notifications', 'read', 'tenant'),
  p('notifications.manage', 'notifications', 'manage', 'tenant'),

  p('inventory.read', 'inventory', 'read', 'tenant'),
  p('inventory.manage', 'inventory', 'manage', 'tenant'),

  p('suppliers.read', 'suppliers', 'read', 'tenant'),
  p('suppliers.manage', 'suppliers', 'manage', 'tenant'),

  p('pettyCash.read', 'pettyCash', 'read', 'tenant'),
  p('pettyCash.manage', 'pettyCash', 'manage', 'tenant'),

  p('quotations.read', 'quotations', 'read', 'tenant'),
  p('quotations.manage', 'quotations', 'manage', 'tenant'),

  p('files.read', 'files', 'read', 'tenant'),
  p('files.upload', 'files', 'upload', 'tenant'),
  p('files.delete', 'files', 'delete', 'tenant'),

  p('settings.read', 'settings', 'read', 'tenant'),
  p('settings.update', 'settings', 'update', 'tenant'),
  p('paymentRules.manage', 'settings', 'manage', 'tenant', 'paymentRules'),

  p('users.read', 'users', 'read', 'tenant'),
  p('users.manage', 'users', 'manage', 'tenant'),
  p('users.permissions.manage', 'users', 'manage', 'tenant', 'permissions'),

  p('audit.read', 'audit', 'read', 'tenant'),

  // Seguridad (RBAC Phase 4) — gate / security operations
  p('security.visitors.read', 'security', 'read', 'tenant', 'visitors'),
  p('security.visitors.manage', 'security', 'manage', 'tenant', 'visitors'),

  // Platform — cross-condominium / technical
  p('platform.condominiums.read', 'platform', 'read', 'platform', 'condominiums'),
  p('platform.condominiums.manage', 'platform', 'manage', 'platform', 'condominiums'),
  p('platform.users.manage', 'platform', 'manage', 'platform', 'users'),
  p('platform.roles.manage', 'platform', 'manage', 'platform', 'roles'),
  p('platform.systemStatus.read', 'platform', 'read', 'platform', 'systemStatus'),
  p('platform.storage.read', 'platform', 'read', 'platform', 'storage'),
  p('platform.storage.manage', 'platform', 'manage', 'platform', 'storage'),
  p('platform.audit.read', 'platform', 'read', 'platform', 'audit'),
] as const;

export const ALL_PERMISSION_KEYS: readonly string[] = PERMISSION_CATALOG.map(
  (d) => d.key,
);

const PERMISSION_KEY_SET = new Set(ALL_PERMISSION_KEYS);

/** True when `key` is a known catalog permission. */
export function isValidPermission(key: string): boolean {
  return PERMISSION_KEY_SET.has(key);
}

/** Dedupe + drop unknown keys; used to sanitise role.permissions on write. */
export function sanitizePermissions(keys: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const k of keys) {
    if (PERMISSION_KEY_SET.has(k) && !seen.has(k)) {
      seen.add(k);
      out.push(k);
    }
  }
  return out;
}

/** Keys not present in the catalog — for validation error messages. */
export function unknownPermissions(keys: string[]): string[] {
  return keys.filter((k) => !PERMISSION_KEY_SET.has(k));
}

// ─── System roles ───────────────────────────────────────────────────────────
// Keys are kept stable and aligned to the existing UserRole enum (+ SUPERVISOR)
// to minimise migration blast radius. Display names are resolved via i18n on the
// web (`rbac.role.<key>`); `name` here is only a fallback / seed value.
export type SystemRoleKey =
  | 'ROOT'
  | 'SUPERVISOR'
  | 'TENANT_ADMIN'
  | 'READ_ONLY'
  | 'GUARD'
  | 'RESIDENT';

export interface SystemRoleDef {
  key: SystemRoleKey;
  /** Fallback display name (i18n overrides this on the web). */
  name: string;
  description: string;
  /** Preset permission keys. ROOT is computed as the full catalog. */
  permissions: readonly string[];
}

const READ = (scope?: PermissionScope) =>
  PERMISSION_CATALOG.filter(
    (d) => d.action === 'read' && (scope ? d.scope === scope : true),
  ).map((d) => d.key);

const ALL_TENANT = PERMISSION_CATALOG.filter((d) => d.scope === 'tenant').map(
  (d) => d.key,
);

// Administrador: full tenant operation, no platform, no destructive file delete.
const ADMIN_PERMS = ALL_TENANT.filter(
  (k) => k !== 'files.delete' && k !== 'users.permissions.manage',
);

// Supervisor: oversees admins across condominiums. Broad read + user/role admin,
// can view files but NOT delete; no day-to-day operational manage, no storage
// management, no condominium creation.
const SUPERVISOR_PERMS = [
  ...READ('tenant'),
  // Calendar oversight (CAL-067): viewCouncil tier so the supervisor sees PUBLIC +
  // COUNCIL_ONLY governance events — at least parity with the READ_ONLY auditor it
  // oversees. NOT viewPrivate: oversight does not extend to residents' PRIVATE
  // personal bookings. (viewCouncil's action is 'viewCouncil', so the READ() sweep
  // above does not grant it — it must be listed explicitly.)
  'calendar.viewCouncil',
  // Dossier: standard + restricted (NOT legal-confidential, NOT manage).
  'residents.dossier.view',
  'residents.dossier.viewRestricted',
  // ARCO request tracker: oversight (view), no manage.
  'residents.arco.view',
  'files.read',
  'audit.read',
  'platform.condominiums.read',
  'platform.users.manage',
  'platform.roles.manage',
  'platform.systemStatus.read',
  'platform.storage.read',
  'platform.audit.read',
];

// Auditor (READ_ONLY): council/auditor read-only access to condominium data.
const CONDOMINO_PERMS = [
  'dashboard.read',
  'reports.read',
  'calendar.read',
  // Auditor/council read-only sees PUBLIC + COUNCIL_ONLY calendar events (not
  // PRIVATE). Distinct from calendar.read so a custom resident-equivalent role
  // does not inherit it (Phase 4 — CAL-001).
  'calendar.viewCouncil',
  'notifications.read',
  // Auditor sees STANDARD dossier entries only — not RESTRICTED or LEGAL_CONFIDENTIAL.
  // Aligns with dossier-filters.ts which already gates read_only to STANDARD-only.
  // Phase 5 audit (RP-008): viewRestricted removed to close the API/UI mismatch.
  'residents.dossier.view',
  // ARCO export for compliance — read-only, scoped to the auditor's view tier.
  'residents.dossier.export',
  // ARCO request tracker: oversight (view), no manage.
  'residents.arco.view',
];

// Seguridad (GUARD): gate operation. Operates the visitor log; reads the
// resident/calendar/inventory directories it needs at the gate.
const SECURITY_PERMS = [
  'residents.read',
  'calendar.read',
  'inventory.read',
  'notifications.read',
  'security.visitors.read',
  'security.visitors.manage',
];

// Residente (RESIDENT): unit resident — calendar bookings and notifications.
const RESIDENT_PERMS = ['calendar.read', 'notifications.read'];

export const SYSTEM_ROLES: readonly SystemRoleDef[] = [
  {
    key: 'ROOT',
    name: 'Root',
    description: 'Platform root — full technical and platform access.',
    permissions: ALL_PERMISSION_KEYS,
  },
  {
    key: 'SUPERVISOR',
    name: 'Supervisor',
    description:
      'Oversees administrators across condominiums; manages users and roles, views files (no delete).',
    permissions: sanitizePermissions(SUPERVISOR_PERMS),
  },
  {
    key: 'TENANT_ADMIN',
    name: 'Administrator',
    description: 'Condominium administrator — full day-to-day operation of one condominium.',
    permissions: sanitizePermissions(ADMIN_PERMS),
  },
  {
    key: 'READ_ONLY',
    name: 'Auditor',
    description: 'Condominium auditor — read-only access to reports, dashboard, and calendar.',
    permissions: sanitizePermissions(CONDOMINO_PERMS),
  },
  {
    key: 'GUARD',
    name: 'Security',
    description: 'Security / gate personnel — operational read access.',
    permissions: sanitizePermissions(SECURITY_PERMS),
  },
  {
    key: 'RESIDENT',
    name: 'Resident',
    description: 'Unit resident — calendar bookings, notifications, and future interactive features.',
    permissions: sanitizePermissions(RESIDENT_PERMS),
  },
] as const;

const SYSTEM_ROLE_BY_KEY = new Map<string, SystemRoleDef>(
  SYSTEM_ROLES.map((r) => [r.key, r]),
);

/** Preset permissions for a system role key (empty array if unknown). */
export function presetForRole(key: string): string[] {
  return [...(SYSTEM_ROLE_BY_KEY.get(key)?.permissions ?? [])];
}

/** True if a permission key grants platform-wide (cross-condominium) capability. */
export function isPlatformPermission(key: string): boolean {
  return key.startsWith('platform.');
}

/**
 * Effective permissions for a user (RBAC Phase 3).
 *
 * Precedence:
 *  1. Per-user `overrides` — when non-null, they ARE the effective set,
 *     independent of the role (a custom override for this single user).
 *  2. The assigned Role row (`roleRef`) — the source of truth otherwise, even an
 *     empty set (a custom role with nothing granted yet).
 *  3. `roleKey` preset — a legacy fallback used only by tests/back-compat callers
 *     that pass a system key without a row; runtime callers omit it (every user
 *     is backfilled).
 *
 * `overrides`/`roleKey` are passed via the options bag so the common 1-arg call
 * `resolveEffectivePermissions(user.roleRef)` stays unchanged.
 */
export function resolveEffectivePermissions(
  roleRef: { permissions: string[] } | null | undefined,
  options?: { overrides?: string[] | null; roleKey?: string },
): string[] {
  if (options?.overrides != null) return sanitizePermissions(options.overrides);
  if (roleRef) return sanitizePermissions(roleRef.permissions);
  return options?.roleKey ? presetForRole(options.roleKey) : [];
}
