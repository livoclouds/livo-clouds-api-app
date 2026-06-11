import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ResidentArcoService } from './resident-arco.service';
import { ArcoRequestTypeDto } from './dto/create-arco-request.dto';

const CONDO = 'cond-1';
const RESIDENT = 'res-1';
const USER = 'user-9';
const REQ = 'arco-1';

function makePrismaMock() {
  const mock = {
    // Carries an email so the resident-facing notification path can fire.
    resident: {
      findFirst: jest
        .fn()
        .mockResolvedValue({ id: RESIDENT, email: 'maria@example.com', firstName: 'María', lastName: 'Pérez' }),
    },
    condominium: {
      findUnique: jest.fn().mockResolvedValue({ name: 'Coto Alameda' }),
    },
    condominiumSettings: {
      findUnique: jest.fn().mockResolvedValue({ defaultLocale: 'es' }),
    },
    arcoRequest: {
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      groupBy: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => ({
        id: REQ,
        status: 'RECEIVED',
        ...data,
      })),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    arcoRequestEvent: { create: jest.fn().mockResolvedValue({}) },
    arcoRequestAttachment: {
      create: jest.fn().mockResolvedValue({ id: 'att-1' }),
      findFirst: jest.fn(),
      delete: jest.fn().mockResolvedValue({}),
    },
    $executeRawUnsafe: jest.fn().mockResolvedValue(0),
  };
  const $transaction = jest.fn((cb: (tx: unknown) => unknown) => cb(mock));
  return Object.assign(mock, { $transaction });
}

async function collectStream(stream: import('node:stream').Readable): Promise<string> {
  const chunks: string[] = [];
  for await (const c of stream) chunks.push(String(c));
  return chunks.join('');
}

function makeService() {
  const prisma = makePrismaMock();
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const storage = {
    uploadFile: jest.fn().mockResolvedValue('key'),
    getPresignedUrl: jest.fn().mockResolvedValue('https://signed.example/file'),
    deleteFile: jest.fn().mockResolvedValue(undefined),
  };
  const dossier = {
    exportArcoPacket: jest
      .fn()
      .mockResolvedValue({ buffer: Buffer.from('PK'), fileName: 'arco_res-1.zip', entries: 2 }),
  };
  const email = { sendTransactionalEmail: jest.fn().mockResolvedValue(undefined) };
  const service = new ResidentArcoService(
    prisma as never,
    audit as never,
    storage as never,
    dossier as never,
    email as never,
  );
  return { service, prisma, audit, storage, dossier, email };
}

const baseCreate = {
  type: ArcoRequestTypeDto.RECTIFICATION,
  description: 'Corregir teléfono',
};

const fakeFile = () => ({
  buffer: Buffer.from('x'),
  originalName: 'solicitud.pdf',
  mimeType: 'application/pdf',
  size: 1024,
});

describe('ResidentArcoService', () => {
  describe('create', () => {
    it('computes a due date 20 business days out, logs CREATED event + audit', async () => {
      const { service, prisma, audit } = makeService();
      await service.create(CONDO, RESIDENT, USER, { ...baseCreate, receivedAt: '2026-06-04' });
      const data = prisma.arcoRequest.create.mock.calls[0][0].data;
      // 20 business days from Thursday 2026-06-04 → 2026-07-02.
      expect((data.dueDate as Date).toISOString().slice(0, 10)).toBe('2026-07-02');
      expect(data.createdBy).toBe(USER);
      expect(prisma.arcoRequestEvent.create.mock.calls[0][0].data.type).toBe('CREATED');
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'ARCO_CREATED' }),
        expect.anything(),
      );
    });

    it('defaults to PENDING_VERIFICATION when identity is not verified', async () => {
      const { service, prisma } = makeService();
      await service.create(CONDO, RESIDENT, USER, baseCreate);
      const data = prisma.arcoRequest.create.mock.calls[0][0].data;
      expect(data.status).toBe('PENDING_VERIFICATION');
      expect(data.identityVerified).toBe(false);
      expect(data.identityVerifiedAt).toBeUndefined();
    });

    it('starts RECEIVED, stamps the verifier and masks the ID when identity is verified', async () => {
      const { service, prisma } = makeService();
      await service.create(CONDO, RESIDENT, USER, {
        ...baseCreate,
        identityVerified: true,
        requesterName: 'María Pérez',
        requesterIdNumber: 'PEMA800101HDFRRL09',
      } as never);
      const data = prisma.arcoRequest.create.mock.calls[0][0].data;
      expect(data.status).toBe('RECEIVED');
      expect(data.identityVerified).toBe(true);
      expect(data.identityVerifiedAt).toBeInstanceOf(Date);
      expect(data.identityVerifiedBy).toBe(USER);
      // Only the last four characters survive; the raw ID is never stored.
      expect(data.requesterIdNumberMasked).toBe('••••••••••••••RL09');
      expect(data.requesterIdNumberMasked).not.toContain('PEMA');
    });

    it('sends a receipt notification to the resident', async () => {
      const { service, email, audit } = makeService();
      await service.create(CONDO, RESIDENT, USER, baseCreate);
      expect(email.sendTransactionalEmail).toHaveBeenCalledWith(
        'maria@example.com',
        expect.any(String),
        expect.stringContaining('María'),
      );
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'ARCO_NOTIFIED' }),
      );
    });

    it('stores evidence files when provided', async () => {
      const { service, storage, prisma } = makeService();
      await service.create(CONDO, RESIDENT, USER, baseCreate, [fakeFile()]);
      expect(storage.uploadFile).toHaveBeenCalled();
      expect(prisma.arcoRequestAttachment.create).toHaveBeenCalled();
    });

    it('rejects a non-allowed file type', async () => {
      const { service } = makeService();
      await expect(
        service.create(CONDO, RESIDENT, USER, baseCreate, [
          { ...fakeFile(), mimeType: 'application/zip' },
        ]),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('update', () => {
    it('records STATUS_CHANGED and stamps resolvedAt on a terminal status', async () => {
      const { service, prisma } = makeService();
      prisma.arcoRequest.findFirst.mockResolvedValue({
        id: REQ,
        status: 'IN_REVIEW',
        type: 'RECTIFICATION',
      });
      await service.update(CONDO, RESIDENT, REQ, USER, { status: 'COMPLETED' } as never);
      const evt = prisma.arcoRequestEvent.create.mock.calls[0][0].data;
      expect(evt.type).toBe('STATUS_CHANGED');
      expect(evt.fromStatus).toBe('IN_REVIEW');
      expect(evt.toStatus).toBe('COMPLETED');
      const data = prisma.arcoRequest.updateMany.mock.calls[0][0].data;
      expect(data.resolvedAt).toBeInstanceOf(Date);
    });

    it('rejects a REJECTED transition with no rejection reason', async () => {
      const { service, prisma } = makeService();
      prisma.arcoRequest.findFirst.mockResolvedValue({
        id: REQ,
        status: 'IN_REVIEW',
        rejectionReason: null,
      });
      await expect(
        service.update(CONDO, RESIDENT, REQ, USER, { status: 'REJECTED' } as never),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('allows a REJECTED transition when a reason is supplied and persists it', async () => {
      const { service, prisma } = makeService();
      prisma.arcoRequest.findFirst.mockResolvedValue({
        id: REQ,
        status: 'IN_REVIEW',
        type: 'RECTIFICATION',
      });
      await service.update(CONDO, RESIDENT, REQ, USER, {
        status: 'REJECTED',
        rejectionReason: 'Solicitud improcedente: identidad no acreditada.',
      } as never);
      const data = prisma.arcoRequest.updateMany.mock.calls[0][0].data;
      expect(data.status).toBe('REJECTED');
      expect(data.rejectionReason).toContain('improcedente');
    });

    it('auto-advances PENDING_VERIFICATION to RECEIVED when identity is verified', async () => {
      const { service, prisma } = makeService();
      prisma.arcoRequest.findFirst.mockResolvedValue({
        id: REQ,
        status: 'PENDING_VERIFICATION',
        identityVerified: false,
      });
      await service.update(CONDO, RESIDENT, REQ, USER, {
        identityVerified: true,
      } as never);
      const data = prisma.arcoRequest.updateMany.mock.calls[0][0].data;
      expect(data.status).toBe('RECEIVED');
      expect(data.identityVerifiedAt).toBeInstanceOf(Date);
      expect(data.identityVerifiedBy).toBe(USER);
      const evt = prisma.arcoRequestEvent.create.mock.calls[0][0].data;
      expect(evt.type).toBe('STATUS_CHANGED');
      expect(evt.toStatus).toBe('RECEIVED');
    });

    it('sends a resolution notification to the resident on a terminal transition', async () => {
      const { service, prisma, email } = makeService();
      prisma.arcoRequest.findFirst.mockResolvedValue({
        id: REQ,
        status: 'IN_REVIEW',
        type: 'RECTIFICATION',
      });
      await service.update(CONDO, RESIDENT, REQ, USER, { status: 'COMPLETED' } as never);
      expect(email.sendTransactionalEmail).toHaveBeenCalledWith(
        'maria@example.com',
        expect.any(String),
        expect.any(String),
      );
    });
  });

  describe('reads are audited', () => {
    it('findAll logs ARCO_LIST_VIEWED', async () => {
      const { service, audit, prisma } = makeService();
      await service.findAll(CONDO, RESIDENT, USER, { status: 'RECEIVED' } as never);
      const where = prisma.arcoRequest.findMany.mock.calls[0][0].where;
      expect(where).toMatchObject({ condominiumId: CONDO, residentId: RESIDENT, deletedAt: null, status: 'RECEIVED' });
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'ARCO_LIST_VIEWED' }));
    });

    it('findOne logs ARCO_VIEWED', async () => {
      const { service, audit, prisma } = makeService();
      prisma.arcoRequest.findFirst.mockResolvedValue({ id: REQ });
      await service.findOne(CONDO, RESIDENT, REQ, USER);
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'ARCO_VIEWED' }));
    });
  });

  describe('findAllByCondominium', () => {
    it('lists every request tenant-wide, soonest deadline first, audited at condominium scope', async () => {
      const { service, audit, prisma } = makeService();
      await service.findAllByCondominium(CONDO, USER, { type: 'ACCESS' } as never);
      const args = prisma.arcoRequest.findMany.mock.calls[0][0];
      // Cross-resident: condominium-scoped, no residentId narrowing.
      expect(args.where).toMatchObject({ condominiumId: CONDO, deletedAt: null, type: 'ACCESS' });
      expect(args.where).not.toHaveProperty('residentId');
      expect(args.orderBy).toEqual([{ dueDate: 'asc' }]);
      // Lean projection — carries resident identity, never leaks attachments/storageKey.
      expect(args.select.resident.select).toMatchObject({
        id: true,
        firstName: true,
        lastName: true,
        unitNumber: true,
      });
      expect(args.select).not.toHaveProperty('attachments');
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'ARCO_LIST_VIEWED',
          entityType: 'Condominium',
          entityId: CONDO,
        }),
      );
    });
  });

  describe('access packet', () => {
    it('generates the dossier packet for an ACCESS request + records the event', async () => {
      const { service, prisma, dossier, audit } = makeService();
      prisma.arcoRequest.findFirst.mockResolvedValue({ id: REQ, type: 'ACCESS' });
      const out = await service.generateAccessPacket(CONDO, RESIDENT, REQ, USER);
      expect(dossier.exportArcoPacket).toHaveBeenCalledWith(CONDO, RESIDENT, USER);
      expect(prisma.arcoRequestEvent.create.mock.calls[0][0].data.type).toBe('ACCESS_PACKET_GENERATED');
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'ARCO_ACCESS_PACKET_GENERATED' }));
      expect(out.fileName).toContain('.zip');
    });

    it('refuses for a non-ACCESS request', async () => {
      const { service, prisma } = makeService();
      prisma.arcoRequest.findFirst.mockResolvedValue({ id: REQ, type: 'RECTIFICATION' });
      await expect(
        service.generateAccessPacket(CONDO, RESIDENT, REQ, USER),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('soft delete + notes', () => {
    it('soft-deletes and audits', async () => {
      const { service, prisma, audit } = makeService();
      prisma.arcoRequest.findFirst.mockResolvedValue({ id: REQ });
      await service.remove(CONDO, RESIDENT, REQ, USER);
      expect(prisma.arcoRequest.updateMany.mock.calls[0][0].data.deletedAt).toBeInstanceOf(Date);
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'ARCO_DELETED' }),
        expect.anything(),
      );
    });

    it('addNote records NOTE_ADDED', async () => {
      const { service, prisma } = makeService();
      prisma.arcoRequest.findFirst.mockResolvedValue({ id: REQ });
      await service.addNote(CONDO, RESIDENT, REQ, USER, 'Se pidió ID');
      expect(prisma.arcoRequestEvent.create.mock.calls[0][0].data.type).toBe('NOTE_ADDED');
    });

    it('throws NotFound when the request does not exist', async () => {
      const { service, prisma } = makeService();
      prisma.arcoRequest.findFirst.mockResolvedValue(null);
      await expect(service.addNote(CONDO, RESIDENT, REQ, USER, 'x')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('export (RP-012)', () => {
    it('streams a CSV header + one row per request, masking nothing sensitive', async () => {
      const { service, prisma, audit } = makeService();
      prisma.arcoRequest.findMany.mockResolvedValue([
        {
          id: 'a1', type: 'RECTIFICATION', status: 'COMPLETED', legalBasis: 'CONSENT',
          identityVerified: true, channel: 'Email', receivedAt: new Date('2026-06-01'),
          dueDate: new Date('2026-07-01'), resolvedAt: new Date('2026-06-10'),
          rejectionReason: null, resolution: 'Done, ok', referenceFolio: 'F-1',
          resident: { firstName: 'María', lastName: 'Pérez', unitNumber: 'A1' },
        },
      ]);
      const csv = await collectStream(service.exportCsv(CONDO, USER, {} as never));
      const lines = csv.trim().split('\n');
      expect(lines[0]).toContain('request_id,resident_name,unit,type,status');
      expect(lines[1]).toContain('a1');
      expect(lines[1]).toContain('María Pérez');
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'ARCO_EXPORT' }));
    });
  });

  describe('metrics (RP-015)', () => {
    it('computes rates, overdue and mean response time by type', async () => {
      const { service, prisma } = makeService();
      prisma.arcoRequest.groupBy.mockResolvedValue([
        { status: 'COMPLETED', _count: 6 },
        { status: 'REJECTED', _count: 2 },
        { status: 'RECEIVED', _count: 2 },
      ]);
      prisma.arcoRequest.count
        .mockResolvedValueOnce(10) // total
        .mockResolvedValueOnce(1); // overdue
      prisma.arcoRequest.findMany.mockResolvedValue([
        { type: 'ACCESS', receivedAt: new Date('2026-06-01'), resolvedAt: new Date('2026-06-05') },
      ]);
      const m = await service.metrics(CONDO, USER);
      expect(m.total).toBe(10);
      expect(m.completionRate).toBe(60);
      expect(m.rejectionRate).toBe(20);
      expect(m.overdueCount).toBe(1);
      const access = m.meanResponseTimeByType.find((x) => x.type === 'ACCESS');
      expect(access?.meanDays).toBe(4);
    });
  });

  describe('proof documents (RP-016)', () => {
    it('refuses a resolution proof for a non-terminal request', async () => {
      const { service, prisma } = makeService();
      prisma.arcoRequest.findFirst.mockResolvedValue({ id: REQ, status: 'RECEIVED', type: 'ACCESS' });
      await expect(
        service.getProof(CONDO, RESIDENT, REQ, USER, 'RESOLUTION'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('returns printable HTML for a delivery proof, audited', async () => {
      const { service, prisma, audit } = makeService();
      prisma.arcoRequest.findFirst.mockResolvedValue({
        id: REQ, status: 'RECEIVED', type: 'ACCESS', channel: null, description: 'x',
        resolution: null, rejectionReason: null, referenceFolio: null,
        receivedAt: new Date('2026-06-01'), dueDate: new Date('2026-07-01'), resolvedAt: null,
      });
      const { html, fileName } = await service.getProof(CONDO, RESIDENT, REQ, USER, 'DELIVERY');
      expect(html).toContain('<!doctype html>');
      expect(html).toContain('María Pérez');
      expect(fileName).toContain('proof-of-delivery');
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'ARCO_PROOF_DOWNLOADED' }));
    });
  });

  describe('bulk (RP-014)', () => {
    it('rejects a bulk REJECT with no reason', async () => {
      const { service } = makeService();
      await expect(
        service.bulkUpdate(CONDO, USER, {
          action: 'STATUS_UPDATE', requestIds: ['a1'], status: 'REJECTED',
        } as never),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('processes each request individually and records a summary audit', async () => {
      const { service, prisma, audit } = makeService();
      // targets lookup
      prisma.arcoRequest.findMany.mockResolvedValue([
        { id: 'a1', residentId: 'r1' },
        { id: 'a2', residentId: 'r2' },
      ]);
      // each per-request update() loads its before-row
      prisma.arcoRequest.findFirst.mockResolvedValue({ id: 'a1', status: 'RECEIVED', type: 'ACCESS' });
      const out = await service.bulkUpdate(CONDO, USER, {
        action: 'STATUS_UPDATE', requestIds: ['a1', 'a2'], status: 'IN_REVIEW',
      } as never);
      expect(out.affected).toBe(2);
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'ARCO_BULK_UPDATED' }));
    });
  });

  describe('internal notes (RP-032)', () => {
    it('routes update internalNotes to the append-only timeline', async () => {
      const { service, prisma } = makeService();
      prisma.arcoRequest.findFirst.mockResolvedValue({ id: REQ, status: 'IN_REVIEW', type: 'ACCESS' });
      await service.update(CONDO, RESIDENT, REQ, USER, {
        internalNotes: 'Llamar al titular',
      } as never);
      const noteEvent = prisma.arcoRequestEvent.create.mock.calls
        .map((c: unknown[]) => (c[0] as { data: { type: string; note?: string } }).data)
        .find((d: { type: string }) => d.type === 'NOTE_ADDED');
      expect(noteEvent).toBeDefined();
      expect(noteEvent?.note).toContain('Llamar');
    });
  });
});
