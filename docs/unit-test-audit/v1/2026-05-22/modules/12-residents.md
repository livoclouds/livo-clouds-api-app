# 12 — Residents

**Tier**: 3 — Datos sensibles (con dimensión financiera vía debt + paymentStatus)
**Rutas**: `src/modules/residents/` (15 files, 2 508 LOC, 2 specs)
**Modelos**: `Resident`, `Vehicle`, `Pet`, `AdditionalResident`

---

## 1. Estado actual de cobertura

| Archivo | Cubre |
|---|---|
| `residents.service.spec.ts` (904 LOC, ~40 it) ✅ | CRUD principal + sub-entity (vehicles/pets/additional); pagination + filtering; conflict on unitNumber |
| `dto/list-residents.dto.spec.ts` (79 LOC) ✅ | Sort allowlist (7 fields), enums, pagination |

Cobertura efectiva: ~60%. Gaps: controller, sub-entity DTOs, edge cases multi-tenant.

---

## 2. Inventario de unidades testables

### 2.1 Service (`residents.service.ts` 857 LOC) — parcialmente cubierto

`findAll`, `findOne`, `create`, `update`, `remove` cubiertos.
Sub-entity CRUD (`addVehicle`, `updateVehicle`, `removeVehicle`, `addPet`, `updatePet`, `removePet`, `addAdditionalResident`, etc.) parcialmente cubierto.

Helpers internos: `buildResidentWhere()`, `buildResidentOrderBy()` — implícitamente cubiertos.

### 2.2 Controller (`residents.controller.ts` 226 LOC) — sin cubrir

Endpoints CRUD principales + sub-entity nested. `CondominiumAccessGuard` + `RolesGuard` aplicados.

### 2.3 DTOs

`CreateResidentDto` (incluye nested vehicles/pets/additional arrays), `UpdateResidentDto`, `CreateVehicleDto`, `UpdateVehicleDto`, `CreatePetDto`, `UpdatePetDto`, `CreateAdditionalResidentDto`, `UpdateAdditionalResidentDto`, `ResidentDocumentationDto`. `ListResidentsDto` ya cubierto.

---

## 3. Pruebas unitarias sugeridas

| Archivo | Casos clave |
|---|---|
| `residents/residents.service.spec.ts` (ampliar) | Documentation JSON-path filter ("complete" → AND on 5 boolean keys); soft-delete + update collision (unique scoped por `condominiumId + unitNumber + deletedAt IS NULL`); audit log antes/después para cada CRUD; nested entity atomicity (createResident con vehicles → todo en transaction; falla nested → rollback total); tenant isolation (residenteA en condoA ≠ visible en condoB) |
| `residents/residents.controller.spec.ts` | CRUD principal + sub-entity nested; guards aplicados |
| `residents/dto/__tests__/dtos.spec.ts` (consolidado) | Cada sub-entity DTO valida enums (PetType DOG/CAT/OTHER, ResidentType OWNER/CO_OWNER/RESIDENT/TENANT); documentation 5 booleans; vehicles array shape |

**Total**: 1 ampliación + 2 nuevos = 3 archivos, ~30 casos.

---

## 4. Pruebas e2e sugeridas

| Archivo | Flujos |
|---|---|
| `test/residents-list.e2e-spec.ts` | GET con filter (q="Carlos"), sort (debt desc), pagination; tenant isolation (logged-in condoA → list condoB → 404) |
| `test/residents-create-nested.e2e-spec.ts` | POST con nested vehicles + pets in one request → todos creados; rollback si una nested falla; unitNumber duplicado → 409 |
| `test/residents-update-and-subentity.e2e-spec.ts` | PATCH cambio de nombre → audit before/after; POST nested vehicle/pet/additional; PATCH/DELETE sub-entity con FK validation |
| `test/residents-soft-delete.e2e-spec.ts` | DELETE → deletedAt set; GET list → ausente; GET :id → 404; recrear con mismo unitNumber → success (porque deletedAt filtra el viejo) |

**Total e2e**: 4 archivos, ~18 escenarios.

---

## 5. Estimación de tiempo Claude Code

| Bloque | Archivos | Min |
|---|---:|---:|
| Ampliar service spec | 1 | 35–55 |
| Controller spec | 1 | 20–30 |
| DTOs consolidados (9 DTOs) | 1 | 25–40 |
| e2e (4 archivos) | 4 | 140–220 |
| **Subtotal** | **7** | **220–345 min** |
| Margen 18 % | — | +40–65 |
| **Total estimado** | — | **260–410 min ≈ 4–7 sesiones** |

Mediana ≈ **335 min ≈ 5.5 h de Claude Code**.

---

## 6. Fases internas

- **F1 — Ampliar service spec + DTOs consolidados**: 2 sesiones.
- **F2 — Controller spec**: 0.5 sesión.
- **F3 — e2e (list + nested create)**: 2 sesiones.
- **F4 — e2e (update + soft-delete)**: 1.5 sesiones.

---

## 7. Prerrequisitos / refactors

Ninguno. Helpers internos (`buildResidentWhere`, `buildResidentOrderBy`) están encapsulados; testarlos vía service spec sigue siendo cómodo.

---

## 8. Restricciones / notas

- **Soft-delete invariant** crítico: tests deben aseverar `deletedAt: null` en todos los reads.
- **Tenant isolation** invariant: nunca cross-tenant leak.
- **Nested atomicity**: `create` con vehicles → todo en `$transaction`. Test verifica rollback completo si una falla.
- **UnitNumber uniqueness scoped**: `(condominiumId, unitNumber)` con filter `deletedAt: null`. Tras soft-delete, el unitNumber se puede reusar.
- **Audit logging**: beforeState (update + delete) + afterState (create + update). Tests fijan el contrato.
- **Documentation JSON filter**: AND sobre 5 booleans para "complete"; OR negado para "incomplete". Test cubre ambos.
