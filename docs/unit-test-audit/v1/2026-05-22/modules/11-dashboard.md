# 11 — Dashboard (KPIs Financieros Agregados)

**Tier**: 2 — Financiero (consumido por el dashboard del web)
**Rutas**: `src/modules/dashboard/` (3 files, 203 LOC, 0 specs)
**Modelos**: `Transaction`, `Resident`, `FinancialMonthlySummary`, `CollectionRecord`

---

## 1. Estado actual de cobertura

| Estado | Detalle |
|---|---|
| Tests existentes | **ninguno** |

---

## 2. Inventario de unidades testables

### 2.1 Service (`dashboard.service.ts` 160 LOC)

| Método | Complejidad | Cubre |
|---|---|---|
| `getKpis(year, month)` | Alta | 5-way Promise.all: income aggregate + expense aggregate + resident groupBy + recent transactions + settings; calcula `netBalance`, `collectionRate` |
| `getMonthlyTrend(year)` | **Crítica** | Usa FinancialMonthlySummary cache; fallback a raw `$queryRaw` si summaries vacíos; per-mes collectionRate con 1 decimal |

### 2.2 Controller (`dashboard.controller.ts` 60 LOC)

2 endpoints. Sin DTO formal (year/month como query params validados inline).

---

## 3. Pruebas unitarias sugeridas

| Archivo | Casos clave |
|---|---|
| `dashboard/dashboard.service.spec.ts` | `getKpis`: income suma de credits con flowType=INCOME; expense suma de charges con EXPENSE; netBalance = income - expense; collectionRate (8 current / 10 total = 80); recentTransactions take 20; settings include; `getMonthlyTrend`: usa summaries cuando hay; fallback a raw query cuando summaries.length===0; 12 meses (jan-dec) siempre devueltos (defaults a 0 si mes sin data); collectionRate con 1 decimal (`Math.round(rate * 10) / 10`) |
| `dashboard/dashboard.controller.spec.ts` | Endpoint delegation; year/month validation |

**Total**: 2 archivos, ~18 casos.

---

## 4. Pruebas e2e sugeridas

| Archivo | Flujos |
|---|---|
| `test/dashboard-kpis.e2e-spec.ts` | GET `/dashboard/kpis?year=2026&month=5` → shape correcto; KPIs match seed data; recentActivity max 20 |
| `test/dashboard-trend.e2e-spec.ts` | GET `/dashboard/monthly-trend?year=2026` → 12 entries; fallback SQL probado si seed no popula summaries; collectionRate decimal |

**Total e2e**: 2 archivos, ~8 escenarios.

---

## 5. Estimación de tiempo Claude Code

| Bloque | Archivos | Min |
|---|---:|---:|
| Service spec | 1 | 30–45 |
| Controller spec | 1 | 10–15 |
| e2e (2 archivos) | 2 | 60–90 |
| **Subtotal** | **4** | **100–150 min** |
| Margen 18 % | — | +20–30 |
| **Total estimado** | — | **120–180 min ≈ 2–3 sesiones** |

Mediana ≈ **150 min ≈ 2.5 h de Claude Code**.

---

## 6. Fases internas

- **F1 — Service + controller**: 1 sesión.
- **F2 — e2e (kpis + trend con fallback)**: 1.5 sesiones.

---

## 7. Prerrequisitos / refactors

Ninguno. El raw `$queryRaw` se mockea con `$queryRaw.mockResolvedValue([...])`.

---

## 8. Restricciones / notas

- **División por cero** invariant en `collectionRate`: si `totalResidents === 0` → 0.
- **FinancialMonthlySummary** se popula desde classification (`05`); en seed puede faltar → fallback SQL se ejerce. Test cubre ambos paths.
- **Decimal collectionRate**: per-mes con 1 decimal (`80.0`, `87.5`). KPI snapshot usa 0 decimales (`80`).
- **Tenant scoping**: condominiumId del guard; nunca query param.
