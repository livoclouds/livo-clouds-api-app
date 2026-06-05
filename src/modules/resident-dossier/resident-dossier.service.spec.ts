import {
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ResidentDossierService } from './resident-dossier.service';
import {
  DossierCategoryDto,
  DossierSeverityDto,
} from './dto/create-dossier-entry.dto';

const CONDO = 'cond-1';
const RESIDENT = 'res-1';
const USER = 'user-9';
const ENTRY = 'entry-1';

function makePrismaMock() {
  const mock = {
    resident: { findFirst: jest.fn().mockResolvedValue({ id: RESIDENT }) },
    residentDossierEntry: {
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => ({
        id: ENTRY,
        status: 'OPEN',
        ...data,
      })),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    dossierEvent: { create: jest.fn().mockResolvedValue({}) },
    dossierAttachment: {
      create: jest.fn().mockResolvedValue({ id: 'att-1' }),
      count: jest.fn().mockResolvedValue(0),
      findFirst: jest.fn(),
      delete: jest.fn().mockResolvedValue({}),
    },
  };
  const $transaction = jest.fn((cb: (tx: unknown) => unknown) => cb(mock));
  return Object.assign(mock, { $transaction });
}

function makeAudit() {
  return { log: jest.fn().mockResolvedValue(undefined) };
}

function makeStorage() {
  return {
    uploadFile: jest.fn().mockResolvedValue('key'),
    getPresignedUrl: jest.fn().mockResolvedValue('https://signed.example/file'),
    deleteFile: jest.fn().mockResolvedValue(undefined),
  };
}

// rbac.getEffectivePermissions → the permission set that drives confidentiality
// visibility. Default: a full-access admin.
function makeRbac(perms: string[]) {
  return { getEffectivePermissions: jest.fn().mockResolvedValue(new Set(perms)) };
}

const ALL_PERMS = [
  'residents.dossier.view',
  'residents.dossier.viewRestricted',
  'residents.dossier.viewLegal',
  'residents.dossier.manage',
];

function makeService(perms: string[] = ALL_PERMS) {
  const prisma = makePrismaMock();
  const audit = makeAudit();
  const rbac = makeRbac(perms);
  const storage = makeStorage();
  const service = new ResidentDossierService(
    prisma as never,
    audit as never,
    rbac as never,
    storage as never,
  );
  return { service, prisma, audit, rbac, storage };
}

const fakeFile = (over: Partial<{ mimeType: string; size: number }> = {}) => ({
  buffer: Buffer.from('x'),
  originalName: 'acta.pdf',
  mimeType: over.mimeType ?? 'application/pdf',
  size: over.size ?? 1024,
});

const baseCreate = {
  category: DossierCategoryDto.SANCTION,
  title: 'Multa',
  description: 'Sanción de asamblea',
  occurredAt: '2026-03-14',
};

describe('ResidentDossierService', () => {
  describe('evidence rule (HIGH severity)', () => {
    it('rejects a HIGH-severity entry with no reference folio (422)', async () => {
      const { service } = makeService();
      await expect(
        service.create(CONDO, RESIDENT, USER, {
          ...baseCreate,
          severity: DossierSeverityDto.HIGH,
        }),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    });

    it('accepts a HIGH-severity entry when a reference folio is present', async () => {
      const { service, prisma, audit } = makeService();
      await service.create(CONDO, RESIDENT, USER, {
        ...baseCreate,
        severity: DossierSeverityDto.HIGH,
        referenceFolio: 'Acta #12',
      });
      expect(prisma.residentDossierEntry.create).toHaveBeenCalled();
      expect(prisma.dossierEvent.create).toHaveBeenCalled(); // CREATED event
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'DOSSIER_CREATED' }),
        expect.anything(),
      );
    });

    it('allows a LOW-severity entry without any folio', async () => {
      const { service, prisma } = makeService();
      await service.create(CONDO, RESIDENT, USER, baseCreate);
      expect(prisma.residentDossierEntry.create).toHaveBeenCalled();
    });
  });

  describe('confidentiality visibility filter', () => {
    it('lists only the levels the caller unlocks and audits the view', async () => {
      // Auditor: standard + restricted, NOT legal.
      const { service, prisma, audit } = makeService([
        'residents.dossier.view',
        'residents.dossier.viewRestricted',
      ]);
      await service.findAll(CONDO, RESIDENT, USER);
      const where = prisma.residentDossierEntry.findMany.mock.calls[0][0].where;
      expect(where.confidentiality.in).toEqual(['STANDARD', 'RESTRICTED']);
      expect(where).toMatchObject({ condominiumId: CONDO, residentId: RESIDENT, deletedAt: null });
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'DOSSIER_LIST_VIEWED' }),
      );
    });

    it('forbids opening an entry above the caller confidentiality tier', async () => {
      const { service, prisma } = makeService(['residents.dossier.view']); // standard only
      prisma.residentDossierEntry.findFirst.mockResolvedValue({
        id: ENTRY,
        confidentiality: 'LEGAL_CONFIDENTIAL',
      });
      await expect(
        service.findOne(CONDO, RESIDENT, ENTRY, USER),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('allows opening an entry within the caller tier and audits it', async () => {
      const { service, prisma, audit } = makeService(['residents.dossier.view']);
      prisma.residentDossierEntry.findFirst.mockResolvedValue({
        id: ENTRY,
        confidentiality: 'STANDARD',
      });
      const out = await service.findOne(CONDO, RESIDENT, ENTRY, USER);
      expect(out).toMatchObject({ id: ENTRY });
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'DOSSIER_VIEWED' }),
      );
    });
  });

  describe('remove (soft delete)', () => {
    it('soft-deletes via updateMany and audits the deletion', async () => {
      const { service, prisma, audit } = makeService();
      prisma.residentDossierEntry.findFirst.mockResolvedValue({ id: ENTRY });
      await service.remove(CONDO, RESIDENT, ENTRY, USER);
      const call = prisma.residentDossierEntry.updateMany.mock.calls[0][0];
      expect(call.data.deletedAt).toBeInstanceOf(Date);
      expect(call.where).toMatchObject({ id: ENTRY, condominiumId: CONDO, residentId: RESIDENT });
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'DOSSIER_DELETED' }),
        expect.anything(),
      );
    });

    it('throws NotFound when the entry does not exist', async () => {
      const { service, prisma } = makeService();
      prisma.residentDossierEntry.findFirst.mockResolvedValue(null);
      await expect(
        service.remove(CONDO, RESIDENT, ENTRY, USER),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('update status change', () => {
    it('records a STATUS_CHANGED event when status changes', async () => {
      const { service, prisma } = makeService();
      prisma.residentDossierEntry.findFirst.mockResolvedValue({
        id: ENTRY,
        status: 'OPEN',
        severity: 'LOW',
        referenceFolio: null,
      });
      await service.update(CONDO, RESIDENT, ENTRY, USER, { status: 'RESOLVED' } as never);
      const evt = prisma.dossierEvent.create.mock.calls[0][0].data;
      expect(evt.type).toBe('STATUS_CHANGED');
      expect(evt.fromStatus).toBe('OPEN');
      expect(evt.toStatus).toBe('RESOLVED');
    });
  });

  describe('evidence via attachment (phase 2B)', () => {
    it('accepts a HIGH entry with no folio when an evidence file is provided', async () => {
      const { service, prisma, storage } = makeService();
      await service.create(
        CONDO,
        RESIDENT,
        USER,
        { ...baseCreate, severity: DossierSeverityDto.HIGH },
        [fakeFile()],
      );
      expect(storage.uploadFile).toHaveBeenCalled();
      expect(prisma.dossierAttachment.create).toHaveBeenCalled();
    });

    it('rejects a non-allowed file type', async () => {
      const { service } = makeService();
      await expect(
        service.create(CONDO, RESIDENT, USER, baseCreate, [
          fakeFile({ mimeType: 'application/zip' }),
        ]),
      ).rejects.toBeTruthy();
    });

    it('rejects a file over 10 MB', async () => {
      const { service } = makeService();
      await expect(
        service.create(CONDO, RESIDENT, USER, baseCreate, [
          fakeFile({ size: 11 * 1024 * 1024 }),
        ]),
      ).rejects.toBeTruthy();
    });

    it('on PATCH to HIGH, an existing attachment satisfies the evidence rule', async () => {
      const { service, prisma } = makeService();
      prisma.residentDossierEntry.findFirst.mockResolvedValue({
        id: ENTRY,
        status: 'OPEN',
        severity: 'LOW',
        referenceFolio: null,
      });
      prisma.dossierAttachment.count.mockResolvedValue(1); // one attachment exists
      await expect(
        service.update(CONDO, RESIDENT, ENTRY, USER, { severity: 'HIGH' } as never),
      ).resolves.toBeDefined();
    });
  });

  describe('attachments + notes (phase 2B)', () => {
    it('adds a note → NOTE_ADDED event + audit', async () => {
      const { service, prisma, audit } = makeService();
      prisma.residentDossierEntry.findFirst.mockResolvedValue({ id: ENTRY });
      await service.addNote(CONDO, RESIDENT, ENTRY, USER, 'Se notificó');
      expect(prisma.dossierEvent.create.mock.calls[0][0].data.type).toBe('NOTE_ADDED');
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'DOSSIER_NOTE_ADDED' }),
      );
    });

    it('uploads attachments to an existing entry', async () => {
      const { service, prisma, storage } = makeService();
      prisma.residentDossierEntry.findFirst.mockResolvedValue({ id: ENTRY });
      await service.addAttachments(CONDO, RESIDENT, ENTRY, USER, [fakeFile()]);
      expect(storage.uploadFile).toHaveBeenCalled();
      expect(prisma.dossierEvent.create.mock.calls[0][0].data.type).toBe('ATTACHMENT_ADDED');
    });

    it('presigned url is forbidden above the caller tier', async () => {
      const { service, prisma } = makeService(['residents.dossier.view']); // standard only
      prisma.residentDossierEntry.findFirst.mockResolvedValue({
        id: ENTRY,
        confidentiality: 'LEGAL_CONFIDENTIAL',
      });
      await expect(
        service.getAttachmentUrl(CONDO, RESIDENT, ENTRY, 'att-1', USER),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('presigned url returns a signed link within the tier', async () => {
      const { service, prisma, storage } = makeService();
      prisma.residentDossierEntry.findFirst.mockResolvedValue({
        id: ENTRY,
        confidentiality: 'STANDARD',
      });
      prisma.dossierAttachment.findFirst.mockResolvedValue({
        id: 'att-1',
        storageKey: 'k',
        fileSizeBytes: 10,
      });
      const out = await service.getAttachmentUrl(CONDO, RESIDENT, ENTRY, 'att-1', USER);
      expect(out.url).toContain('https://');
      expect(storage.getPresignedUrl).toHaveBeenCalled();
    });

    it('removes an attachment (row + R2 + ATTACHMENT_REMOVED event)', async () => {
      const { service, prisma, storage } = makeService();
      prisma.residentDossierEntry.findFirst.mockResolvedValue({ id: ENTRY });
      prisma.dossierAttachment.findFirst.mockResolvedValue({
        id: 'att-1',
        storageKey: 'k',
        fileName: 'acta.pdf',
      });
      await service.removeAttachment(CONDO, RESIDENT, ENTRY, 'att-1', USER);
      expect(prisma.dossierAttachment.delete).toHaveBeenCalled();
      expect(storage.deleteFile).toHaveBeenCalled();
      expect(prisma.dossierEvent.create.mock.calls[0][0].data.type).toBe('ATTACHMENT_REMOVED');
    });
  });
});
