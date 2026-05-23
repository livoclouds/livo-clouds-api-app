# 03 — Condominiums

**Tier**: 1 — Seguridad / Aislamiento de tenant
**Rutas**: `src/modules/condominiums/` (5 files, 222 LOC)

---

## 1. Estado actual de cobertura

| Estado | Detalle |
|---|---|
| Tests existentes | **ninguno** (0 specs) |

---

## 2. Inventario de unidades testables

### 2.1 Service (`condominiums.service.ts` 104 LOC)

| Método | Complejidad | Cubre |
|---|---|---|
| `findAll(user)` | Media | Visibilidad por rol: ROOT → todos; otros → solo `user.condominiumId`. Include `settings`. Ordered by `name asc` |
| `findBySlug(slug)` | Baja | `findUnique({where:{slug}})` + include settings. Sin role check (público) |
| `findById(id)` | Baja | Similar al anterior |
| `create(dto)` | Media | Slug unique global; nested create de CondominiumSettings; solo ROOT (enforced en controller) |
| `update(id, dto, requester)` | Media | Permiso: ROOT o `requester.condominiumId === id`; slug collision check con `NOT: {id}` |
| `remove(id)` | Baja | Soft / logical: `isActive: false`. Tras esto, `CondominiumAccessGuard` lo rechaza |

### 2.2 Controller (`condominiums.controller.ts` 62 LOC)

Endpoints con roles diferentes:
- `findAll` — sin guard de condominium (scoping en service por rol).
- `findOne(slug)` — público-like (sin role requirement explícito).
- `create` — `@Roles(ROOT)`.
- `update` — `@Roles(ROOT, TENANT_ADMIN)` + check de ownership en service.
- `remove` — `@Roles(ROOT)`.

### 2.3 DTOs

| DTO | Validaciones |
|---|---|
| `CreateCondominiumDto` (42 LOC) | slug (3–64, regex lowercase alphanumeric-dash), name (2–200), legalName opcional, primaryColor opcional (regex hex), isActive opcional |
| `UpdateCondominiumDto` (4 LOC) | Todos opcionales |

---

## 3. Pruebas unitarias sugeridas

| Archivo | Casos clave |
|---|---|
| `condominiums/condominiums.service.spec.ts` | `findAll`: ROOT ve N condos; TENANT_ADMIN solo el suyo; READ_ONLY igual; orden `name asc`; include settings; `findBySlug` no aplica role scoping (público); `create`: slug duplicado → ConflictException; nested create de CondominiumSettings con defaults; solo ROOT puede crear (verificación en controller); `update`: TENANT_ADMIN intenta editar otro condo → ForbiddenException; ROOT edita cualquiera; slug collision con NOT:{id} (puede mantener su propio slug); `remove`: setea `isActive: false` (no hard delete) |
| `condominiums/condominiums.controller.spec.ts` | `@Roles(ROOT)` aplica en create + remove; update con TENANT_ADMIN+ |
| `condominiums/dto/__tests__/dtos.spec.ts` | slug "Coto Alameda" → error (uppercase/space); slug "cc" → error (min 3); slug 65 chars → error (max 64); slug "coto-alameda" → válido; primaryColor "#FF5A6E" → válido; "#zzz" → error |

**Total**: 3 archivos, ~22 casos.

---

## 4. Pruebas e2e sugeridas

| Archivo | Flujos |
|---|---|
| `test/condominiums-crud.e2e-spec.ts` | POST con ROOT crea + nested settings; GET list (ROOT ve todos, TENANT_ADMIN ve uno); GET /:slug público; PATCH update; DELETE (isActive=false); GET tras delete sigue accesible (soft) |
| `test/condominiums-slug-collision.e2e-spec.ts` | POST con slug existente → 409; PATCH con slug existente (otro condo) → 409; PATCH manteniendo propio slug → 200 |
| `test/condominiums-deactivation.e2e-spec.ts` | DELETE condoX → CondominiumAccessGuard rechaza posterior GET /condominiums/condoX-slug/* con 403 ("Condominium is inactive") |

**Total e2e**: 3 archivos, ~12 escenarios.

---

## 5. Estimación de tiempo Claude Code

| Bloque | Archivos | Min |
|---|---:|---:|
| Service spec | 1 | 20–30 |
| Controller spec | 1 | 10–15 |
| DTOs spec | 1 | 10–15 |
| e2e (3 archivos) | 3 | 90–150 |
| **Subtotal** | **6** | **130–210 min** |
| Margen 18 % | — | +25–40 |
| **Total estimado** | — | **155–250 min ≈ 3–4 sesiones** |

Mediana ≈ **200 min ≈ 3 h de Claude Code**.

---

## 6. Fases internas

- **F1 — Service + controller + DTOs**: 1 sesión.
- **F2 — e2e (CRUD + slug + deactivation)**: 2–3 sesiones.

---

## 7. Prerrequisitos / refactors

Ninguno.

---

## 8. Restricciones / notas

- **Slug global unique** invariant: rotura permite collision entre condos →
  CondominiumAccessGuard fallaría.
- **Deactivation cascade**: condo inactivo se desconecta vía guard. Tests deben
  cubrir el efecto downstream (GET protegido → 403).
- **Role-based visibility en `findAll`** es UX, no seguridad (CLAUDE.md §14).
  Backend siempre enforce con guards. Los tests del service la verifican como
  un contrato.
- **CondominiumSettings nested create**: si en el futuro se mueve a un módulo
  separado (settings), los tests aquí deben adaptarse.
