import { Prisma } from '@prisma/client';
import { withTryAdvisoryXactLock } from './advisory-lock.util';

interface TxMock {
  $queryRaw: jest.Mock;
}

/**
 * Emulates Prisma's interactive `$transaction(fn, options)` overload: runs the
 * callback with a tx whose `$queryRaw` returns the lock probe row.
 */
function makePrisma(locked: boolean) {
  const tx: TxMock = { $queryRaw: jest.fn().mockResolvedValue([{ locked }]) };
  const $transaction = jest.fn(async (fn: (t: TxMock) => Promise<unknown>) => fn(tx));
  return { prisma: { $transaction } as never, tx, $transaction };
}

describe('withTryAdvisoryXactLock', () => {
  it('runs fn and returns its result when the lock is acquired', async () => {
    const { prisma } = makePrisma(true);
    const fn = jest.fn().mockResolvedValue('done');

    const outcome = await withTryAdvisoryXactLock(
      prisma,
      Prisma.sql`hashtext(${'ns'})`,
      Prisma.sql`hashtext(${'key'})`,
      fn,
    );

    expect(outcome).toEqual({ acquired: true, result: 'done' });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('does NOT run fn and returns acquired:false when the lock is held elsewhere', async () => {
    const { prisma } = makePrisma(false);
    const fn = jest.fn();

    const outcome = await withTryAdvisoryXactLock(
      prisma,
      Prisma.sql`hashtext(${'ns'})`,
      Prisma.sql`hashtext(${'key'})`,
      fn,
    );

    expect(outcome).toEqual({ acquired: false });
    expect(fn).not.toHaveBeenCalled();
  });

  it('probes with pg_try_advisory_xact_lock and forwards the timeout option', async () => {
    const { prisma, tx, $transaction } = makePrisma(true);

    await withTryAdvisoryXactLock(
      prisma,
      Prisma.sql`hashtext(${'ns'})`,
      Prisma.sql`hashtext(${'key'})`,
      async () => undefined,
      { timeoutMs: 60_000 },
    );

    const sql = tx.$queryRaw.mock.calls[0][0] as Prisma.Sql;
    expect(sql.sql).toContain('pg_try_advisory_xact_lock');
    // The options arg is captured by jest regardless of the mock's declared
    // arity — cast past the 1-param callback tuple type to read it.
    expect(($transaction.mock.calls[0] as unknown[])[1]).toEqual({ timeout: 60_000 });
  });

  it('propagates a throw from fn (lock auto-released on rollback)', async () => {
    const { prisma } = makePrisma(true);
    const boom = new Error('boom');

    await expect(
      withTryAdvisoryXactLock(
        prisma,
        Prisma.sql`hashtext(${'ns'})`,
        Prisma.sql`hashtext(${'key'})`,
        () => Promise.reject(boom),
      ),
    ).rejects.toThrow('boom');
  });
});
