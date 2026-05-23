# 07 — Reconciliation Rules

**Tier**: 2 — Crítico financiero (reglas que alimentan classification)
**Rutas**: `src/modules/reconciliation-rules/` (7 files, 368 LOC, 0 specs)
**Modelo Prisma**: `ReconciliationRule`

---

## 1. Estado actual de cobertura

| Estado | Detalle |
|---|---|
| Tests existentes | **ninguno** |

---

## 2. Inventario de unidades testables

### 2.1 Service (`reconciliation-rules.service.ts` 173 LOC)

| Método | Complejidad | Cubre |
|---|---|---|
| `create()` | Media | Decimal precision para `confidenceThreshold` (default 0.80); emit `RECONCILIATION_RULE_MODIFIED_EVENT` (best-effort try/catch) |
| `update()` | Media | Partial; emite event con action='updated' |
| `findAll()` | Baja | Paginated; orderBy `[priority asc, createdAt asc]` |
| `findActive()` | Baja | Filtra `isActive=true`; orden por priority |
| `toggleActive()` | Baja | Flip boolean + event |
| `remove()` | Baja | Delete + event |

### 2.2 Controller (`reconciliation-rules.controller.ts` 100 LOC)

CRUD endpoints + toggleActive. Role-gated (TENANT_ADMIN+).

### 2.3 DTOs

`CreateReconciliationRuleDto`: name, keywords[], unitPatterns[], conceptType, confidenceThreshold (0-1 Decimal), priority, isActive.

---

## 3. Pruebas unitarias sugeridas

| Archivo | Casos clave |
|---|---|
| `reconciliation-rules/reconciliation-rules.service.spec.ts` | `create`: Decimal('0.80') default; emit event con action='created'; failure de emit NO falla create (best-effort try/catch); `update`: partial; emit action='updated'; `findAll`: orderBy priority+createdAt; pagination; `findActive`: isActive=true; `toggleActive`: flip + event; `remove`: delete + event |
| `reconciliation-rules/reconciliation-rules.controller.spec.ts` | Endpoint delegation + role guards |
| `reconciliation-rules/dto/__tests__/dtos.spec.ts` | Confidence ∈ [0, 1]; keywords array; conceptType enum; priority int |

**Total**: 3 archivos, ~22 casos.

---

## 4. Pruebas e2e sugeridas

| Archivo | Flujos |
|---|---|
| `test/reconciliation-rules-crud.e2e-spec.ts` | POST create con keywords + confidenceThreshold; GET list ordered by priority; PATCH update; PATCH toggleActive; DELETE; verify event emitido (audit log) |
| `test/reconciliation-rules-integration.e2e-spec.ts` | Crear rule "Mantenimiento" (keywords=["cuota","mantenimiento"], conf=0.85); import con descripción matching → classification asigna `matchedRuleId` y `confidenceScore=0.85`; toggleActive false → nuevo import no aplica rule |

**Total e2e**: 2 archivos, ~10 escenarios.

---

## 5. Estimación de tiempo Claude Code

| Bloque | Archivos | Min |
|---|---:|---:|
| Service spec | 1 | 20–30 |
| Controller spec | 1 | 10–15 |
| DTOs spec | 1 | 10–15 |
| e2e (2 archivos) | 2 | 60–100 |
| **Subtotal** | **5** | **100–160 min** |
| Margen 18 % | — | +20–30 |
| **Total estimado** | — | **120–190 min ≈ 2–3 sesiones** |

Mediana ≈ **155 min ≈ 2.5 h de Claude Code**.

---

## 6. Fases internas

- **F1 — Service + controller + DTOs**: 1 sesión.
- **F2 — e2e (CRUD + integration con classification)**: 1.5 sesiones.

---

## 7. Prerrequisitos / refactors

Ninguno. Para el e2e de integración, depende de classification module (`05`) — coordinar el orden.

---

## 8. Restricciones / notas

- **Decimal precision**: confidenceThreshold se almacena como `Prisma.Decimal('0.80')` — tests verifican `toFixed(2)`.
- **Event emission best-effort**: si `emit` falla, el create NO falla. Tests fijan esa invariante.
- **Priority ordering**: rules con priority menor evalúan primero (first-match). En empate, createdAt asc.
- **Reglas activas alimentan classification**: cambio aquí afecta a transacciones futuras. Test e2e verifica el ciclo completo.
