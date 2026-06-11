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
import { NotFoundException } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { Test, TestingModule } from '@nestjs/testing';
import type { ImportBatch } from '@prisma/client';

import { PrismaService } from '../../src/prisma/prisma.service';
import { AuditService } from '../../src/modules/audit/audit.service';
import { BankProfilesService } from '../../src/modules/bank-profiles/bank-profiles.service';
import { ClassificationService } from '../../src/modules/classification/classification.service';
import { DashboardService } from '../../src/modules/dashboard/dashboard.service';
import { ImportsService } from '../../src/modules/imports/imports.service';
import { ImportsParserService } from '../../src/modules/imports/parser';
import { ReconciliationRulesService } from '../../src/modules/reconciliation-rules/reconciliation-rules.service';
import { SettingsCacheService } from '../../src/modules/settings/settings-cache.service';
import { SettingsService } from '../../src/modules/settings/settings.service';
import { StorageService } from '../../src/modules/storage/storage.service';

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

// ─── Imports context (ENGINE-032) ────────────────────────────────────────────
// Boots the full ImportsService dependency chain against the test database,
// replacing only StorageService (Cloudflare R2) with an in-memory stub so the
// upload → confirm → classify flow runs hermetically — no network, no bucket.

/**
 * In-memory replacement for StorageService backed by a Map<string, Buffer>.
 * Method names and signatures mirror the real service exactly (the subset the
 * imports flow touches) so it can be dropped in via `{ provide: StorageService,
 * useValue: stub }`. R2 access-logging is intentionally omitted — it is a
 * side-channel concern of the real service, not of the flow under test.
 */
export interface MemStorageStub {
  /** The backing store — assert on stored buffers directly in tests. */
  files: Map<string, Buffer>;
  isConfigured(): boolean;
  getBucketName(): string;
  uploadFile(
    key: string,
    buffer: Buffer,
    mimeType: string,
    ctx?: unknown,
  ): Promise<string>;
  downloadFile(key: string, ctx?: unknown): Promise<Buffer>;
  deleteFile(key: string, ctx?: unknown): Promise<void>;
  getPresignedUrl(
    key: string,
    expiresIn?: number,
    ctx?: unknown,
    log?: boolean,
  ): Promise<string>;
}

/** Builds a fresh in-memory storage stub (one Map per context). */
export function createMemStorageStub(): MemStorageStub {
  const files = new Map<string, Buffer>();
  return {
    files,
    isConfigured: () => true,
    getBucketName: () => 'memory',
    uploadFile: async (key, buffer) => {
      files.set(key, Buffer.from(buffer));
      return key;
    },
    downloadFile: async (key) => {
      const stored = files.get(key);
      // Mirrors the real service's not-found contract (NotFoundException).
      if (!stored) throw new NotFoundException('Storage object not found');
      return Buffer.from(stored);
    },
    deleteFile: async (key) => {
      files.delete(key);
    },
    getPresignedUrl: async (key) => `memory://${key}`,
  };
}

export interface ImportsContext {
  moduleRef: TestingModule;
  prisma: PrismaService;
  imports: ImportsService;
  classification: ClassificationService;
  parser: ImportsParserService;
  storage: MemStorageStub;
}

/**
 * Boots everything ImportsService needs:
 *   PrismaService · SettingsCacheService → SettingsService (fees guard) ·
 *   ReconciliationRulesService → ClassificationService (deferred classify) ·
 *   AuditService · BankProfilesService · ImportsParserService (server re-parse)
 *   · ConfigService (ConfigModule) · EventEmitter2 (EventEmitterModule),
 * with StorageService replaced by the in-memory stub.
 */
export async function createImportsContext(): Promise<ImportsContext> {
  const storage = createMemStorageStub();

  const moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true }),
      EventEmitterModule.forRoot(),
    ],
    providers: [
      PrismaService,
      SettingsCacheService,
      SettingsService,
      ReconciliationRulesService,
      ClassificationService,
      AuditService,
      BankProfilesService,
      ImportsParserService,
      ImportsService,
      { provide: StorageService, useValue: storage },
    ],
  }).compile();

  await moduleRef.init();

  return {
    moduleRef,
    prisma: moduleRef.get(PrismaService),
    imports: moduleRef.get(ImportsService),
    classification: moduleRef.get(ClassificationService),
    parser: moduleRef.get(ImportsParserService),
    storage,
  };
}

export async function closeImportsContext(ctx: ImportsContext): Promise<void> {
  await ctx.moduleRef.close();
}

/**
 * Polls the import batch every 50 ms until it reaches a terminal status
 * (COMPLETED or FAILED) and returns the terminal row. confirm() defers
 * classification via `setImmediate`, so the only reliable e2e synchronization
 * point is the batch row itself. Throws when `timeoutMs` elapses first.
 */
export async function waitForBatchTerminal(
  prisma: PrismaService,
  batchId: string,
  timeoutMs = 15_000,
): Promise<ImportBatch> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const batch = await prisma.importBatch.findUnique({ where: { id: batchId } });
    if (batch && (batch.status === 'COMPLETED' || batch.status === 'FAILED')) {
      return batch;
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `waitForBatchTerminal: batch ${batchId} did not reach COMPLETED/FAILED ` +
          `within ${timeoutMs}ms (last status: ${batch?.status ?? 'not found'})`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
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
