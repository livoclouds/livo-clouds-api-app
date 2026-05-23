# 10 — Petty Cash (Caja Chica + Folio Race)

**Tier**: 2 — Crítico financiero (incluye el patrón canónico de P2002 retry)
**Rutas**: `src/modules/petty-cash/` (5 files, 368 LOC, 0 specs)
**Modelo Prisma**: `PettyCashMovement` (constraint `@@unique([condominiumId, folio])`)

---

## 1. Estado actual de cobertura

| Estado | Detalle |
|---|---|
| Tests existentes | **ninguno** |
| **Patrón crítico documentado**: `MAX_FOLIO_RETRIES = 5` con P2002 catch (CLAUDE.md §5; ref petty-cash.service.ts:82-117) |

---

## 2. Inventario de unidades testables

### 2.1 Service (`petty-cash.service.ts` 153 LOC)

| Método | Complejidad | Cubre |
|---|---|---|
| `create()` | **Crítica** | Folio race: loop up to MAX_FOLIO_RETRIES; catch P2002 con `meta.target.includes('folio')`; running balance: ENTRY/REIMBURSEMENT suma, EXIT/ADJUSTMENT resta |
| `findAll()` | Baja | Paginated |
| `findOne()` | Baja | Single |
| `approve()` | Media | Status guard: solo PENDING → APPROVED; idempotent updateMany |
| `reject()` | Media | Status guard: solo PENDING → REJECTED |

### 2.2 Controller (`petty-cash.controller.ts` 100 LOC)

CRUD endpoints. Role-gated.

### 2.3 DTOs

`CreateMovementDto`: movementType enum (ENTRY/EXIT/ADJUSTMENT/REIMBURSEMENT), amount > 0, date, category enum, concept.

---

## 3. Pruebas unitarias sugeridas

| Archivo | Casos clave |
|---|---|
| `petty-cash/petty-cash.service.spec.ts` | `create`: ENTRY suma a runningBalance previo; EXIT resta; REIMBURSEMENT resta (clarificar con backend si es correcto); ADJUSTMENT resta; **folio race**: mock prisma.create para throw P2002 una vez → retry → success; mock para throw 5 veces → ConflictException; mock para throw otro error (no P2002) → propaga sin retry; folio formato `PC-0001` padding; `approve`: PENDING → APPROVED ok; non-PENDING → BadRequestException; `reject`: similar |
| `petty-cash/petty-cash.controller.spec.ts` | Endpoint delegation |
| `petty-cash/dto/__tests__/dtos.spec.ts` | movementType enum; amount > 0; category enum |

**Total**: 3 archivos, ~25 casos.

---

## 4. Pruebas e2e sugeridas

| Archivo | Flujos |
|---|---|
| `test/petty-cash-folio-race.e2e-spec.ts` ⭐ | **2+ requests concurrentes** create con misma data → thread 1 obtiene PC-0001, thread 2 colisiona en P2002 → retry → obtiene PC-0002; assert ambos folios únicos |
| `test/petty-cash-running-balance.e2e-spec.ts` | ENTRY 1000 → balance 1000; EXIT 300 → balance 700; ENTRY 500 → balance 1200; verificar acumulativo |
| `test/petty-cash-approval.e2e-spec.ts` | create → status PENDING; approve → APPROVED; intento re-approve → BadRequestException; reject de otra movement → REJECTED |

**Total e2e**: 3 archivos, ~12 escenarios.

---

## 5. Estimación de tiempo Claude Code

| Bloque | Archivos | Min |
|---|---:|---:|
| Service spec (race condition compleja) | 1 | 35–55 |
| Controller + DTOs | 2 | 25–40 |
| e2e (race + balance + approval) | 3 | 100–160 |
| **Subtotal** | **6** | **160–255 min** |
| Margen 20 % | — | +30–50 |
| **Total estimado** | — | **190–305 min ≈ 3–5 sesiones** |

Mediana ≈ **250 min ≈ 4 h de Claude Code**.

---

## 6. Fases internas

- **F1 — Service spec (folio race + balance)**: 1.5 sesiones.
- **F2 — Controller + DTOs**: 0.5 sesión.
- **F3 — e2e (folio race ⭐ + balance + approval)**: 2 sesiones.

---

## 7. Prerrequisitos / refactors

Ninguno. El patrón P2002 retry es **referencia canónica** del repo (CLAUDE.md §5 cita explícitamente `petty-cash.service.ts:82-117`).

---

## 8. Restricciones / notas

- **MAX_FOLIO_RETRIES = 5** invariant. Después de 5 fallos consecutivos → ConflictException. Test fija el cap.
- **P2002 narrow catch**: solo si `meta.target.includes('folio')`. Otros P2002 (de otros uniques) deben propagarse. Test esto.
- **Folio formato**: `PC-` + `String(N).padStart(4, '0')`. Pruebas con N=1, 10, 1000, 10000 (padding crece o se mantiene).
- **Running balance**: depende del `lastMovement.runningBalance`. En concurrencia, dos creates simultáneos pueden generar balance inconsistente si el orden cambia entre el read del lastMovement y el insert. **El e2e race debe verificar este caso o documentar la limitación**.
- **Status guard**: PENDING-only para approve/reject. Test bloquea re-approve / approve-tras-reject.
