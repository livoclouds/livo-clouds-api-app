# 14 — Bank Profiles (Mapping de Aliases por Banco)

**Tier**: 3 — Datos (mapping configurable que alimenta el parser de imports)
**Rutas**: `src/modules/bank-profiles/` (6 files, 573 LOC, 0 specs)
**Modelo**: `BankProfile`

---

## 1. Estado actual de cobertura

| Estado | Detalle |
|---|---|
| Tests existentes | **ninguno** |

---

## 2. Inventario de unidades testables

### 2.1 Service (`bank-profiles.service.ts` 381 LOC)

| Método | Complejidad | Cubre |
|---|---|---|
| `findAll()` | Baja | Order: `isDefault desc, name asc` |
| `findOne()` | Baja | Not-found throw |
| `findDefault()` | Media | isDefault=true; fallback al más antiguo |
| `create()` | **Alta** | Si `isDefault=true`, unset isDefault en los demás (transactional); validateFieldDefinitions; audit |
| `update()` | **Alta** | Similar atomicity en isDefault |
| `delete()` | Media | Soft o hard (verificar); audit |
| `validateFieldDefinitions(defs, fieldName)` | Media | Cada def debe mapear a field code en `DEFAULT_FIELD_DEFINITIONS` (allowlist) |

### 2.2 Controller (`bank-profiles.controller.ts` 94 LOC)

CRUD endpoints. Role-gated (TENANT_ADMIN+).

### 2.3 DTOs

| DTO | Validaciones |
|---|---|
| `CreateBankProfileDto` | name, bankName opcional, isDefault, useSameForPdf, excelAliases (array FieldDefinitionDto), pdfAliases opcional |
| `UpdateBankProfileDto` | Todos opcionales |
| `FieldDefinitionDto` | column index/name + fieldCode (validado contra DEFAULT_FIELD_DEFINITIONS) |

---

## 3. Pruebas unitarias sugeridas

| Archivo | Casos clave |
|---|---|
| `bank-profiles/bank-profiles.service.spec.ts` | `findAll`: order por isDefault+name; `create` con isDefault=true → unset otros (mock updateMany invocado); `create` con isDefault=false → no unset; conflict en (condominiumId, name) → ConflictException; `update` similar atomicity; `validateFieldDefinitions`: fieldCode no en allowlist → throw; estructura inválida → throw; `findDefault` fallback al más antiguo si no hay isDefault=true |
| `bank-profiles/bank-profiles.controller.spec.ts` | Endpoint delegation + role guards |
| `bank-profiles/dto/__tests__/dtos.spec.ts` | excelAliases array required, no vacío; FieldDefinitionDto estructura; bankName opcional |

**Total**: 3 archivos, ~22 casos.

---

## 4. Pruebas e2e sugeridas

| Archivo | Flujos |
|---|---|
| `test/bank-profiles-crud.e2e-spec.ts` | POST crea profile con field definitions; GET list ordered; PATCH; DELETE |
| `test/bank-profiles-default-atomicity.e2e-spec.ts` | Crear A (isDefault=true) + B (isDefault=false); PATCH B isDefault=true → A queda false; GET /default → B |
| `test/bank-profiles-validation.e2e-spec.ts` | POST con fieldCode no allowlisted → 400; POST con name duplicado en tenant → 409 |

**Total e2e**: 3 archivos, ~10 escenarios.

---

## 5. Estimación de tiempo Claude Code

| Bloque | Archivos | Min |
|---|---:|---:|
| Service spec | 1 | 25–40 |
| Controller spec | 1 | 10–15 |
| DTOs spec | 1 | 15–25 |
| e2e (3 archivos) | 3 | 80–130 |
| **Subtotal** | **6** | **130–210 min** |
| Margen 18 % | — | +25–40 |
| **Total estimado** | — | **155–250 min ≈ 3–4 sesiones** |

Mediana ≈ **205 min ≈ 3.5 h de Claude Code**.

---

## 6. Fases internas

- **F1 — Service + DTOs + controller**: 1.5 sesiones.
- **F2 — e2e (CRUD + isDefault atomicity)**: 2 sesiones.

---

## 7. Prerrequisitos / refactors

Ninguno. `DEFAULT_FIELD_DEFINITIONS` está en imports module — import directo.

---

## 8. Restricciones / notas

- **isDefault atomicity** invariant: solo un profile con isDefault=true por tenant. Test cubre transición.
- **`fieldCode` allowlist** invariant: rotura permite parsear archivos con mapping inválido.
- **Audit logging**: incluye `afterState` con name + isDefault (no las aliases JSON enteras — economía de bytes).
- **useSameForPdf** flag: si true, excelAliases se usa también para PDF. Tests cubren ambos paths.
