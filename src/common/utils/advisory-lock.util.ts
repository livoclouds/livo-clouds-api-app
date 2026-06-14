import { Prisma } from '@prisma/client';

/**
 * Minimal Prisma surface this util needs — the interactive `$transaction`
 * overload. Declared structurally so the util has no dependency on the Nest
 * `PrismaService`; both `PrismaService` and a raw `PrismaClient` satisfy it.
 */
export type AdvisoryLockPrisma = {
  $transaction<R>(
    fn: (tx: Prisma.TransactionClient) => Promise<R>,
    options?: {
      maxWait?: number;
      timeout?: number;
      isolationLevel?: Prisma.TransactionIsolationLevel;
    },
  ): Promise<R>;
};

export type TryAdvisoryLockOutcome<T> =
  | { acquired: true; result: T }
  | { acquired: false };

/**
 * Run `fn` while holding a Postgres advisory lock keyed by (key1, key2),
 * claimed with the NON-BLOCKING `pg_try_advisory_xact_lock`. If another DB
 * connection already holds the lock, `fn` is NOT run and `{ acquired: false }`
 * is returned — the caller decides whether to skip (cron leadership) or requeue
 * (reclassify contention).
 *
 * Why this shape:
 *  - **Transaction-scoped** (`_xact_` variant): the lock auto-releases at
 *    commit/rollback, and the acquire runs on the single connection Prisma pins
 *    for the interactive transaction — so there is no cross-connection release
 *    leak, the hazard of session-level `pg_advisory_lock` under a pool.
 *  - **Try, not block**: callers want to step aside when another replica holds
 *    the lock, not queue behind it.
 *
 * Gotcha: the interactive transaction stays open (idle on its own connection)
 * for the whole duration of `fn`, which typically runs its OWN writes on other
 * pooled connections. Pass a `timeoutMs` generous enough to cover `fn`, or
 * Prisma's default 5s interactive-transaction timeout aborts it.
 *
 * Keys: pass `key1`/`key2` as SQL fragments resolving to int4 — e.g.
 * ``Prisma.sql`hashtext(${someText})` `` (hashtext returns int4). This selects
 * the two-arg `pg_try_advisory_xact_lock(int4, int4)` overload and sidesteps
 * the bigint-binding ambiguity of JS-number keys (mirrors the `::int4` cast in
 * summary-recompute.service.ts, the codebase's other advisory-lock use).
 */
export async function withTryAdvisoryXactLock<T>(
  prisma: AdvisoryLockPrisma,
  key1: Prisma.Sql,
  key2: Prisma.Sql,
  fn: () => Promise<T>,
  options?: { timeoutMs?: number },
): Promise<TryAdvisoryLockOutcome<T>> {
  return prisma.$transaction(
    async (tx) => {
      const rows = await tx.$queryRaw<Array<{ locked: boolean }>>(
        Prisma.sql`SELECT pg_try_advisory_xact_lock(${key1}, ${key2}) AS locked`,
      );
      if (!rows[0]?.locked) {
        return { acquired: false as const };
      }
      const result = await fn();
      return { acquired: true as const, result };
    },
    options?.timeoutMs ? { timeout: options.timeoutMs } : undefined,
  );
}
