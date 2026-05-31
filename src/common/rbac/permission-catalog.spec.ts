import {
  ALL_PERMISSION_KEYS,
  PERMISSION_CATALOG,
  SYSTEM_ROLES,
  isValidPermission,
  presetForRole,
  resolveEffectivePermissions,
  sanitizePermissions,
  unknownPermissions,
} from './permission-catalog';

describe('permission-catalog', () => {
  it('has unique permission keys', () => {
    const set = new Set(ALL_PERMISSION_KEYS);
    expect(set.size).toBe(ALL_PERMISSION_KEYS.length);
  });

  it('keys follow the dotted section[.subsection].action shape', () => {
    for (const def of PERMISSION_CATALOG) {
      expect(def.key).toMatch(/^[a-zA-Z]+(\.[a-zA-Z]+)+$/);
      expect(['tenant', 'platform']).toContain(def.scope);
    }
  });

  it('validates known vs unknown keys', () => {
    expect(isValidPermission('dashboard.read')).toBe(true);
    expect(isValidPermission('does.not.exist')).toBe(false);
    expect(unknownPermissions(['dashboard.read', 'nope.read'])).toEqual([
      'nope.read',
    ]);
  });

  it('sanitizes by dropping unknowns and deduping while preserving order', () => {
    expect(
      sanitizePermissions(['reports.read', 'reports.read', 'x.y', 'dashboard.read']),
    ).toEqual(['reports.read', 'dashboard.read']);
  });

  describe('system roles', () => {
    it('defines exactly the six keyed system roles', () => {
      expect(SYSTEM_ROLES.map((r) => r.key).sort()).toEqual(
        ['GUARD', 'RESIDENT', 'READ_ONLY', 'ROOT', 'SUPERVISOR', 'TENANT_ADMIN'].sort(),
      );
    });

    it('ROOT gets the full catalog', () => {
      expect(presetForRole('ROOT').sort()).toEqual([...ALL_PERMISSION_KEYS].sort());
    });

    it('every system role preset contains only valid catalog keys', () => {
      for (const r of SYSTEM_ROLES) {
        expect(unknownPermissions([...r.permissions])).toEqual([]);
      }
    });

    it('Supervisor can view files but not delete them, and manages users/roles', () => {
      const supervisor = presetForRole('SUPERVISOR');
      expect(supervisor).toContain('files.read');
      expect(supervisor).not.toContain('files.delete');
      expect(supervisor).toContain('platform.users.manage');
      expect(supervisor).toContain('platform.roles.manage');
      expect(supervisor).not.toContain('platform.storage.manage');
    });

    it('Administrator has tenant operation but no platform access', () => {
      const admin = presetForRole('TENANT_ADMIN');
      expect(admin).toContain('residents.manage');
      expect(admin).toContain('settings.update');
      expect(admin.some((k) => k.startsWith('platform.'))).toBe(false);
      expect(admin).not.toContain('files.delete');
    });

    it('Resident/Condomino is read-only', () => {
      const condo = presetForRole('READ_ONLY');
      expect(condo).toContain('dashboard.read');
      expect(condo.every((k) => k.endsWith('.read'))).toBe(true);
    });
  });

  describe('resolveEffectivePermissions', () => {
    it('uses the assigned role row when present (even if empty)', () => {
      expect(
        resolveEffectivePermissions(
          { permissions: ['reports.read'] },
          { roleKey: 'ROOT' },
        ),
      ).toEqual(['reports.read']);
      expect(
        resolveEffectivePermissions({ permissions: [] }, { roleKey: 'ROOT' }),
      ).toEqual([]);
    });

    it('falls back to the enum preset when no role row (pre-backfill)', () => {
      expect(
        resolveEffectivePermissions(null, { roleKey: 'READ_ONLY' }),
      ).toEqual(presetForRole('READ_ONLY'));
    });

    it('drops unknown keys coming from a stored role', () => {
      expect(
        resolveEffectivePermissions(
          { permissions: ['dashboard.read', 'legacy.key'] },
          { roleKey: 'TENANT_ADMIN' },
        ),
      ).toEqual(['dashboard.read']);
    });

    describe('per-user overrides (RBAC Phase 3)', () => {
      it('overrides take precedence over the role when non-null', () => {
        expect(
          resolveEffectivePermissions(
            { permissions: ['dashboard.read', 'reports.read'] },
            { overrides: ['audit.read'] },
          ),
        ).toEqual(['audit.read']);
      });

      it('an empty override array grants nothing (distinct from inherit)', () => {
        expect(
          resolveEffectivePermissions(
            { permissions: ['dashboard.read'] },
            { overrides: [] },
          ),
        ).toEqual([]);
      });

      it('null/undefined overrides inherit the role', () => {
        expect(
          resolveEffectivePermissions(
            { permissions: ['dashboard.read'] },
            { overrides: null },
          ),
        ).toEqual(['dashboard.read']);
        expect(
          resolveEffectivePermissions({ permissions: ['dashboard.read'] }),
        ).toEqual(['dashboard.read']);
      });

      it('sanitises unknown keys out of overrides', () => {
        expect(
          resolveEffectivePermissions(null, {
            overrides: ['reports.read', 'legacy.key'],
          }),
        ).toEqual(['reports.read']);
      });
    });
  });
});
