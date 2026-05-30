/**
 * [RBAC-010] Idempotent system-role reconcile script.
 *
 * Applies the current permission-catalog presets to existing system role rows
 * (isSystem=true). Safe to run multiple times. Custom tenant roles (isSystem=false)
 * are never touched. Run this after any deploy that adds new catalog permissions.
 *
 * Usage:
 *   pnpm prisma:reconcile-system-roles
 *
 * Prerequisites: DATABASE_URL must point to the target database.
 */

import { PrismaClient } from '@prisma/client';
import { SYSTEM_ROLES } from '../src/common/rbac/permission-catalog';

/** Minimal Prisma shape needed by reconcile — injectable for testing. */
export interface ReconcileClient {
  role: {
    updateMany: (args: {
      where: { key: string; isSystem: boolean };
      data: { permissions: string[] };
    }) => Promise<{ count: number }>;
  };
}

/**
 * Reconciles system-role rows with the current permission-catalog presets.
 * Only rows with isSystem=true are updated; custom roles are untouched.
 */
export async function reconcileSystemRoles(
  client: ReconcileClient,
): Promise<{ updated: number; skipped: number }> {
  let updated = 0;
  let skipped = 0;

  for (const roleDef of SYSTEM_ROLES) {
    const preset = [...roleDef.permissions];
    const result = await client.role.updateMany({
      where: { key: roleDef.key, isSystem: true },
      data: { permissions: preset },
    });

    if (result.count > 0) {
      console.log(`  ✅ ${roleDef.key}: updated ${result.count} row(s)`);
      updated += result.count;
    } else {
      console.log(`  ⏭️  ${roleDef.key}: no matching system role row found (skipped)`);
      skipped++;
    }
  }

  return { updated, skipped };
}

async function main() {
  const prisma = new PrismaClient();
  console.log('[RBAC-010] Reconciling system-role permission presets...');
  try {
    const { updated, skipped } = await reconcileSystemRoles(prisma as unknown as ReconcileClient);
    console.log(`\nDone. ${updated} role(s) updated, ${skipped} role key(s) skipped (not present in DB).`);
    console.log('Custom tenant roles were not modified.');
  } finally {
    await prisma.$disconnect();
  }
}

// Only run when invoked directly (not imported by tests).
if (require.main === module) {
  main().catch((err) => {
    console.error('[RBAC-010] Reconcile failed:', err);
    process.exit(1);
  });
}
