# 15 — Calendar (Eventos + Terrace Bookings)

**Tier**: 3 — Datos (con dimensión financiera vía terrace deposits)
**Rutas**: `src/modules/calendar/` (22 files, 3 852 LOC, 7 specs)
**Modelo**: `CalendarEvent` (incluye terrace metadata JSON)

---

## 1. Estado actual de cobertura

| Archivo | Cubre |
|---|---|
| `calendar.service.spec.ts` (1 136 LOC, ~50 it) ✅ | Recurrence expansion, soft-delete, terrace metadata validation, visibility filtering, updatedById audit, conflict detection |
| `recurrence.spec.ts` (161 LOC) ✅ | RRULE parsing/expansion (FREQ, COUNT, UNTIL) |
| `terrace-metadata.validator.spec.ts` (373 LOC) ✅ | Comprehensive: schema, enum, amount bounds, deduction logic |
| `visibility.util.spec.ts` (71 LOC) ✅ | Role-based predicates |
| `timezone.util.spec.ts` (52 LOC) ✅ | Allowlist |
| `reclassify/calendar-reclassify.service.spec.ts` (140 LOC) ✅ | Listener trigger |
| `reclassify/should-trigger-reclassify.spec.ts` (211 LOC) ✅ | Trigger predicate |

Cobertura efectiva: **~80%** — segundo módulo mejor cubierto. Gaps: controller, DTOs, e2e.

---

## 2. Inventario de unidades testables

Helpers + service core ya cubiertos. Lo que falta:

### 2.1 Controller (`calendar.controller.ts` 77 LOC) — sin cubrir

CRUD endpoints + nested guard application.

### 2.2 DTOs

`CreateCalendarEventDto`, `UpdateCalendarEventDto`, `ListCalendarEventsDto`.

### 2.3 Events emitidos

`CalendarEventCreated`, `Updated`, `Cancelled`, `BookingConfirmed`, `CalendarTerraceChanged`.

---

## 3. Pruebas unitarias sugeridas

| Archivo | Casos clave |
|---|---|
| `calendar/calendar.controller.spec.ts` | Endpoint delegation; CondominiumAccessGuard + RolesGuard aplicados; ListCalendarEventsDto requires from/to |
| `calendar/dto/__tests__/dtos.spec.ts` | EventType enum (GENERAL/TERRACE_BOOKING/...); Visibility enum; ListCalendarEventsDto from/to required ISO8601; page/limit defaults 500/2000 |
| `calendar/calendar.service.spec.ts` (revisar) | Verificar cobertura de event emission (todos los 5 events disparados en los puntos correctos) — añadir asserts si faltan |

**Total**: 1-2 nuevos + revisión = ~12 casos nuevos.

---

## 4. Pruebas e2e sugeridas

| Archivo | Flujos |
|---|---|
| `test/calendar-events-crud.e2e-spec.ts` | POST general event; GET list time-bounded; PATCH; DELETE soft; verify updatedById en response |
| `test/calendar-recurrence.e2e-spec.ts` | POST con `FREQ=WEEKLY;COUNT=4` → list devuelve 1 parent + 4 occurrences; truncate window from/to |
| `test/calendar-terrace-booking.e2e-spec.ts` | POST TERRACE_BOOKING con metadata; conflict detection (overlap → 409); validation (rental=0 → 400; deposit deduction > security → 400) |
| `test/calendar-visibility.e2e-spec.ts` | READ_ONLY user no ve visibility=PRIVATE (404); TENANT_ADMIN sí |
| `test/calendar-reclassify-trigger.e2e-spec.ts` | Crear terrace con paymentStatus=PENDING → PATCH a PAID → CalendarTerraceChangedEvent → classification reclasifica transacciones asociadas |

**Total e2e**: 5 archivos, ~20 escenarios.

---

## 5. Estimación de tiempo Claude Code

| Bloque | Archivos | Min |
|---|---:|---:|
| Controller spec | 1 | 15–25 |
| DTOs spec | 1 | 15–25 |
| Revisión service spec (event emission gaps) | — | 15–25 |
| e2e (5 archivos — terrace booking complejo) | 5 | 180–300 |
| **Subtotal** | **7** | **225–375 min** |
| Margen 18 % | — | +40–70 |
| **Total estimado** | — | **265–445 min ≈ 4–7 sesiones** |

Mediana ≈ **355 min ≈ 6 h de Claude Code**.

---

## 6. Fases internas

- **F1 — Controller + DTOs + revisión service spec**: 1.5 sesiones.
- **F2 — e2e CRUD + recurrence**: 2 sesiones.
- **F3 — e2e terrace (booking, validation, conflict)**: 2 sesiones.
- **F4 — e2e visibility + reclassify trigger**: 1.5 sesiones.

---

## 7. Prerrequisitos / refactors

Ninguno. Helpers complejos ya extraídos a `recurrence.ts`, `terrace-metadata.validator.ts`, `visibility.util.ts`, `timezone.util.ts`, `should-trigger-reclassify.ts`.

---

## 8. Restricciones / notas

- **MAX_TOTAL_OCCURRENCES** safety cap en recurrence — tests existentes lo cubren; mantener.
- **Time-bounded endpoint** (CLAUDE.md §5): from/to required en DTO; service enforce overlap predicate.
- **Terrace deposit es FINANCIERAMENTE crítico**: depositDeductionAmount <= securityDepositAmount; rotura aquí causa cobro indebido. Tests existentes cubren — verificar al ampliar.
- **CalendarTerraceChangedEvent triggers classification reclassify** — invariante cross-module. Test e2e lo cubre.
- **Visibility role-based**: PUBLIC → todos; PRIVATE → TENANT_ADMIN+; otras → ver `visibility.util.ts`.
- **Recurrence + TERRACE_BOOKING incompatibles**: `assertRecurrenceAllowed()` throws — test lo cubre.
- **Pagination defaults** (CLAUDE.md §5): calendar 500/2000.
