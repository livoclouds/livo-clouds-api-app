# 02 — Users

**Tier**: 1 — Seguridad / Aislamiento
**Rutas**: `src/modules/users/` (6 files, 351 LOC)

---

## 1. Estado actual de cobertura

| Estado | Detalle |
|---|---|
| Tests existentes | **ninguno** (0 specs) |

---

## 2. Inventario de unidades testables

### 2.1 Service (`users.service.ts` 178 LOC)

| Método | Complejidad | Cubre |
|---|---|---|
| `findAll(condominiumId)` | Baja | `findMany` con `safeSelect`, soft-delete `deletedAt: null`, ordered by `createdAt desc` |
| `findOne(condominiumId, id)` | Baja | Throws `NotFoundException` si no existe o soft-deleted |
| `create(condominiumId, dto, requester)` | Media | `bcryptjs.hash(SALT_ROUNDS=12)`, role hierarchy (TENANT_ADMIN ≠ create ROOT), email uniqueness (ROOT global / tenant scoped), emits `USER_ADDED_EVENT` |
| `update(condominiumId, id, dto, requester)` | Media | Partial; rehashea password si dto.password; emits `USER_PERMISSIONS_CHANGED_EVENT` **solo si role cambió** (before ≠ after) |
| `remove(condominiumId, id)` | Baja | Soft-delete: `deletedAt: new Date()` + `isActive: false` |

### 2.2 Controller (`users.controller.ts` 73 LOC)

Endpoints todos `@UseGuards(CondominiumAccessGuard, RolesGuard)` + `@Roles(ROOT, TENANT_ADMIN)`. Delegación 1:1 al service.

### 2.3 DTOs

| DTO | Validaciones |
|---|---|
| `CreateUserDto` (55 LOC) | email, password (min 8), role enum, firstName/lastName (min 1), phone opcional, avatarUrl opcional (URL), sessionDuration (1–24) |
| `UpdateUserDto` (9 LOC) | Todos opcionales (Partial) |

---

## 3. Pruebas unitarias sugeridas

| Archivo | Casos clave |
|---|---|
| `users/users.service.spec.ts` | `findAll`: scoping por condominiumId + soft-delete filter + safeSelect (no passwordHash); `findOne`: 404 si no existe o soft-deleted; `create`: TENANT_ADMIN+role=ROOT → ForbiddenException; email duplicado scoped (mismo condo) → ConflictException; email duplicado en otro condo → success (scoped); password hashed con bcryptjs (12 rounds); `safeSelect` aplicado en response; evento `USER_ADDED_EVENT` emitido con userId+actorUserId; `update`: rehashea password si dto.password; emite `USER_PERMISSIONS_CHANGED_EVENT` SOLO si role cambió; `remove`: soft-delete (`deletedAt` + `isActive=false`) |
| `users/users.controller.spec.ts` | Cada endpoint llama el método correcto del service mockeado con args correctos |
| `users/dto/__tests__/dtos.spec.ts` | `CreateUserDto`: email inválido → error; password <8 → error; sessionDuration <1 o >24 → error; role enum inválido → error; phone formato libre; `UpdateUserDto`: todo opcional pasa con `{}` |

**Total**: 3 archivos, ~25 casos.

---

## 4. Pruebas e2e sugeridas

| Archivo | Flujos |
|---|---|
| `test/users-crud.e2e-spec.ts` | POST crea user (TENANT_ADMIN); GET list ordered by createdAt desc + sin passwordHash; GET :id; PATCH (rol, name); DELETE soft → GET muestra ausente; DELETE :id luego GET → 404 |
| `test/users-permissions.e2e-spec.ts` | TENANT_ADMIN intenta crear ROOT → 403; ROOT crea ROOT → success; READ_ONLY intenta cualquier mutation → 403; cross-tenant attempt → 403 vía `CondominiumAccessGuard` |
| `test/users-email-uniqueness.e2e-spec.ts` | Email duplicado en mismo tenant → 409; mismo email en otro tenant → 200; ROOT email global → 409 si duplica entre cualquier tenant |

**Total e2e**: 3 archivos, ~12 escenarios.

---

## 5. Estimación de tiempo Claude Code

| Bloque | Archivos | Min |
|---|---:|---:|
| Service spec | 1 | 25–40 |
| Controller spec | 1 | 10–15 |
| DTOs spec | 1 | 15–25 |
| e2e (3 archivos) | 3 | 90–150 |
| **Subtotal** | **6** | **140–230 min** |
| Margen 18 % | — | +25–45 |
| **Total estimado** | — | **165–275 min ≈ 3–5 sesiones** |

Mediana ≈ **220 min ≈ 3.5 h de Claude Code**.

---

## 6. Fases internas

- **F1 — Service + controller + DTOs**: 1.5 sesiones.
- **F2 — e2e (CRUD + permissions + uniqueness)**: 2.5 sesiones.

---

## 7. Prerrequisitos / refactors

Ninguno. Patrón `makePrismaMock` + bcryptjs mock del módulo `auth` se reutiliza.

---

## 8. Restricciones / notas

- **safeSelect** invariant: ningún response incluye `passwordHash`. Tests deben aseverarlo explícitamente.
- **Role hierarchy** invariant: solo ROOT crea ROOT. Test bloquea regresiones.
- **bcryptjs 12 rounds** (NUNCA bcrypt — Vercel) — verificar import.
- **Soft-delete** invariant: `findAll`/`findOne` siempre filtran `deletedAt: null`.
- **Event emission** invariant: `USER_PERMISSIONS_CHANGED_EVENT` solo si role cambió. Ediciones de nombre/teléfono **no** disparan el evento.
- Multi-tenant: email uniqueness scoped por `(condominiumId, email)`; ROOT global. Tests cubren ambas dimensiones.
