# 08 — Reports (Reportes Financieros)

**Tier**: 2 — Crítico financiero
**Rutas**: `src/modules/reports/` (5 files, 319 LOC, 0 specs)
**Modelos Prisma**: `Resident`, `CollectionRecord`, `Transaction`, `FinancialMonthlySummary`

---

## 1. Estado actual de cobertura

| Estado | Detalle |
|---|---|
| Tests existentes | **ninguno** |

---

## 2. Inventario de unidades testables

### 2.1 Service (`reports.service.ts` 179 LOC)

| Método | Complejidad | Cubre |
|---|---|---|
| `getOverdue()` | Media | Filter residents `paymentStatus='OVERDUE'`+`deletedAt: null`; opcional `minDebt`; include collectionRecords con status ∈ {UNPAID, PARTIAL}; orderBy `debt desc` |
| `getCollectionMatrix(year)` | Media | Grid residents × meses; usa CollectionRecord para ese año |
| `getExecutiveSummary(year, month)` | Alta | 4-way Promise.all: income aggregate, expense aggregate, resident groupBy, collection groupBy → KPI `{totalIncome, totalExpenses, netBalance, collectionRate, currentResidents, overdueResidents, collectionByStatus}` |

**Cálculo financiero**:
- `netBalance = totalIncome - totalExpenses`.
- `collectionRate = Math.round((currentResidents / totalResidents) * 100)`.

### 2.2 Controller (`reports.controller.ts` 100 LOC)

3 endpoints + DTOs validan year (4 dígitos), month (1-12), minDebt opcional.

### 2.3 DTOs

`ListOverdueDto`, `ListCollectionMatrixDto`, `ExecutiveSummaryDto`.

---

## 3. Pruebas unitarias sugeridas

| Archivo | Casos clave |
|---|---|
| `reports/reports.service.spec.ts` | `getOverdue`: filtra OVERDUE + non-deleted; minDebt threshold; include collectionRecords filtrados; orderBy debt desc; pagination shape; `getCollectionMatrix`: 12 meses por resident; status agregado; `getExecutiveSummary`: Promise.all evita serial; collectionRate calculado correctamente (8/10=80); netBalance = income - expense; arr vacío handling (no division by 0) |
| `reports/reports.controller.spec.ts` | Endpoint delegation + role guards |
| `reports/dto/__tests__/dtos.spec.ts` | year >= 2020 (sanity); month ∈ 1..12; minDebt >= 0 |

**Total**: 3 archivos, ~22 casos.

---

## 4. Pruebas e2e sugeridas

| Archivo | Flujos |
|---|---|
| `test/reports-overdue.e2e-spec.ts` | GET `/reports/overdue?minDebt=5000` → solo OVERDUE con debt >= 5000; orderBy debt desc; include collectionRecords UNPAID/PARTIAL |
| `test/reports-collection-matrix.e2e-spec.ts` | GET `/reports/collection-matrix?year=2026` → grid completa; status por mes; soft-deleted residents excluidos |
| `test/reports-executive-summary.e2e-spec.ts` | GET `/reports/executive-summary?year=2026&month=5` → KPIs correctos; netBalance match; collectionRate match; totalResidents = current + overdue |

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
- **F2 — e2e (3 reportes)**: 2 sesiones.

---

## 7. Prerrequisitos / refactors

Ninguno. Para los e2e, seed data debe poblar residents con `paymentStatus` y collectionRecords.

---

## 8. Restricciones / notas

- **División por cero** en collectionRate: si `totalResidents === 0` → return 0. Test debe cubrir el caso de condominio sin residents.
- **Aggregation key**: `Math.round((currentCount / totalResidents) * 100)` — un test con (8, 10) → 80; (7, 10) → 70; (0, 0) → 0.
- **Promise.all** invariant: el service ejecuta los 4 queries en paralelo. Test puede verificar que no haya `await` secuencial (más complejo, opcional).
- **Soft-deleted residents** excluidos: tests cubren caso donde un resident soft-deleted no aparece en el matrix.
