# 09 — Collection (Tracking de Cobranza)

**Tier**: 2 — Crítico financiero
**Rutas**: `src/modules/collection/` (5 files, 361 LOC, 0 specs)
**Modelo Prisma**: `CollectionRecord`, `Resident`, `Transaction`

---

## 1. Estado actual de cobertura

| Estado | Detalle |
|---|---|
| Tests existentes | **ninguno** |

---

## 2. Inventario de unidades testables

### 2.1 Service (`collection.service.ts` 199 LOC)

| Método | Complejidad | Cubre |
|---|---|---|
| `findAll(condominiumId, year)` | Baja | Paginated CollectionRecord query (default 200, max 1000) |
| `findByResident(condominiumId, residentId)` | Baja | Histórico de pagos por resident |
| `getAccountStatement(residentId, year)` | **Alta** | 4-way Promise.all: transactions paginated + count + income aggregate + collectionRecords; calcula `balance = totalPaid - totalExpected`, `monthsPaid`, `monthsUnpaid` |
| `update(id, dto)` | Media | Update status/amount; recalcula resident.paymentStatus (puede mover CURRENT↔OVERDUE) |

### 2.2 Controller (`collection.controller.ts` 80 LOC)

3 endpoints. Role-gated.

### 2.3 DTOs

`ListCollectionDto`: year, page, limit (default 200, max 1000 — CLAUDE.md §5).
`AccountStatementDto`: residentId, year, month opcional.

---

## 3. Pruebas unitarias sugeridas

| Archivo | Casos clave |
|---|---|
| `collection/collection.service.spec.ts` | `findAll`: pagination shape; year filter; tenant scope; `findByResident`: solo records del resident; `getAccountStatement`: balance = totalPaid - totalExpected; monthsPaid = filter (PAID_ON_TIME | PAID_LATE); monthsUnpaid = filter (UNPAID | PENDING); Promise.all 4 queries; `update`: status transitions; resident.paymentStatus se recalcula (mock prisma update) |
| `collection/collection.controller.spec.ts` | Endpoint delegation |
| `collection/dto/__tests__/dtos.spec.ts` | year sanity; limit <= 1000 |

**Total**: 3 archivos, ~20 casos.

---

## 4. Pruebas e2e sugeridas

| Archivo | Flujos |
|---|---|
| `test/collection-account-statement.e2e-spec.ts` | GET `/residents/:id/account-statement?year=2026&month=5` → resident profile + transactions paginated + collectionRecords + summary; balance match; monthsPaid/monthsUnpaid correct |
| `test/collection-list.e2e-spec.ts` | GET `/collection?year=2026&limit=600` → 12 meses por resident; status enum correcto |
| `test/collection-update.e2e-spec.ts` | PATCH `/collection/:id { status: PAID_ON_TIME, amountPaid: 5000, paymentDate }` → record updated; resident.paymentStatus se actualiza si aplica |

**Total e2e**: 3 archivos, ~12 escenarios.

---

## 5. Estimación de tiempo Claude Code

| Bloque | Archivos | Min |
|---|---:|---:|
| Service spec | 1 | 25–40 |
| Controller spec | 1 | 10–15 |
| DTOs spec | 1 | 10–15 |
| e2e (3 archivos) | 3 | 90–135 |
| **Subtotal** | **6** | **135–205 min** |
| Margen 18 % | — | +25–40 |
| **Total estimado** | — | **160–245 min ≈ 3–4 sesiones** |

Mediana ≈ **200 min ≈ 3.5 h de Claude Code**.

---

## 6. Fases internas

- **F1 — Service + controller + DTOs**: 1.5 sesiones.
- **F2 — e2e (statement + list + update)**: 2 sesiones.

---

## 7. Prerrequisitos / refactors

Ninguno.

---

## 8. Restricciones / notas

- **Balance calculation** invariant: `totalPaid - totalExpected`. Tests con números reales (no `1+1`).
- **CollectionStatus enum** completo: PAID_ON_TIME, PAID_LATE, UNPAID, PENDING, PARTIAL, AGREEMENT, ADJUSTMENT.
- **Promise.all 4 queries** — invariant de performance: no awaits seriales.
- **Resident.paymentStatus recalculation** al update — coordinado con reports module (`08`).
- **Pagination defaults** (CLAUDE.md §5): collection 200/1000.
