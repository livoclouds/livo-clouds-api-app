# 16 — Inventory (Common Areas + Items)

**Tier**: 3 — Datos
**Rutas**: `src/modules/inventory/` (10 files, 1 340 LOC, 2 specs)
**Modelos**: `CommonArea`, `InventoryItem`

---

## 1. Estado actual de cobertura

| Archivo | Cubre |
|---|---|
| `inventory.service.spec.ts` (464 LOC, ~25 it) ✅ | CommonArea CRUD; multi-tenant isolation; soft-delete protection; audit logging; transaction atomicity |
| `dto/list-common-areas.dto.spec.ts` (88 LOC) ✅ | DTO validation (sort allowlist, enums, pagination) |

Gaps: InventoryItem CRUD (delegado al service pero menos cubierto); controller; otros DTOs.

---

## 2. Inventario de unidades testables

### 2.1 Service (`inventory.service.ts` 367 LOC) — parcialmente cubierto

CommonArea: cubierto.
InventoryItem (`findAllItems`, `findOneItem`, `createItem`, `updateItem`, `deleteItem`): parcialmente.

### 2.2 Controller (`inventory.controller.ts` 129 LOC)

Endpoints CommonArea + InventoryItem nested. Role-gated.

### 2.3 DTOs

`CreateCommonAreaDto`, `UpdateCommonAreaDto`, `ListCommonAreasDto` ✅, `CreateInventoryItemDto` (111 LOC — categoría, condición, cost, invoice info), `ListInventoryItemsDto`.

---

## 3. Pruebas unitarias sugeridas

| Archivo | Casos clave |
|---|---|
| `inventory/inventory.service.spec.ts` (ampliar) | InventoryItem CRUD: `findAllItems` paginated; FK validation a commonAreaId; create/update/delete con audit (si aplica); orphan prevention al delete common area con items (409 ConflictException si hard delete) |
| `inventory/inventory.controller.spec.ts` | Endpoint delegation; nested route guard |
| `inventory/dto/__tests__/dtos.spec.ts` (consolidado) | CreateCommonAreaDto enum status; CreateInventoryItemDto category enum; condition enum (GOOD/FAIR/POOR/...); quantity int; cost decimal; ListInventoryItemsDto pagination |

**Total**: 1 ampliación + 2 nuevos = 3 archivos, ~22 casos.

---

## 4. Pruebas e2e sugeridas

| Archivo | Flujos |
|---|---|
| `test/inventory-common-areas-crud.e2e-spec.ts` | POST area; GET list con filter q + sort; PATCH; DELETE; createdBy/updatedBy desde JWT |
| `test/inventory-items-nested.e2e-spec.ts` | POST item bajo commonArea; FK validation (areaId no existe → 404); list items per area; update/delete |
| `test/inventory-delete-conflict.e2e-spec.ts` | DELETE common area con items existentes → 409 ConflictException (si hard delete); si soft, deletedAt set sin tocar items |

**Total e2e**: 3 archivos, ~12 escenarios.

---

## 5. Estimación de tiempo Claude Code

| Bloque | Archivos | Min |
|---|---:|---:|
| Ampliar service spec | 1 | 25–40 |
| Controller spec | 1 | 15–25 |
| DTOs spec consolidado | 1 | 15–25 |
| e2e (3 archivos) | 3 | 90–135 |
| **Subtotal** | **6** | **145–225 min** |
| Margen 18 % | — | +30–45 |
| **Total estimado** | — | **175–270 min ≈ 3–4 sesiones** |

Mediana ≈ **220 min ≈ 3.5 h de Claude Code**.

---

## 6. Fases internas

- **F1 — Service ampliada + controller + DTOs**: 2 sesiones.
- **F2 — e2e (CRUD + nested + delete conflict)**: 2 sesiones.

---

## 7. Prerrequisitos / refactors

Ninguno.

---

## 8. Restricciones / notas

- **`createdBy`/`updatedBy` API-owned** (no del body — allow-list guard en `toCommonAreaData`). Test debe verificarlo.
- **Cascade vs orphan**: si hard delete y existen items → 409. Si soft delete → items quedan asociados a area con `deletedAt`. Verificar la decisión arquitectónica.
- **`nameKey` deprecado** (CMA-010 Phase 5) — columna nullable; el código no debe leerlo más. Test puede aseverar que `nameKey` NO se escribe.
- **Pagination defaults** (CLAUDE.md §5): common areas 200/1000.
