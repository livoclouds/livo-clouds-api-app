/**
 * ENGINE-032 — imports e2e integration test: upload → confirm → classify.
 *
 * Exercises ImportsService end-to-end against a REAL Postgres with only the R2
 * StorageService swapped for an in-memory stub. Unlike pipeline.integration.spec
 * (which drives ClassificationService.classifyBatch directly), this suite goes
 * through the real HTTP-facing service methods:
 *
 *   upload()   — magic-byte/MIME/dedup guards, sha256 hashing, PENDING batch,
 *                storage retention (stubbed in memory).
 *   confirm()  — fees guard, R2 re-download + canonical-hash verification,
 *                server-side re-parse (trust boundary), client/server payload
 *                reconciliation (PAYLOAD_MISMATCH), $transaction persistence,
 *                and the setImmediate-deferred classification that lands the
 *                batch on COMPLETED (with the persisted ENGINE-058 summary
 *                columns) or FAILED.
 *
 * The deferred classification is awaited via waitForBatchTerminal (DB polling),
 * which is the same synchronization contract the web client uses (GET /imports/:id).
 */
import { BadRequestException, ConflictException } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import * as crypto from 'crypto';
import { ReconciliationRuleKind } from '@prisma/client';

import { JwtPayload, UserRole } from '../../src/common/types';
import { ClassificationService } from '../../src/modules/classification/classification.service';
import { ConfirmImportDto } from '../../src/modules/imports/dto/confirm-import.dto';
import {
  closeImportsContext,
  createImportsContext,
  describeIntegration,
  ImportsContext,
  resetDb,
  waitForBatchTerminal,
} from './db';

const XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const FILE_NAME = 'estado-marzo.xlsx';
// Mid-month date: stable year/month bucket across CI (UTC) and local offsets,
// in the recent past (validateRows rejects future dates and dates >5y old).
const TX_DATE = '2026-03-15';

interface WorkbookRow {
  date: string;
  description: string;
  charges: number;
  credits: number;
  balance: number;
}

// The three deterministic rows mirrored from pipeline.integration.spec.ts:
//   CFE expense   → EXPENSE rule (keyword "CFE")      → AUTO
//   orphan income → no rule, no padrón match          → NEEDS_REVIEW (unmatched)
//   CUOTA101      → UNIT rule → unit 101 → resident   → AUTO
const FIXTURE_ROWS: WorkbookRow[] = [
  { date: TX_DATE, description: 'PAGO CFE LUZ', charges: 800, credits: 0, balance: 0 },
  { date: TX_DATE, description: 'DEPOSITO NO IDENTIFICADO', charges: 0, credits: 1500, balance: 1500 },
  { date: TX_DATE, description: 'CUOTA101', charges: 0, credits: 2000, balance: 3500 },
];

/**
 * Builds a real XLSX buffer the generic parser understands. Headers use the
 * DEFAULT_FIELD_DEFINITIONS aliases (Fecha/Descripción/Cargos/Abonos/Saldo) so
 * header detection (≥4 alias matches) and all five required fields resolve.
 * (`bank-workbook-fixtures.ts` did not exist at authoring time, hence inline.)
 */
async function buildBankWorkbook(rows: WorkbookRow[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Movimientos');
  sheet.addRow(['Fecha', 'Descripción', 'Cargos', 'Abonos', 'Saldo']);
  for (const row of rows) {
    sheet.addRow([row.date, row.description, row.charges, row.credits, row.balance]);
  }
  const out = await workbook.xlsx.writeBuffer();
  return Buffer.from(out as ArrayBuffer);
}

function sha256(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function uploadFileFor(buffer: Buffer) {
  return [
    { buffer, originalname: FILE_NAME, mimetype: XLSX_MIME, size: buffer.length },
  ];
}

interface SeededFixture {
  condominiumId: string;
  importerId: string;
  expenseCategoryId: string;
  residentId: string;
  expenseRuleId: string;
  actor: JwtPayload;
}

/**
 * Seeds the minimal tenant graph the upload→confirm flow needs. Unlike the
 * pipeline fixture, `ordinaryFeeAmount` must be > 0 — confirm() runs
 * validateFeesConfigured. 777.77 is deliberately outside every fixture credit
 * (1500/2000) so the amount-range maintenance pass never fires.
 */
async function seedImportsFixture(ctx: ImportsContext): Promise<SeededFixture> {
  const { prisma } = ctx;

  const condo = await prisma.condominium.create({
    data: { slug: `it-imp-${Date.now()}`, name: 'Imports Integration Condo' },
  });

  await prisma.condominiumSettings.create({
    data: {
      condominiumId: condo.id,
      currency: 'MXN',
      totalUnits: 10,
      ordinaryFeeAmount: 777.77,
    },
  });

  const importer = await prisma.user.create({
    data: {
      condominiumId: condo.id,
      email: `importer-${condo.id}@example.test`,
      passwordHash: 'x', // never authenticated in this test
      firstName: 'Imp',
      lastName: 'Orter',
    },
  });

  const category = await prisma.expenseCategory.create({
    data: { condominiumId: condo.id, name: 'Electricidad', systemKey: 'UTILITIES' },
  });

  const resident = await prisma.resident.create({
    data: {
      condominiumId: condo.id,
      unitNumber: '101',
      unitNumberNormalized: '101',
      firstName: 'Ana',
      lastName: 'García',
    },
  });

  const expenseRule = await prisma.reconciliationRule.create({
    data: {
      condominiumId: condo.id,
      name: 'CFE → Electricidad',
      ruleKind: ReconciliationRuleKind.EXPENSE,
      keywords: ['CFE'],
      unitPatterns: [],
      expenseCategoryId: category.id,
      confidenceThreshold: 0.8,
      priority: 1,
    },
  });

  await prisma.reconciliationRule.create({
    data: {
      condominiumId: condo.id,
      name: 'CUOTA101 → Unidad 101',
      ruleKind: ReconciliationRuleKind.UNIT,
      keywords: ['CUOTA101'],
      unitPatterns: [],
      assignedUnitNumber: '101',
      confidenceThreshold: 0.95,
      priority: 2,
    },
  });

  const actor: JwtPayload = {
    sub: importer.id,
    email: importer.email,
    role: UserRole.TENANT_ADMIN,
    condominiumId: condo.id,
    condominiumSlug: condo.slug,
  };

  return {
    condominiumId: condo.id,
    importerId: importer.id,
    expenseCategoryId: category.id,
    residentId: resident.id,
    expenseRuleId: expenseRule.id,
    actor,
  };
}

describeIntegration('imports upload → confirm → classify (integration)', () => {
  let ctx: ImportsContext;
  let fx: SeededFixture;
  let workbook: Buffer;
  let fileHash: string;

  beforeAll(async () => {
    ctx = await createImportsContext();
    workbook = await buildBankWorkbook(FIXTURE_ROWS);
    fileHash = sha256(workbook);
  });

  afterAll(async () => {
    if (ctx) await closeImportsContext(ctx);
  });

  beforeEach(async () => {
    await resetDb(ctx.prisma);
    ctx.storage.files.clear();
    fx = await seedImportsFixture(ctx);
  });

  afterEach(() => {
    // The forced-failure test spies on ClassificationService.prototype.
    jest.restoreAllMocks();
  });

  /** upload() the fixture workbook and return the queued batch id. */
  async function uploadWorkbook(): Promise<string> {
    const results = await ctx.imports.upload(
      fx.condominiumId,
      uploadFileFor(workbook),
      fx.actor,
    );
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ status: 'queued' });
    return results[0].batchId as string;
  }

  /**
   * UF-001 contract: confirm's client rows must reconcile against the server's
   * re-parse of the SAME buffer — so derive them with the same parser. The
   * optional `tamper` hook mutates the client copy to simulate a forged payload.
   */
  async function confirmDtoFor(
    batchId: string,
    tamper?: (rows: ConfirmImportDto['files'][number]['transactions']) => void,
  ): Promise<ConfirmImportDto> {
    const { transactions } = await ctx.parser.parseBuffer(workbook, 'xlsx');
    const clientRows = transactions.map((t) => ({
      transactionNumber: t.transactionNumber,
      date: t.date,
      time: t.time,
      receipt: t.receipt,
      description: t.description,
      charges: t.charges,
      credits: t.credits,
      balance: t.balance,
      flowType: t.flowType,
    }));
    if (tamper) tamper(clientRows);
    return {
      files: [
        {
          fileName: FILE_NAME,
          fileType: 'xlsx',
          fileHash,
          batchId,
          fileSizeBytes: workbook.length,
          warnings: [],
          transactions: clientRows,
        },
      ],
    };
  }

  /** Full happy path: upload → confirm → poll the deferred classification. */
  async function runFullImport() {
    const batchId = await uploadWorkbook();
    const confirmation = await ctx.imports.confirm(
      fx.condominiumId,
      await confirmDtoFor(batchId),
      fx.actor,
    );
    const terminal = await waitForBatchTerminal(ctx.prisma, batchId);
    return { batchId, confirmation, terminal };
  }

  it('upload stores the file in storage and creates a PENDING batch with the canonical sha256 fileHash', async () => {
    const batchId = await uploadWorkbook();

    const batch = await ctx.prisma.importBatch.findUniqueOrThrow({
      where: { id: batchId },
    });
    expect(batch.status).toBe('PENDING');
    expect(batch.fileHash).toBe(fileHash); // canonical sha256 of the raw buffer
    expect(batch.fileName).toBe(FILE_NAME);
    expect(batch.fileType).toBe('xlsx');
    expect(batch.storageProvider).toBe('r2');
    expect(batch.storageKey).toBe(
      `condominiums/${fx.condominiumId}/imports/${batchId}/${FILE_NAME}`,
    );

    // The stub holds the exact bytes — confirm() will re-download and re-hash them.
    const stored = ctx.storage.files.get(batch.storageKey!);
    expect(stored).toBeDefined();
    expect(stored!.equals(workbook)).toBe(true);
    expect(sha256(stored!)).toBe(fileHash);

    // No transactions before confirm — upload only queues.
    const txCount = await ctx.prisma.transaction.count({
      where: { importBatchId: batchId },
    });
    expect(txCount).toBe(0);
  });

  it('runs the full e2e flow: confirm persists transactions and the deferred classification lands the batch COMPLETED with the persisted summary', async () => {
    const { batchId, confirmation, terminal } = await runFullImport();

    // confirm() responds before classification: status 'processing' + poll handle.
    expect(confirmation.files[0]).toMatchObject({
      fileName: FILE_NAME,
      status: 'processing',
      batchId,
      imported: 3,
      duplicateFile: false,
    });
    expect(confirmation.totalImported).toBe(3);
    expect(confirmation.pendingBatchIds).toEqual([batchId]);
    expect(confirmation.files[0].reconciliation).toMatchObject({
      clientRowCount: 3,
      serverRowCount: 3,
      mismatchCount: 0,
    });

    // Terminal state — COMPLETED with the ENGINE-058 persisted summary columns.
    expect(terminal.status).toBe('COMPLETED');
    expect(terminal.completedAt).not.toBeNull();
    expect(terminal.transactionCount).toBe(3);
    expect(terminal.classifiedCount).toBe(2);
    expect(terminal.needsReviewCount).toBe(1);
    expect(terminal.unmatchedCount).toBe(1);
    expect(terminal.classifiedAt).not.toBeNull();

    // Transactions persisted from the SERVER re-parse of the retained file.
    const rows = await ctx.prisma.transaction.findMany({
      where: { importBatchId: batchId },
    });
    expect(rows).toHaveLength(3);
    expect(Number(terminal.totalIncome)).toBe(3500);
    expect(Number(terminal.totalExpenses)).toBe(800);
  });

  it('rule-matched rows end AUTO and the orphan row ends NEEDS_REVIEW after the deferred classification', async () => {
    const { batchId } = await runFullImport();

    const byDescription = async (description: string) =>
      ctx.prisma.transaction.findFirstOrThrow({
        where: { importBatchId: batchId, description },
      });

    const expense = await byDescription('PAGO CFE LUZ');
    expect(expense.classificationStatus).toBe('AUTO');
    expect(expense.expenseCategoryId).toBe(fx.expenseCategoryId);
    expect(expense.matchedRuleId).toBe(fx.expenseRuleId);

    const unitMatched = await byDescription('CUOTA101');
    expect(unitMatched.classificationStatus).toBe('AUTO');
    expect(unitMatched.residentId).toBe(fx.residentId);

    const orphan = await byDescription('DEPOSITO NO IDENTIFICADO');
    expect(orphan.classificationStatus).toBe('NEEDS_REVIEW');
    expect(orphan.residentId).toBeNull();
  });

  it('rejects a second confirm of the same completed batch as a duplicate (DUPLICATE_FILE, 409)', async () => {
    const { batchId } = await runFullImport();

    // The batch is COMPLETED with transactions → the duplicate guard fires
    // before the optimistic IMPORT_BATCH_RACE precondition is ever reached,
    // and the single-file request escalates to 409 (UF-017).
    const err: unknown = await ctx.imports
      .confirm(fx.condominiumId, await confirmDtoFor(batchId), fx.actor)
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ConflictException);
    expect((err as ConflictException).getResponse()).toMatchObject({
      code: 'DUPLICATE_FILE',
    });

    // No double-insert: still exactly the original 3 rows.
    const txCount = await ctx.prisma.transaction.count({
      where: { importBatchId: batchId },
    });
    expect(txCount).toBe(3);
  });

  it('rejects re-uploading identical content as a duplicate (DUPLICATE_FILE, 409)', async () => {
    const { batchId } = await runFullImport();

    const err: unknown = await ctx.imports
      .upload(fx.condominiumId, uploadFileFor(workbook), fx.actor)
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ConflictException);
    const response = (err as ConflictException).getResponse() as {
      code: string;
      files: { status: string; existingBatchId: string }[];
    };
    expect(response.code).toBe('DUPLICATE_FILE');
    expect(response.files[0]).toMatchObject({
      status: 'duplicate',
      existingBatchId: batchId,
    });

    // No second batch was created for the same content hash.
    const batches = await ctx.prisma.importBatch.count({
      where: { condominiumId: fx.condominiumId, fileHash },
    });
    expect(batches).toBe(1);
  });

  it('lands the batch FAILED with errorMessage when classification blows up — transactions remain persisted', async () => {
    jest
      .spyOn(ClassificationService.prototype, 'classifyBatch')
      .mockRejectedValueOnce(new Error('engine exploded'));

    const batchId = await uploadWorkbook();
    const confirmation = await ctx.imports.confirm(
      fx.condominiumId,
      await confirmDtoFor(batchId),
      fx.actor,
    );
    // confirm itself succeeds — the failure happens out-of-band.
    expect(confirmation.files[0].status).toBe('processing');

    const terminal = await waitForBatchTerminal(ctx.prisma, batchId);
    expect(terminal.status).toBe('FAILED');
    expect(terminal.errorMessage).toContain('Classification failed');
    expect(terminal.errorMessage).toContain('engine exploded');

    // The import itself succeeded: rows are persisted, merely unclassified.
    const rows = await ctx.prisma.transaction.findMany({
      where: { importBatchId: batchId },
    });
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.classificationStatus).toBe('NEEDS_REVIEW');
    }
  });

  it('rejects a tampered confirm payload (modified credit) with PAYLOAD_MISMATCH and persists nothing', async () => {
    const batchId = await uploadWorkbook();

    const tampered = await confirmDtoFor(batchId, (rows) => {
      // Inflate one credit — the classic forged-preview tamper vector (IMP-001).
      rows[1].credits += 100;
      rows[1].balance += 100;
    });

    const err: unknown = await ctx.imports
      .confirm(fx.condominiumId, tampered, fx.actor)
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as BadRequestException).getResponse()).toMatchObject({
      code: 'PAYLOAD_MISMATCH',
      existingBatchId: batchId,
      mismatchCount: 1,
    });

    // The rejection happened before the persistence $transaction: no rows, and
    // the batch never left PENDING (no deferred classification was scheduled).
    const txCount = await ctx.prisma.transaction.count({
      where: { importBatchId: batchId },
    });
    expect(txCount).toBe(0);
    const batch = await ctx.prisma.importBatch.findUniqueOrThrow({
      where: { id: batchId },
    });
    expect(batch.status).toBe('PENDING');
  });
});
