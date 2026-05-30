// [RBAC-010] Tests for the idempotent system-role reconcile function.
//
// These tests verify that reconcileSystemRoles:
//  - calls updateMany for each known system role key with isSystem:true filter
//  - never touches custom roles (isSystem:false is never passed in the where clause)
//  - is idempotent (calling twice produces the same updateMany calls)
//  - returns accurate updated/skipped counts

import { reconcileSystemRoles } from '../../../prisma/reconcile-system-roles';
import { SYSTEM_ROLES } from './permission-catalog';

function makeMockClient(countPerKey = 1) {
  const calls: { key: string; permissions: string[] }[] = [];
  const client = {
    role: {
      updateMany: jest.fn(async (args: {
        where: { key: string; isSystem: boolean };
        data: { permissions: string[] };
      }) => {
        calls.push({ key: args.where.key, permissions: args.data.permissions });
        return { count: countPerKey };
      }),
    },
  };
  return { client, calls };
}

describe('[RBAC-010] reconcileSystemRoles', () => {
  it('calls updateMany once per system role key', async () => {
    const { client } = makeMockClient();
    await reconcileSystemRoles(client);
    expect(client.role.updateMany).toHaveBeenCalledTimes(SYSTEM_ROLES.length);
  });

  it('always filters with isSystem:true — never touches custom roles', async () => {
    const { client } = makeMockClient();
    await reconcileSystemRoles(client);
    for (const call of client.role.updateMany.mock.calls) {
      const args = call[0] as Parameters<typeof client.role.updateMany>[0];
      expect(args.where.isSystem).toBe(true);
    }
  });

  it('passes the catalog preset permissions for each system role', async () => {
    const { client, calls } = makeMockClient();
    await reconcileSystemRoles(client);
    for (const roleDef of SYSTEM_ROLES) {
      const call = calls.find((c) => c.key === roleDef.key);
      expect(call).toBeDefined();
      expect(call!.permissions.sort()).toEqual([...roleDef.permissions].sort());
    }
  });

  it('is idempotent — two calls produce identical updateMany invocations', async () => {
    const { client: c1, calls: calls1 } = makeMockClient();
    const { client: c2, calls: calls2 } = makeMockClient();
    await reconcileSystemRoles(c1);
    await reconcileSystemRoles(c2);
    expect(calls1).toEqual(calls2);
  });

  it('returns updated count equal to count returned by updateMany', async () => {
    const { client } = makeMockClient(1);
    const result = await reconcileSystemRoles(client);
    expect(result.updated).toBe(SYSTEM_ROLES.length);
    expect(result.skipped).toBe(0);
  });

  it('counts skipped roles when updateMany returns count 0 (row not in DB)', async () => {
    const { client } = makeMockClient(0);
    const result = await reconcileSystemRoles(client);
    expect(result.updated).toBe(0);
    expect(result.skipped).toBe(SYSTEM_ROLES.length);
  });
});
