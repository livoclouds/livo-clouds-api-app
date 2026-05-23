# 04 — Imports (Pipeline de Extractos Bancarios)

**Tier**: 2 — Crítico financiero (el módulo más expuesto del Tier)
**Rutas**: `src/modules/imports/` (11 files, **2 605 LOC**) — uno de los más grandes del repo
**Modelos Prisma**: `ImportBatch`, `Transaction`, `BankProfile`

---

## 1. Estado actual de cobertura

| Estado | Detalle |
|---|---|
| Tests existentes | **ninguno** (0 specs) — gap más grande del Tier 2 |
| Datos | producción (no mock) |

---

## 2. Inventario de unidades testables

### 2.1 Service (`imports.service.ts` ~1 420 LOC) — pipeline completo

| Bloque / Método | Complejidad | Cubre |
|---|---|---|
| `upload()` | Alta | SHA-256 dedup, magic-byte check, R2 upload, batch en `PENDING` |
| `preview()` | Alta | Parser (Excel/PDF), bank profile selection, returns parsed rows |
| `confirm()` | **Crítica** | Re-parse desde R2, validation (>30% inválidas → reject), reconciliation (tampering detection), bulk insert (chunks 500), `setImmediate(runClassificationAsync)` |
| `runClassificationAsync()` | **Crítica** | PENDING → PROCESSING → COMPLETED/FAILED; emite events; classification.classifyBatch() |
| `findAll()`, `findOne()`, `remove()` | Baja | List/get/delete batches |
| `validateRows()` (helper interno) | Alta | Threshold 0.30 (CLAUDE.md §11 Stage 3) |
| `reconcileRows()` (helper interno) | Alta | Detecta `Math.abs(clientAmt - serverAmt) > 0.005` → 422 PAYLOAD_MISMATCH (balance es vector de tampering explícito) |
| `isXlsxMagicBytes()` / `isPdfMagicBytes()` | Baja | Anti-spoofing (header bytes) |
| `computeHash()` | Baja | SHA-256 buffer → hex |

### 2.2 Parsers (`parser/` 1 050+ LOC) — helpers puros, listos para testear sin refactor

| Helper | Complejidad | Cubre |
|---|---|---|
| `excel.parser.ts` (~800 LOC) | Alta | Multi-stage: magic bytes → header detection (≥4 column matches) → column aliases (ES/EN) → row parse → date parse (5 formatos) → amount parse |
| `pdf.parser.ts` (~300 LOC) | Media | Text extraction (`pdf-parse`), multiline transaction assembly, regex de fecha/monto |
| `default-aliases.ts` (~200 LOC) | Baja | Constantes de aliases por banco/idioma |
| `types.ts` | — | Solo tipos |

### 2.3 Controller (`imports.controller.ts` 214 LOC)

Endpoints con `@Throttle({ burst: 5/10s, sustained: 20/60s })` (upload, preview, confirm).

### 2.4 DTOs

| DTO | Validaciones |
|---|---|
| `ConfirmImportDto` | batchId, rows array (cliente puede pasar amounts modificados → reconcile los detecta) |
| `ListImportBatchesDto` | page, limit (default 50, max 200), status filter, dateFrom/dateTo |

### 2.5 Events

- `IMPORT_COMPLETED`, `IMPORT_FAILED`, `IMPORT_WARNING`, `IMPORT_DUPLICATE`.

---

## 3. Pruebas unitarias sugeridas

| Archivo | Casos clave |
|---|---|
| `imports/imports.service.spec.ts` | `upload`: hash dedup retorna existingBatchId; magic bytes inválidos → reject (XLSX/PDF); >20 MB → 413; >5 archivos por batch → 400; `preview`: parser invocado; bank profile aplicado; `confirm`: re-parse desde R2 + hash mismatch → IMPORT_HASH_MISMATCH; validation 0.30 threshold; reconcile tampering → 422; bulk insert chunks 500; `runClassificationAsync`: PENDING→PROCESSING→COMPLETED; en error → FAILED + IMPORT_FAILED event; status determinado correctamente (error/warning/success) |
| `imports/parser/excel.parser.spec.ts` | 5 formatos de fecha (DD/MM/YYYY, ISO, Spanish long "30 de abril de 2026", English long "30-Apr-2026", Excel serial); amounts negativos en paréntesis; symbols stripped (`$`, `,`, espacios); header detection ≥4 matches; column aliases ES/EN; rows sin date → invalid; flowType detection (credits→INCOME, charges→EXPENSE) |
| `imports/parser/pdf.parser.spec.ts` | Multiline transaction assembly; date extraction; amount extraction con regex; PDFs escaneados sin texto → user-friendly error; periodo del rango de transacciones; texto encriptado → graceful error |
| `imports/imports.controller.spec.ts` | Endpoint delegation + DTO binding + Throttle metadata aplicada |
| `imports/dto/__tests__/dtos.spec.ts` | ConfirmImportDto batchId required; rows array required; ListImportBatchesDto page>=1, limit<=200, dateFrom<dateTo |

**Total**: 5 archivos, ~75 casos.

---

## 4. Pruebas e2e sugeridas

| Archivo | Flujos |
|---|---|
| `test/imports-upload-cycle.e2e-spec.ts` | POST upload [xlsx 100 rows] → status='queued'; poll GET /imports/:id hasta COMPLETED; verify `transactionCount=100`, `totalIncome` y `totalExpenses` match parsed sums; classification status per row |
| `test/imports-validation-reject.e2e-spec.ts` | POST upload [xlsx 1000 rows, 400 con fecha inválida] → preview muestra invalidRatio=0.40; confirm → 400 INVALID_ROWS_EXCEEDED; batch queda PENDING (no se persisten transactions) |
| `test/imports-dedup.e2e-spec.ts` | upload file A → COMPLETED; re-upload misma file → 409 con `existingBatchId`; sin nueva fila persistida |
| `test/imports-tampering.e2e-spec.ts` | preview → cliente modifica `row[5].credits 100 → 500` → confirm → 422 PAYLOAD_MISMATCH; balance modificado también capturado; audit `IMPORT_TAMPERING_DETECTED` |
| `test/imports-magic-bytes.e2e-spec.ts` | upload .pdf MIME pero contenido Excel → reject (mismatch); upload .xlsx MIME pero contenido random → reject |
| `test/imports-double-confirm.e2e-spec.ts` | Dos requests `confirm` paralelos sobre el mismo batchId → updateMany con precondition (updatedAt, status) gana uno; el otro recibe error (race controlada) |

**Total e2e**: 6 archivos, ~28 escenarios.

---

## 5. Estimación de tiempo Claude Code

| Bloque | Archivos | Min |
|---|---:|---:|
| Service spec (compleja, multi-rama) | 1 | 55–90 |
| Excel parser spec (alta — multi-formato) | 1 | 50–75 |
| PDF parser spec | 1 | 30–45 |
| Controller spec | 1 | 15–25 |
| DTOs spec | 1 | 15–25 |
| e2e (6 archivos — algunos requieren fixtures de archivo real) | 6 | 250–420 |
| **Subtotal** | **11** | **415–680 min** |
| Margen 20 % | — | +85–135 |
| **Total estimado** | — | **500–815 min ≈ 8–14 sesiones** |

Mediana ≈ **660 min ≈ 11 h de Claude Code**.

---

## 6. Fases internas

- **F1 — Parsers (excel + pdf)**: 2 sesiones. Tests sin servicio — puros.
- **F2 — Service spec**: 2 sesiones.
- **F3 — Controller + DTOs**: 1 sesión.
- **F4 — e2e cycle + validation + dedup**: 3 sesiones.
- **F5 — e2e tampering + magic bytes + double-confirm**: 3 sesiones.

---

## 7. Prerrequisitos / refactors

- **Fixtures de archivo**: e2e necesita archivos `.xlsx` y `.pdf` con contenido conocido. Crearlos en `test/fixtures/imports/` (incluir uno válido, uno con 40% inválidas, uno con fecha en formato español, uno con magic bytes mismatch).
- Sin refactor de código fuente requerido — la lógica ya está bien encapsulada en service + parsers.

---

## 8. Restricciones / notas

- **El pipeline más sensible del repo**: un bug aquí miscategoriza cobros y mueve KPIs de todos los condominios. Cobertura objetivo: **100% del service y parsers**.
- **Tampering detection** (CLAUDE.md, Phase 2 IMP-001): test debe verificar que el rechazo deja forensic trace antes del rejection (audit log written first).
- **Async classification ownership** (UF-007): `setImmediate(runClassificationAsync)` libera la HTTP request; el test debe esperar al completion vía polling de status.
- **Throttling**: `@Throttle` aplicado; un test de carga (sustained 20/60s) genera 429 — se cubre como integration test si se quiere, no unit.
- **Schema invariant** (CLAUDE.md §11): `@@unique` no aplica directamente aquí pero el pipeline depende del invariante de unique pago/dedup hash.
- **Concurrencia double-confirm**: el `updateMany` con precondition `(updatedAt, status)` es el guardián — test e2e lo cubre.
