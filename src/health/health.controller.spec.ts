import 'reflect-metadata';
import { ServiceUnavailableException } from '@nestjs/common';
import {
  HealthController,
  READINESS_TIMEOUT_MS,
} from './health.controller';
import { PrismaService } from '../prisma/prisma.service';

/**
 * ERR-002: `/health` is a liveness probe (always 200, no DB) and must stay that
 * way, while the new `/health/ready` is a true readiness probe that runs a cheap
 * `SELECT 1` and reports 503 when the database is unreachable or slow. The web
 * app polls readiness (not liveness) to decide an outage has recovered, so this
 * distinction is the whole point of the finding.
 */
describe('HealthController', () => {
  let prisma: { $queryRaw: jest.Mock };
  let controller: HealthController;

  beforeEach(() => {
    prisma = { $queryRaw: jest.fn() };
    controller = new HealthController(prisma as unknown as PrismaService);
  });

  describe('check() — liveness', () => {
    it('returns ok unconditionally and never touches the database', () => {
      const result = controller.check();
      expect(result.status).toBe('ok');
      expect(typeof result.timestamp).toBe('string');
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });
  });

  describe('ready() — readiness', () => {
    it('returns ready when the SELECT 1 round-trip succeeds', async () => {
      prisma.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);
      await expect(controller.ready()).resolves.toEqual({ status: 'ready' });
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    });

    it('throws 503 not_ready (db_unreachable) when the query rejects', async () => {
      prisma.$queryRaw.mockRejectedValue(new Error('connection refused'));
      await expect(controller.ready()).rejects.toMatchObject({
        constructor: ServiceUnavailableException,
      });
      try {
        await controller.ready();
      } catch (err) {
        expect(err).toBeInstanceOf(ServiceUnavailableException);
        expect((err as ServiceUnavailableException).getResponse()).toEqual({
          status: 'not_ready',
          reason: 'db_unreachable',
        });
      }
    });

    it('throws 503 not_ready (timeout) when the query hangs past the timeout', async () => {
      jest.useFakeTimers();
      // Never resolves — the timeout race must win.
      prisma.$queryRaw.mockReturnValue(new Promise(() => {}));
      const pending = controller.ready();
      // Surface the rejection so the unhandled-rejection guard stays quiet.
      const assertion = expect(pending).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
      await jest.advanceTimersByTimeAsync(READINESS_TIMEOUT_MS);
      await assertion;
      jest.useRealTimers();
    });
  });
});
