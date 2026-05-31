import { presetForRole } from './permission-catalog';

/**
 * Guards the RBAC Phase 2 controller sweep: every permission a migrated endpoint
 * now requires must be held by exactly the roles that the old @Roles allowed, so
 * the migration preserves access. If a preset drifts and drops one of these, the
 * corresponding endpoints would silently 403 for admins — this test catches that.
 */
const has = (roleKey: string, perm: string) =>
  presetForRole(roleKey).includes(perm);

describe('RBAC Phase 2 sweep — permission mappings', () => {
  // Tenant mutations were @Roles(ROOT, TENANT_ADMIN). Mapped permissions must be
  // held by ROOT + TENANT_ADMIN and by NONE of READ_ONLY / GUARD / RESIDENT.
  const TENANT_WRITE = [
    'residents.manage', // residents
    'calendar.manage', // calendar
    'inventory.manage', // inventory + common-areas
    'pettyCash.manage', // petty-cash
    'imports.create', // imports
    'transactions.override', // classification + collection
    'settings.update', // settings + bank-profiles + condominium edit
    'paymentRules.manage', // reconciliation-rules
    'communications.send', // whatsapp
  ];

  it.each(TENANT_WRITE)('%s is held by ROOT and TENANT_ADMIN only', (perm) => {
    expect(has('ROOT', perm)).toBe(true);
    expect(has('TENANT_ADMIN', perm)).toBe(true);
    expect(has('READ_ONLY', perm)).toBe(false);
    expect(has('GUARD', perm)).toBe(false);
    expect(has('RESIDENT', perm)).toBe(false);
  });

  // Platform-admin endpoints were @Roles(ROOT). Read maps to perms ROOT +
  // SUPERVISOR hold (intentional extension; no SUPERVISOR users yet); destructive
  // platform perms stay ROOT-only.
  const PLATFORM_READ = [
    'platform.audit.read', // platform audit
    'platform.condominiums.read', // me-notifications scope
    'platform.systemStatus.read', // system-status
    'platform.storage.read', // storage-admin reads
  ];

  it.each(PLATFORM_READ)('%s is held by ROOT and SUPERVISOR', (perm) => {
    expect(has('ROOT', perm)).toBe(true);
    expect(has('SUPERVISOR', perm)).toBe(true);
    expect(has('READ_ONLY', perm)).toBe(false);
  });

  const PLATFORM_WRITE = [
    'platform.storage.manage', // storage-admin delete
    'platform.condominiums.manage', // condominium create/delete
  ];

  it.each(PLATFORM_WRITE)('%s is held by ROOT only (not SUPERVISOR)', (perm) => {
    expect(has('ROOT', perm)).toBe(true);
    expect(has('SUPERVISOR', perm)).toBe(false);
    expect(has('TENANT_ADMIN', perm)).toBe(false);
  });
});
