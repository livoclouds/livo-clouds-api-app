import { ArcoDeadlineCron } from './arco-deadline.cron';

const NOW = new Date('2026-06-30T12:00:00.000Z');

function makeCron() {
  const prisma = {
    arcoRequest: {
      findMany: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    },
    arcoRequestEvent: { create: jest.fn().mockResolvedValue({}) },
  };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const notifications = {
    dispatchEvent: jest.fn().mockResolvedValue({ recipientCount: 2 }),
  };
  const cron = new ArcoDeadlineCron(
    prisma as never,
    audit as never,
    notifications as never,
  );
  return { cron, prisma, audit, notifications };
}

describe('ArcoDeadlineCron', () => {
  it('flags a newly overdue request and alerts the admins, once', async () => {
    const { cron, prisma, audit, notifications } = makeCron();
    prisma.arcoRequest.findMany
      // pass 1 — overdue
      .mockResolvedValueOnce([
        {
          id: 'arco-1',
          condominiumId: 'c1',
          residentId: 'r1',
          dueDate: new Date('2026-06-20T00:00:00.000Z'),
        },
      ])
      // pass 2 — escalation candidates
      .mockResolvedValueOnce([]);

    const result = await cron.sweep(NOW);

    expect(result.overdueFlagged).toBe(1);
    expect(prisma.arcoRequestEvent.create.mock.calls[0][0].data.type).toBe('OVERDUE');
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'ARCO_OVERDUE', result: 'WARNING' }),
    );
    expect(notifications.dispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'ARCO_OVERDUE', condominiumId: 'c1' }),
    );
    expect(result.adminNotified).toBe(2);
    // The overdue query must exclude already-flagged requests (idempotency).
    expect(prisma.arcoRequest.findMany.mock.calls[0][0].where.events).toEqual({
      none: { type: 'OVERDUE' },
    });
  });

  it('auto-escalates a long-overdue RECEIVED request to IN_REVIEW', async () => {
    const { cron, prisma } = makeCron();
    prisma.arcoRequest.findMany
      .mockResolvedValueOnce([]) // nothing newly overdue
      .mockResolvedValueOnce([{ id: 'arco-2', condominiumId: 'c1' }]);

    const result = await cron.sweep(NOW);

    expect(result.escalated).toBe(1);
    expect(prisma.arcoRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'arco-2' },
        data: expect.objectContaining({ status: 'IN_REVIEW' }),
      }),
    );
    expect(prisma.arcoRequestEvent.create.mock.calls[0][0].data.type).toBe(
      'ESCALATED_BY_SYSTEM',
    );
  });

  it('does nothing when no request is overdue', async () => {
    const { cron, prisma, notifications } = makeCron();
    prisma.arcoRequest.findMany.mockResolvedValue([]);
    const result = await cron.sweep(NOW);
    expect(result).toEqual({ overdueFlagged: 0, escalated: 0, adminNotified: 0 });
    expect(notifications.dispatchEvent).not.toHaveBeenCalled();
  });
});
