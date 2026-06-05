import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ResidentArcoService } from './resident-arco.service';
import { ArcoRequestTypeDto } from './dto/create-arco-request.dto';

const CONDO = 'cond-1';
const RESIDENT = 'res-1';
const USER = 'user-9';
const REQ = 'arco-1';

function makePrismaMock() {
  const mock = {
    resident: { findFirst: jest.fn().mockResolvedValue({ id: RESIDENT }) },
    arcoRequest: {
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
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
  };
  const $transaction = jest.fn((cb: (tx: unknown) => unknown) => cb(mock));
  return Object.assign(mock, { $transaction });
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
  const service = new ResidentArcoService(
    prisma as never,
    audit as never,
    storage as never,
    dossier as never,
  );
  return { service, prisma, audit, storage, dossier };
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
      prisma.arcoRequest.findFirst.mockResolvedValue({ id: REQ, status: 'IN_REVIEW' });
      await service.update(CONDO, RESIDENT, REQ, USER, { status: 'COMPLETED' } as never);
      const evt = prisma.arcoRequestEvent.create.mock.calls[0][0].data;
      expect(evt.type).toBe('STATUS_CHANGED');
      expect(evt.fromStatus).toBe('IN_REVIEW');
      expect(evt.toStatus).toBe('COMPLETED');
      const data = prisma.arcoRequest.updateMany.mock.calls[0][0].data;
      expect(data.resolvedAt).toBeInstanceOf(Date);
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
});
