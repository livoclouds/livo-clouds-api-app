# 17 — Notifications (Inbox + SSE Feed)

**Tier**: 4 — Operacional
**Rutas**: `src/modules/notifications/` (30 files, 3 626 LOC, 11 specs)
**Modelo**: `Notification`, `UserNotificationPreference`, `RootNotificationScope`

---

## 1. Estado actual de cobertura

| Archivo | Cubre |
|---|---|
| `notifications.service.spec.ts` (~46 it) ✅ | Dispatch, recipient resolution, pagination, read/unread |
| `notifications.gateway.spec.ts` (~7 it) ✅ | Fan-out in-memory, multi-tab delivery, cleanup |
| `notification-role-matrix.spec.ts` (~6 it) ✅ | Exhaustiveness check (type-safe) |
| `notifications.controller.spec.ts` (~2 it) ✅ | Inbox response shape |
| `notifications.cron.spec.ts` (~4 it) ✅ | Retention purge cutoff |
| 5 listener specs (auth, calendar, imports, classification, reconciliation, users) ✅ | Dispatch dispatched per domain event |

Cobertura efectiva: **~75%** — el mejor cubierto del repo después de WhatsApp.

Gaps: SSE controller (Fastify raw socket + heartbeat); preferences DTOs; some edge cases.

---

## 2. Inventario de unidades testables

### 2.1 SSE Controller (`notifications.sse.controller.ts` ~120 LOC) — sin cubrir

| Unidad | Complejidad | Cubre |
|---|---|---|
| `stream(request, reply)` | Alta | Fastify raw socket; SSE headers; heartbeat interval; hijack response; cleanup on disconnect |

### 2.2 Service ampliable

`NotificationsService.dispatchEvent`, `resolveRecipientsForType`, `list` ya cubiertos. Gaps menores en role-based filtering edge cases.

### 2.3 Me-notifications controller (`me-notifications.controller.ts` ~80 LOC)

ROOT cross-tenant inbox.

### 2.4 DTOs

`ListNotificationsDto`, `UpdateNotificationPreferencesDto`, `UpdateNotificationScopeDto`.

---

## 3. Pruebas unitarias sugeridas

| Archivo | Casos clave |
|---|---|
| `notifications/notifications.sse.controller.spec.ts` | Fastify raw socket mock; SSE headers (text/event-stream, no-cache); heartbeat dispara cada N seg; cleanup llama `unregister(userId)` al disconnect |
| `notifications/me-notifications.controller.spec.ts` | ROOT cross-tenant inbox; non-ROOT → 403 |
| `notifications/dto/__tests__/dtos.spec.ts` (consolidado) | UpdateNotificationPreferencesDto channel enum; UpdateNotificationScopeDto scope enum (ACTIVE_TENANT/ALL/SPECIFIC) |
| `notifications/notifications.service.spec.ts` (revisar) | Verificar edge cases multi-tenant (notification de tenantA no visible a tenantB) |

**Total**: 3 nuevos + revisión = ~18 casos.

---

## 4. Pruebas e2e sugeridas

| Archivo | Flujos |
|---|---|
| `test/notifications-sse.e2e-spec.ts` | Open SSE stream para user1; trigger notification via service → stream recibe `event: notification`; close stream → unregister |
| `test/notifications-mark-read.e2e-spec.ts` | Create 3 notifs; GET inbox → unreadCount=3; PATCH mark-read 1 → unreadCount=2 |
| `test/notifications-role-filter.e2e-spec.ts` | Create notif type IMPORT_FAILED (TENANT_ADMIN only); READ_ONLY GET /me → no aparece; TENANT_ADMIN GET → aparece |

**Total e2e**: 3 archivos, ~12 escenarios.

---

## 5. Estimación de tiempo Claude Code

| Bloque | Archivos | Min |
|---|---:|---:|
| SSE controller spec (Fastify raw socket mock — complejo) | 1 | 35–55 |
| Me-notifications + DTOs | 2 | 30–45 |
| Revisar service spec gaps | — | 15–25 |
| e2e (3 archivos — SSE requiere setup especial) | 3 | 120–200 |
| **Subtotal** | **6** | **200–325 min** |
| Margen 18 % | — | +35–60 |
| **Total estimado** | — | **235–385 min ≈ 4–6 sesiones** |

Mediana ≈ **310 min ≈ 5 h de Claude Code**.

---

## 6. Fases internas

- **F1 — SSE controller + me-notifications + DTOs**: 2 sesiones.
- **F2 — e2e (SSE + mark-read + role filter)**: 3 sesiones.

---

## 7. Prerrequisitos / refactors

Ninguno. Pattern de mock para SSE: `reply.raw.write()` + `reply.raw.end()` mockeados.

---

## 8. Restricciones / notas

- **Append-only delivery** invariant: notifications nunca se update (mark-read es row separada). Tests fijan.
- **Multi-tab fan-out**: cada user puede tener N streams; cada notification se entrega a todos. Test ya cubre — verificar al ampliar.
- **Role matrix exhaustiveness**: nuevo `NotificationType` debe añadirse al matrix o explícitamente excluido. Test ya cubre.
- **Cron retention**: 03:00 America/Mexico_City; cutoff = días config. Test ya cubre.
- **Tenant scoping** en recipient resolution.
