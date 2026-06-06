/**
 * Integration-test database harness.
 *
 * Spins up a real NestJS DI context wired to a real PostgreSQL database (NEVER a
 * mock), exposing exactly the providers the classification pipeline needs:
 *   PrismaService → SettingsCacheService → ReconciliationRulesService →
 *   ClassificationService, plus DashboardService.
 *
 * Controllers/guards are intentionally NOT imported — this exercises the service
 * layer end-to-end against Postgres, not the HTTP stack.
 *
 * The target database comes from TEST_DATABASE_URL (mapped onto DATABASE_URL in
 * `jest.setup.ts` BEFORE PrismaService is constructed). Pointing this at a real
 * tenant database would be destructive: `resetDb()` TRUNCATEs. Use a throwaway DB
 * (CI Postgres service container, or an ephemeral Neon branch locally).
 */
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { Test, TestingModule } from '@nestjs/testing';

import { PrismaService } from '../../src/prisma/prisma.service';
import { ClassificationService } from '../../src/modules/classification/classification.service';
import { DashboardService } from '../../src/modules/dashboard/dashboard.service';
import { ReconciliationRulesService } from '../../src/modules/reconciliation-rules/reconciliation-rules.service';
import { SettingsCacheService } from '../../src/modules/settings/settings-cache.service';

/**
 * Resolved integration DB URL. When unset, integration suites skip themselves
 * (see `describeIntegration`) instead of failing — so a contributor without a
 * throwaway Postgres can still run `pnpm test` (the unit lane) cleanly.
 */
export const INTEGRATION_DB_URL =
  process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? null;

/** Use in place of `describe` so the suite is skipped when no DB is configured. */
export const describeIntegration: jest.Describe =
  INTEGRATION_DB_URL ? describe : describe.skip;

export interface PipelineContext {
  moduleRef: TestingModule;
  prisma: PrismaService;
  classification: ClassificationService;
  dashboard: DashboardService;
}

/** Boots the minimal NestJS context and connects PrismaService to the test DB. */
export async function createPipelineContext(): Promise<PipelineContext> {
  const moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true }),
      EventEmitterModule.forRoot(),
    ],
    providers: [
      PrismaService,
      SettingsCacheService,
      ReconciliationRulesService,
      ClassificationService,
      DashboardService,
    ],
  }).compile();

  // init() fires onModuleInit → PrismaService.$connect().
  await moduleRef.init();

  return {
    moduleRef,
    prisma: moduleRef.get(PrismaService),
    classification: moduleRef.get(ClassificationService),
    dashboard: moduleRef.get(DashboardService),
  };
}

/** Tears the context down (PrismaService.$disconnect via onModuleDestroy). */
export async function closePipelineContext(ctx: PipelineContext): Promise<void> {
  await ctx.moduleRef.close();
}

/**
 * Truncates every table the pipeline test touches. CASCADE clears any dependent
 * rows regardless of Prisma `onDelete` semantics, and RESTART IDENTITY keeps runs
 * reproducible. Each test seeds its own condominium (fresh uuid) so the
 * SettingsCacheService in-memory cache never collides across tests.
 */
export async function resetDb(prisma: PrismaService): Promise<void> {
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE
       "audit_logs",
       "transactions",
       "financial_monthly_summaries",
       "reconciliation_rules",
       "import_batches",
       "bank_profiles",
       "expense_categories",
       "residents",
       "condominium_settings",
       "users",
       "roles",
       "condominiums"
     RESTART IDENTITY CASCADE`,
  );
}
