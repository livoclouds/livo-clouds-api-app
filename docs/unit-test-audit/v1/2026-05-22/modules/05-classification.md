# 05 — Classification (Motor de Clasificación)

**Tier**: 2 — Crítico financiero
**Rutas**: `src/modules/classification/` (12 files, 3 232 LOC, 3 specs)
**Modelos Prisma**: `Transaction` (classification fields), `ReconciliationRule`, `ReconciliationCorrectionPattern`, `FinancialMonthlySummary`, `CalendarEvent` (terrace matching)

---

## 1. Estado actual de cobertura

| Archivo | Cubre |
|---|---|
| `classification.service.spec.ts` (864 LOC, ~50 it) ✅ | Rule matching básico; unit extraction; confidence scoring; mock Prisma + EventEmitter |
| `terrace-keywords.util.spec.ts` (~10 tests) ✅ | Normalización de keywords |
| `terrace-booking-matcher.spec.ts` (385 LOC, ~30 tests) ✅ | Matching de terrace events |
| **Gaps**: bulk operations, period detection, double-override edge cases, controller, DTOs | — |

Cobertura efectiva: ~50% (core ok, bulk + controller no).

---

## 2. Inventario de unidades testables

### 2.1 Service (`classification.service.ts` ~1 200 LOC)

| Método | Complejidad | Cubre | Status |
|---|---|---|---|
| `classifyBatch()` | **Crítica** | Itera transactions; aplica rules; resident matching; period detection | ✅ parcial |
| `reclassifyBatch()` | Alta | Re-run en un batch existente | ❌ |
| `manualMatch()` | Alta | Cliente especifica residentId; MatchSource=MANUAL_RESIDENT | ✅ |
| `manualClassify()` | Alta | Cliente fuerza ClassificationStatus | ❌ |
| `bulkReconcile()` | **Alta** | APPROVE/IGNORE/REOPEN sobre N transactions; throttled | ❌ |
| `unmatch()` | Media | Limpia residentId + matchSource; audit | ❌ |
| `approve()`, `ignore()`, `reopen()` | Media | Status → APPROVED/IGNORED/PENDING; audit; affects reports | ❌ |
| `extractFromText()` | Media | Pure: unit number regex, concept keywords, periodo (MONTH_MAP, year) | ✅ parcial |
| `applyDbRules()` | Media | Pure: keyword AND match, unit pattern OR match, score=rule.confidenceThreshold | ✅ |
| `matchToResident()` | Alta | Score >= 0.8 → AUTO, sino NEEDS_REVIEW + reason | ✅ |

### 2.2 Helpers ya extraídos ✅

`terrace-booking-matcher.ts`, `terrace-keywords.util.ts` — ya con tests.

### 2.3 Controller (`classification.controller.ts` 180 LOC)

8 endpoints con throttling:
- Single-tx: `manualMatch`, `manualClassify`, `unmatch`, `approve`, `ignore`, `reopen` → `@Throttle({ burst: 10, sustained: 60 })`.
- Bulk: `reclassifyBatch`, `bulkReconcile` → `@Throttle({ burst: 5, sustained: 20 })`.

### 2.4 DTOs

`ManualMatchDto`, `ManualClassifyDto`, `BulkReconcileDto` (ids array + action enum).

---

## 3. Pruebas unitarias sugeridas

| Archivo | Casos clave |
|---|---|
| `classification/classification.service.spec.ts` (ampliar) | `reclassifyBatch`: re-corre sobre batch existente; transactions previas se reclasifican; `bulkReconcile`: APPROVE 50 tx → status=APPROVED en todas; throttle preserva contar; `manualClassify`: fuerza status MANUAL_OVERRIDE; `approve`/`ignore`/`reopen`: transición correcta; period detection: meses ES (enero..diciembre) + EN (january..december) + año 4 dígitos; period MONTH_MAP completo; unit matching ambiguity (2 residents mismo unitNumber) → NEEDS_REVIEW reason=UNIT_AMBIGUOUS; resident not found → reason=UNIT_NOT_FOUND |
| `classification/classification.controller.spec.ts` | Cada endpoint llama el método correcto; throttle decorators presentes |
| `classification/dto/__tests__/dtos.spec.ts` | `BulkReconcileDto`: action enum (APPROVE/IGNORE/REOPEN); ids no vacío; `ManualMatchDto`: residentId UUID; `ManualClassifyDto`: status enum + opcionales |

**Total**: 1 ampliación + 2 nuevos = 3 archivos, ~40 casos.

---

## 4. Pruebas e2e sugeridas

| Archivo | Flujos |
|---|---|
| `test/classification-auto.e2e-spec.ts` | Import con "Pago Casa 101 Mantenimiento Enero 2026" → classifyBatch → tx.classificationStatus=AUTO, matchSource=AUTO_UNIT_NUMBER, residentId set, paymentPeriodMonth=1, paymentPeriodYear=2026 |
| `test/classification-manual-override.e2e-spec.ts` | Tx NEEDS_REVIEW (UNIT_NOT_FOUND) → PATCH /transactions/:id/match {residentId} → status=MANUAL_OVERRIDE, matchSource=MANUAL_RESIDENT |
| `test/classification-bulk.e2e-spec.ts` | POST /transactions/bulk-reconcile {ids:[50], action:APPROVE} → todas con reconciliationStatus=APPROVED; throttle a 5 burst funciona |
| `test/classification-terrace.e2e-spec.ts` | Import con "Renta Terraza 2026-06-15 ABC" + CalendarEvent existe en esa fecha → matchSource=TERRACE_BOOKING, matchedCalendarEventId set |
| `test/classification-period.e2e-spec.ts` | Import con 12 rows ("Cuota Enero 2025", ..., "Cuota Diciembre 2025") → FinancialMonthlySummary populated por mes |

**Total e2e**: 5 archivos, ~20 escenarios.

---

## 5. Estimación de tiempo Claude Code

| Bloque | Archivos | Min |
|---|---:|---:|
| Ampliar service spec (gaps: bulk, period, reclassify) | 1 | 40–60 |
| Controller spec | 1 | 15–25 |
| DTOs spec | 1 | 15–25 |
| e2e (5 archivos) | 5 | 200–320 |
| **Subtotal** | **8** | **270–430 min** |
| Margen 18 % | — | +50–80 |
| **Total estimado** | — | **320–510 min ≈ 5–9 sesiones** |

Mediana ≈ **415 min ≈ 7 h de Claude Code**.

---

## 6. Fases internas

- **F1 — Ampliación service spec (bulk + period + reclassify)**: 1.5 sesiones.
- **F2 — Controller + DTOs**: 1 sesión.
- **F3 — e2e (auto, manual, bulk)**: 2 sesiones.
- **F4 — e2e (terrace + period)**: 2 sesiones.

---

## 7. Prerrequisitos / refactors

Ninguno. Helpers complejos ya están extraídos (`terrace-booking-matcher`, `terrace-keywords`).

---

## 8. Restricciones / notas

- **Confidence threshold 0.8** invariant: tests fijan que < 0.8 → NEEDS_REVIEW.
- **Period detection MONTH_MAP** debe cubrir ES (enero, ene, jan) + EN (january, jan). Test debe verificar casos parciales.
- **Bulk throttle**: `@Throttle({ burst: 5 })` — test e2e dispara 6 requests → la 6ª 429.
- **MatchSource enum**: AUTO_UNIT_NUMBER, AUTO_RULE, MANUAL_RESIDENT, TERRACE_BOOKING — tests cubren cada vía.
- **No queue infra** (CLAUDE.md): `setImmediate` para async; tests deben esperar completion vía polling.
- **FinancialMonthlySummary upsert** se dispara desde `classifyBatch` cuando period detectado — tests deben verificar el upsert con (year, month) key.
