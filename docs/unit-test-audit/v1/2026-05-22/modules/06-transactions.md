# 06 — Transactions

**Tier**: 2 — Crítico financiero (ledger maestro)
**Rutas**: `src/modules/transactions/` (5 files, 910 LOC, 1 spec)
**Modelo Prisma**: `Transaction` (con `flowType`, `classificationStatus`, `reconciliationStatus`, `matchSource`, `paymentPeriod*`, `runningBalance`)

---

## 1. Estado actual de cobertura

| Archivo | Cubre |
|---|---|
| `transactions.service.spec.ts` (137 LOC, ~5 it) ✅ | `getAuditChain` solo |
| **Gaps**: `findAll`, `findUnmatched`, `findClassified`, `findReconciled`, CSV export | — |

Cobertura efectiva: ~10%.

---

## 2. Inventario de unidades testables

### 2.1 Service (`transactions.service.ts` 597 LOC)

| Método | Complejidad | Cubre |
|---|---|---|
| `findAll(condominiumId, dto)` | Media | Paginated `findMany + count` (Promise.all); include resident + matchedCalendarEvent; date range |
| `findUnmatched()` | Media | classificationStatus=NEEDS_REVIEW + reconciliationStatus=PENDING |
| `findClassified()` | Media | classificationStatus ∈ {AUTO, MANUAL_OVERRIDE} |
| `findReconciled()` | Media | reconciliationStatus ∈ {APPROVED, IGNORED} |
| `exportClassifiedCsv()` | Alta | Stream chunks 1000-row; EXPORT_HARD_CAP 50 000; columnas configurables; amount signed (INCOME +, EXPENSE −); period YYYY-MM |
| `exportReconciledCsv()` | Alta | Similar pero columnas distintas |
| `getAuditChain(transactionId)` | Baja | Audit log query orderBy createdAt asc ✅ ya cubierto |

### 2.2 Controller (`transactions.controller.ts` 180 LOC)

4 endpoints de listado + 2 de export (CSV streaming). Sin `@Throttle`.

### 2.3 DTOs

`ListTransactionsDto`: page, limit (default 50, max 200 — CLAUDE.md §5), dateFrom, dateTo, flowType, classificationStatus, reconciliationStatus filters.

---

## 3. Pruebas unitarias sugeridas

| Archivo | Casos clave |
|---|---|
| `transactions/transactions.service.spec.ts` (ampliar) | `findAll`: pagination shape; Promise.all evita doble-await; date range overlap; include resident expandido; `findUnmatched`/`findClassified`/`findReconciled`: filtros correctos; `exportClassifiedCsv`: chunks 1000; cap 50 000 + comentario `# TRUNCATED: ...`; amount signed (INCOME +500, EXPENSE -500); period `2026-05` |
| `transactions/transactions.controller.spec.ts` | Cada endpoint llama el método correcto; export devuelve `Content-Type: text/csv`; streaming response |
| `transactions/dto/__tests__/dtos.spec.ts` | `ListTransactionsDto`: page>=1, limit<=200, dateFrom<dateTo, flowType enum, classificationStatus enum |

**Total**: 1 ampliación + 2 nuevos = 3 archivos, ~25 casos.

---

## 4. Pruebas e2e sugeridas

| Archivo | Flujos |
|---|---|
| `test/transactions-list.e2e-spec.ts` | GET `/transactions?dateFrom&dateTo&limit=100` → paginated shape; meta total match; include resident; date range respected |
| `test/transactions-export.e2e-spec.ts` | GET `/transactions/export-classified?columns=rowNumber,date,description,amount,period` → stream CSV; verify amounts signed; period YYYY-MM; > 50 000 → truncation marker |
| `test/transactions-audit-chain.e2e-spec.ts` | Crear tx → classify → manual override → approve → GET `/transactions/:id/audit-chain` → 4 entries chronological |

**Total e2e**: 3 archivos, ~12 escenarios.

---

## 5. Estimación de tiempo Claude Code

| Bloque | Archivos | Min |
|---|---:|---:|
| Ampliar service spec | 1 | 30–45 |
| Controller spec | 1 | 15–25 |
| DTOs spec | 1 | 10–15 |
| e2e (3 archivos — CSV requiere fixture grande) | 3 | 90–150 |
| **Subtotal** | **6** | **145–235 min** |
| Margen 18 % | — | +25–45 |
| **Total estimado** | — | **170–280 min ≈ 3–5 sesiones** |

Mediana ≈ **225 min ≈ 4 h de Claude Code**.

---

## 6. Fases internas

- **F1 — Service + controller + DTOs**: 1.5 sesiones.
- **F2 — e2e (list + audit chain)**: 1.5 sesiones.
- **F3 — e2e export CSV + truncation cap**: 1 sesión.

---

## 7. Prerrequisitos / refactors

Ninguno.

---

## 8. Restricciones / notas

- **EXPORT_HARD_CAP 50 000** invariant: si crece sin límite, OOM en producción.
- **CSV streaming** invariant: no se acumula en memoria; chunks de 1 000.
- **Amount signing** invariant: INCOME +, EXPENSE −. Rotura aquí miscuenta exports.
- **Audit chain** ya cubierto — verificar que sigue verde al ampliar.
- **Pagination defaults** (CLAUDE.md §5): residents 200/500, **transactions 50/200**. Los tests deben aseverar estos defaults.
