import { HelpVoteValue } from '@prisma/client';
import { SupportService } from './support.service';
import { CreateTicketDto } from './dto/create-ticket.dto';

const SLUG = 'how-do-i-import';
const USER_ID = 'user-42';
const CONDOMINIUM_ID = 'cond-1';

interface PrismaMock {
  helpArticleMetric: {
    upsert: jest.Mock;
    update: jest.Mock;
    findMany: jest.Mock;
  };
  helpArticleVote: {
    upsert: jest.Mock;
    deleteMany: jest.Mock;
    count: jest.Mock;
    findMany: jest.Mock;
  };
  supportTicket: {
    create: jest.Mock;
    update: jest.Mock;
    findMany: jest.Mock;
    count: jest.Mock;
  };
  $transaction: jest.Mock;
}

interface StorageMock {
  isConfigured: jest.Mock;
  uploadFile: jest.Mock;
  getPresignedUrl: jest.Mock;
}

function makePrismaMock(): PrismaMock {
  const mock = {
    helpArticleMetric: {
      upsert: jest.fn().mockResolvedValue({ slug: SLUG, viewCount: 1 }),
      update: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([]),
    },
    helpArticleVote: {
      upsert: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      count: jest.fn().mockResolvedValue(0),
      findMany: jest.fn().mockResolvedValue([]),
    },
    supportTicket: {
      create: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
  } as Omit<PrismaMock, '$transaction'>;

  const $transaction = jest.fn((cb: (tx: unknown) => unknown) => cb(mock));
  return Object.assign(mock, { $transaction });
}

function makeStorageMock(): StorageMock {
  return {
    isConfigured: jest.fn().mockReturnValue(true),
    uploadFile: jest.fn().mockResolvedValue('key'),
    getPresignedUrl: jest.fn().mockResolvedValue('https://signed.example/x'),
  };
}

function makeService(prisma: PrismaMock, storage: StorageMock): SupportService {
  return new SupportService(prisma as never, storage as never);
}

function makeTicket(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ticket-1',
    condominiumId: CONDOMINIUM_ID,
    userId: USER_ID,
    requestType: 'TECHNICAL',
    priority: 'HIGH',
    module: 'IMPORTS',
    description: 'Something broke during import',
    status: 'OPEN',
    screenshotKey: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

const baseDto: CreateTicketDto = {
  requestType: 'technical',
  priority: 'high',
  module: 'imports',
  description: 'Something broke during import',
};

describe('SupportService', () => {
  describe('recordView', () => {
    it('upserts and increments the view counter', async () => {
      const prisma = makePrismaMock();
      const service = makeService(prisma, makeStorageMock());

      prisma.helpArticleMetric.upsert.mockResolvedValue({
        slug: SLUG,
        viewCount: 5,
      });

      const result = await service.recordView(SLUG);

      expect(prisma.helpArticleMetric.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { slug: SLUG },
          create: { slug: SLUG, viewCount: 1 },
          update: { viewCount: { increment: 1 } },
        }),
      );
      expect(result).toEqual({ slug: SLUG, viewCount: 5 });
    });
  });

  describe('submitFeedback', () => {
    it('casts a helpful vote and returns recomputed counts', async () => {
      const prisma = makePrismaMock();
      const service = makeService(prisma, makeStorageMock());
      prisma.helpArticleVote.count
        .mockResolvedValueOnce(3) // helpful
        .mockResolvedValueOnce(1); // not helpful

      const result = await service.submitFeedback(SLUG, USER_ID, 'helpful');

      expect(prisma.helpArticleVote.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { slug_userId: { slug: SLUG, userId: USER_ID } },
          create: { slug: SLUG, userId: USER_ID, value: HelpVoteValue.HELPFUL },
          update: { value: HelpVoteValue.HELPFUL },
        }),
      );
      expect(prisma.helpArticleMetric.update).toHaveBeenCalledWith({
        where: { slug: SLUG },
        data: { helpfulCount: 3, notHelpfulCount: 1 },
      });
      expect(result).toEqual({
        slug: SLUG,
        helpfulCount: 3,
        notHelpfulCount: 1,
        myVote: 'helpful',
      });
    });

    it('retracts the vote when value is null (deletes, no upsert)', async () => {
      const prisma = makePrismaMock();
      const service = makeService(prisma, makeStorageMock());
      prisma.helpArticleVote.count
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0);

      const result = await service.submitFeedback(SLUG, USER_ID, null);

      expect(prisma.helpArticleVote.deleteMany).toHaveBeenCalledWith({
        where: { slug: SLUG, userId: USER_ID },
      });
      expect(prisma.helpArticleVote.upsert).not.toHaveBeenCalled();
      expect(result.myVote).toBeNull();
      expect(result).toMatchObject({ helpfulCount: 0, notHelpfulCount: 0 });
    });
  });

  describe('getMetrics', () => {
    it('returns a slug-keyed map with zeros + myVote for missing slugs', async () => {
      const prisma = makePrismaMock();
      const service = makeService(prisma, makeStorageMock());
      prisma.helpArticleMetric.findMany.mockResolvedValue([
        { slug: SLUG, viewCount: 9, helpfulCount: 4, notHelpfulCount: 1 },
      ]);
      prisma.helpArticleVote.findMany.mockResolvedValue([
        { slug: SLUG, value: HelpVoteValue.HELPFUL },
      ]);

      const { metrics } = await service.getMetrics(
        [SLUG, 'unseen-article', SLUG],
        USER_ID,
      );

      expect(metrics[SLUG]).toEqual({
        viewCount: 9,
        helpfulCount: 4,
        notHelpfulCount: 1,
        myVote: 'helpful',
      });
      expect(metrics['unseen-article']).toEqual({
        viewCount: 0,
        helpfulCount: 0,
        notHelpfulCount: 0,
        myVote: null,
      });
    });
  });

  describe('createTicket', () => {
    it('maps wire enums to Prisma and returns a wire-shaped view (no file)', async () => {
      const prisma = makePrismaMock();
      const storage = makeStorageMock();
      const service = makeService(prisma, storage);
      prisma.supportTicket.create.mockResolvedValue(makeTicket());

      const view = await service.createTicket(
        CONDOMINIUM_ID,
        USER_ID,
        baseDto,
      );

      expect(prisma.supportTicket.create).toHaveBeenCalledWith({
        data: {
          condominiumId: CONDOMINIUM_ID,
          userId: USER_ID,
          requestType: 'TECHNICAL',
          priority: 'HIGH',
          module: 'IMPORTS',
          description: baseDto.description,
        },
      });
      expect(storage.uploadFile).not.toHaveBeenCalled();
      expect(view).toMatchObject({
        id: 'ticket-1',
        requestType: 'technical',
        priority: 'high',
        module: 'imports',
        status: 'open',
        screenshotUrl: null,
      });
    });

    it('uploads the screenshot to R2 and returns a presigned URL', async () => {
      const prisma = makePrismaMock();
      const storage = makeStorageMock();
      const service = makeService(prisma, storage);
      prisma.supportTicket.create.mockResolvedValue(makeTicket());

      const view = await service.createTicket(CONDOMINIUM_ID, USER_ID, baseDto, {
        buffer: Buffer.from('img'),
        originalname: 'shot.png',
        mimetype: 'image/png',
        size: 3,
      });

      expect(storage.uploadFile).toHaveBeenCalledWith(
        expect.stringContaining(
          `condominiums/${CONDOMINIUM_ID}/support/ticket-1/`,
        ),
        expect.any(Buffer),
        'image/png',
        expect.objectContaining({ userId: USER_ID, condominiumId: CONDOMINIUM_ID }),
      );
      expect(prisma.supportTicket.update).toHaveBeenCalled();
      expect(view.screenshotUrl).toBe('https://signed.example/x');
    });

    it('skips upload when storage is not configured', async () => {
      const prisma = makePrismaMock();
      const storage = makeStorageMock();
      storage.isConfigured.mockReturnValue(false);
      const service = makeService(prisma, storage);
      prisma.supportTicket.create.mockResolvedValue(makeTicket());

      const view = await service.createTicket(CONDOMINIUM_ID, USER_ID, baseDto, {
        buffer: Buffer.from('img'),
        originalname: 'shot.png',
        mimetype: 'image/png',
        size: 3,
      });

      expect(storage.uploadFile).not.toHaveBeenCalled();
      expect(view.screenshotUrl).toBeNull();
    });
  });

  describe('listMyTickets', () => {
    it('returns a paginated, wire-shaped result scoped to the user', async () => {
      const prisma = makePrismaMock();
      const service = makeService(prisma, makeStorageMock());
      prisma.supportTicket.findMany.mockResolvedValue([makeTicket()]);
      prisma.supportTicket.count.mockResolvedValue(1);

      const result = await service.listMyTickets(CONDOMINIUM_ID, USER_ID, {
        page: 1,
        limit: 20,
      });

      expect(prisma.supportTicket.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { condominiumId: CONDOMINIUM_ID, userId: USER_ID },
          orderBy: { createdAt: 'desc' },
        }),
      );
      expect(result.meta).toEqual({
        total: 1,
        page: 1,
        limit: 20,
        totalPages: 1,
      });
      expect(result.data[0]).toMatchObject({ requestType: 'technical' });
    });
  });
});
