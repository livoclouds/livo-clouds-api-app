/**
 * Quotations integration test — service layer against a REAL Postgres.
 *
 * Boots QuotationsService with the real PrismaService + AuditService (no mocked
 * Prisma) and drives the full request → quotations → selection lifecycle, the
 * list aggregates, and cross-tenant isolation. Mirrors the harness conventions
 * of pipeline.integration.spec.ts (seeds its own condominium per test; skips
 * itself when TEST_DATABASE_URL is unset).
 */
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';

import { PrismaService } from '../../src/prisma/prisma.service';
import { AuditService } from '../../src/modules/audit/audit.service';
import { QuotationsService } from '../../src/modules/quotations/quotations.service';
import { describeIntegration, resetDb } from './db';

interface Ctx {
  moduleRef: TestingModule;
  prisma: PrismaService;
  quotations: QuotationsService;
}

async function createContext(): Promise<Ctx> {
  const moduleRef = await Test.createTestingModule({
    imports: [ConfigModule.forRoot({ isGlobal: true })],
    providers: [PrismaService, AuditService, QuotationsService],
  }).compile();
  await moduleRef.init();
  return {
    moduleRef,
    prisma: moduleRef.get(PrismaService),
    quotations: moduleRef.get(QuotationsService),
  };
}

/** Seeds a condominium + a user (valid audit actor) and returns their ids. */
async function seedTenant(
  ctx: Ctx,
  slug: string,
): Promise<{ condominiumId: string; userId: string }> {
  const condo = await ctx.prisma.condominium.create({
    data: { slug, name: `Quotations ${slug}` },
  });
  const user = await ctx.prisma.user.create({
    data: {
      condominiumId: condo.id,
      email: `actor-${condo.id}@example.test`,
      passwordHash: 'x',
      firstName: 'Act',
      lastName: 'Or',
    },
  });
  return { condominiumId: condo.id, userId: user.id };
}

describeIntegration('quotations (integration)', () => {
  let ctx: Ctx;
  let tenant: { condominiumId: string; userId: string };

  beforeAll(async () => {
    ctx = await createContext();
  });

  afterAll(async () => {
    if (ctx) await ctx.moduleRef.close();
  });

  beforeEach(async () => {
    await resetDb(ctx.prisma);
    tenant = await seedTenant(ctx, `it-q-${Date.now()}`);
  });

  it('creates a request in the received state with no quotations', async () => {
    const created = await ctx.quotations.create(
      tenant.condominiumId,
      tenant.userId,
      { title: 'Repintar fachada', category: 'painting' },
    );

    expect(created.status).toBe('received');
    expect(created.quotations).toEqual([]);
    expect(created.selectedQuotationId).toBeNull();
    expect(created.description).toBe('');
  });

  it('adds quotations and returns them on the detail view (amount as number)', async () => {
    const req = await ctx.quotations.create(tenant.condominiumId, tenant.userId, {
      title: 'Portón',
      category: 'gateRepair',
    });

    const q = await ctx.quotations.addQuotation(
      tenant.condominiumId,
      tenant.userId,
      req.id,
      { providerName: 'Vidal', amount: 12500.5, quoteDate: '2026-06-02' },
    );
    expect(q.amount).toBe(12500.5);
    expect(q.currency).toBe('MXN');
    expect(typeof q.amount).toBe('number');

    const detail = await ctx.quotations.findOne(tenant.condominiumId, req.id);
    expect(detail.quotations).toHaveLength(1);
    expect(detail.quotations[0].providerName).toBe('Vidal');
  });

  it('selects a winning quotation; rejects a foreign quotation id', async () => {
    const req = await ctx.quotations.create(tenant.condominiumId, tenant.userId, {
      title: 'Jardinería',
      category: 'gardening',
    });
    const q = await ctx.quotations.addQuotation(
      tenant.condominiumId,
      tenant.userId,
      req.id,
      { providerName: 'GreenCo', amount: 800, quoteDate: '2026-06-03' },
    );

    const updated = await ctx.quotations.update(
      tenant.condominiumId,
      tenant.userId,
      req.id,
      { selectedQuotationId: q.id, status: 'providerSelected' },
    );
    expect(updated.selectedQuotationId).toBe(q.id);
    expect(updated.status).toBe('providerSelected');

    // A selection that is not one of the request's own quotations is rejected.
    await expect(
      ctx.quotations.update(tenant.condominiumId, tenant.userId, req.id, {
        selectedQuotationId: '00000000-0000-0000-0000-000000000000',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('clears the selection when the selected quotation is removed', async () => {
    const req = await ctx.quotations.create(tenant.condominiumId, tenant.userId, {
      title: 'Iluminación',
      category: 'lighting',
    });
    const q = await ctx.quotations.addQuotation(
      tenant.condominiumId,
      tenant.userId,
      req.id,
      { providerName: 'LumenMx', amount: 3000, quoteDate: '2026-06-04' },
    );
    await ctx.quotations.update(tenant.condominiumId, tenant.userId, req.id, {
      selectedQuotationId: q.id,
    });

    await ctx.quotations.removeQuotation(
      tenant.condominiumId,
      tenant.userId,
      req.id,
      q.id,
    );

    const detail = await ctx.quotations.findOne(tenant.condominiumId, req.id);
    expect(detail.quotations).toHaveLength(0);
    expect(detail.selectedQuotationId).toBeNull();
  });

  it('list returns aggregates (count, lowest amount, selected) and honors filters', async () => {
    const painting = await ctx.quotations.create(
      tenant.condominiumId,
      tenant.userId,
      { title: 'Pintura lobby', category: 'painting' },
    );
    await ctx.quotations.addQuotation(tenant.condominiumId, tenant.userId, painting.id, {
      providerName: 'A',
      amount: 5000,
      quoteDate: '2026-06-01',
    });
    const cheap = await ctx.quotations.addQuotation(
      tenant.condominiumId,
      tenant.userId,
      painting.id,
      { providerName: 'B', amount: 4200, quoteDate: '2026-06-01' },
    );
    await ctx.quotations.update(tenant.condominiumId, tenant.userId, painting.id, {
      selectedQuotationId: cheap.id,
    });
    // A second request in another category — must be filtered out below.
    await ctx.quotations.create(tenant.condominiumId, tenant.userId, {
      title: 'Portón trasero',
      category: 'gateRepair',
    });

    const all = await ctx.quotations.findAll(tenant.condominiumId, {});
    expect(all.meta.total).toBe(2);

    const onlyPainting = await ctx.quotations.findAll(tenant.condominiumId, {
      category: 'painting',
    });
    expect(onlyPainting.meta.total).toBe(1);
    const item = onlyPainting.data[0];
    expect(item.quotationsCount).toBe(2);
    expect(item.lowestAmount).toBe(4200);
    expect(item.selectedQuotation?.id).toBe(cheap.id);
    // List item never carries the full quotations array.
    expect(item).not.toHaveProperty('quotations');
  });

  it('soft-deletes a request: it disappears from reads but the row remains', async () => {
    const req = await ctx.quotations.create(tenant.condominiumId, tenant.userId, {
      title: 'Señalización',
      category: 'signage',
    });

    await ctx.quotations.remove(tenant.condominiumId, tenant.userId, req.id);

    await expect(
      ctx.quotations.findOne(tenant.condominiumId, req.id),
    ).rejects.toBeInstanceOf(NotFoundException);
    const all = await ctx.quotations.findAll(tenant.condominiumId, {});
    expect(all.meta.total).toBe(0);
    // Row still exists, just stamped deletedAt.
    const raw = await ctx.prisma.quotationRequest.findUnique({
      where: { id: req.id },
    });
    expect(raw?.deletedAt).not.toBeNull();
  });

  describe('tenant isolation', () => {
    it('cannot read, update, delete, or attach quotations across tenants', async () => {
      const other = await seedTenant(ctx, `it-q-other-${Date.now()}`);
      const reqA = await ctx.quotations.create(
        tenant.condominiumId,
        tenant.userId,
        { title: 'Tenant A work', category: 'masonry' },
      );

      // Tenant B carries its own ids but reaches for tenant A's request.
      await expect(
        ctx.quotations.findOne(other.condominiumId, reqA.id),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        ctx.quotations.update(other.condominiumId, other.userId, reqA.id, {
          status: 'cancelled',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        ctx.quotations.remove(other.condominiumId, other.userId, reqA.id),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        ctx.quotations.addQuotation(other.condominiumId, other.userId, reqA.id, {
          providerName: 'X',
          amount: 1,
          quoteDate: '2026-06-01',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);

      // Tenant A's request remains untouched, and tenant B sees nothing.
      const stillThere = await ctx.quotations.findOne(
        tenant.condominiumId,
        reqA.id,
      );
      expect(stillThere.status).toBe('received');
      const bList = await ctx.quotations.findAll(other.condominiumId, {});
      expect(bList.meta.total).toBe(0);
    });
  });
});
