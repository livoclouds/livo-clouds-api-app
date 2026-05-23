# 13 — Settings (Configuración por Tenant)

**Tier**: 3 — Datos sensibles (configuración financiera afecta cálculos downstream)
**Rutas**: `src/modules/settings/` (7 files, 374 LOC, 0 specs)
**Modelo**: `CondominiumSettings` (singleton por tenant)

---

## 1. Estado actual de cobertura

| Estado | Detalle |
|---|---|
| Tests existentes | **ninguno** |

---

## 2. Inventario de unidades testables

### 2.1 Service (`settings.service.ts` 83 LOC)

| Método | Complejidad | Cubre |
|---|---|---|
| `findOne()` | Baja | Read + join Condominium fields (name, primaryColor, slug); throws si no existe |
| `updateProfile()` | Baja | Writes a Condominium (no settings) |
| `updateGeneral()` | Media | Upsert CondominiumSettings (create con defaults o update) |
| `updateFees()` | Media | Upsert con fee fields; cross-field constraint a validar |
| `updateTerrace()` | Media | Upsert con terrace-specific fields |
| `updateFinancial()` | Media | Upsert con import file rules |
| `validateFeesConfigured()` | Baja | Helper: { valid, missingFields } basado en totalUnits>0 + ordinaryFeeAmount>0 |

### 2.2 Controller (`settings.controller.ts` 80 LOC)

Endpoints role-gated (TENANT_ADMIN+ para mutaciones).

### 2.3 DTOs

| DTO | Validaciones |
|---|---|
| `UpdateGeneralSettingsDto` (49 LOC) | logoUrl, timezone, country, currency, address, adminPhone, contactEmail, businessHours (JSON), defaultLocale |
| `UpdateFeesSettingsDto` (65 LOC) | totalUnits (int), amounts, paymentFrequency enum (weekly/biweekly/monthly/bimonthly), day 1-31 ranges, lateFee config |
| `UpdateTerraceSettingsDto` (70 LOC) | terraceBookingEnabled, rental + deposit amounts, retention window |
| `UpdateProfileDto` (17 LOC) | name, primaryColor (hex), slug |

---

## 3. Pruebas unitarias sugeridas

| Archivo | Casos clave |
|---|---|
| `settings/settings.service.spec.ts` | `findOne`: join correcto; not-found throw; `updateProfile`: solo Condominium; `updateGeneral/Fees/Terrace/Financial`: upsert paths (no existe → create con defaults; existe → update partial); **cross-field constraint en fees**: ordinaryPaymentDayStart=15 + ordinaryPaymentDayEnd=10 → validar y rechazar (a nivel service, no DTO); lateFeeStartDay > ordinaryPaymentDayEnd; `validateFeesConfigured`: totalUnits=0 → { valid: false, missingFields: ['totalUnits'] } |
| `settings/settings.controller.spec.ts` | Endpoint delegation; role guards |
| `settings/dto/__tests__/dtos.spec.ts` | UpdateFeesSettingsDto: amounts >= 0; days 1-31; paymentFrequency enum; UpdateProfileDto primaryColor hex regex |

**Total**: 3 archivos, ~22 casos.

---

## 4. Pruebas e2e sugeridas

| Archivo | Flujos |
|---|---|
| `test/settings-read.e2e-spec.ts` | GET `/condominiums/:slug/settings` → join correcto; cross-tenant → 404/403 |
| `test/settings-update.e2e-spec.ts` | PATCH cada subgrupo (general/fees/terrace/financial); upsert path (primer update crea row); persistencia entre requests |
| `test/settings-fees-validation.e2e-spec.ts` | PATCH fees con cross-field violación → 400; PATCH válido → 200 |

**Total e2e**: 3 archivos, ~12 escenarios.

---

## 5. Estimación de tiempo Claude Code

| Bloque | Archivos | Min |
|---|---:|---:|
| Service spec | 1 | 25–40 |
| Controller spec | 1 | 10–15 |
| DTOs spec | 1 | 15–25 |
| e2e (3 archivos) | 3 | 75–115 |
| **Subtotal** | **6** | **125–195 min** |
| Margen 18 % | — | +25–35 |
| **Total estimado** | — | **150–230 min ≈ 2–4 sesiones** |

Mediana ≈ **190 min ≈ 3 h de Claude Code**.

---

## 6. Fases internas

- **F1 — Service + controller + DTOs**: 1.5 sesiones.
- **F2 — e2e (read + update + validation)**: 1.5 sesiones.

---

## 7. Prerrequisitos / refactors

- **Recomendado**: extraer cross-field validators a una clase (`fees-settings.validator.ts`) con tests propios. Mantener inline si refactor se considera fuera de scope v1.

---

## 8. Restricciones / notas

- **CondominiumSettings es singleton** por tenant — no list, no delete.
- **Upsert pattern** invariant: nunca debe crear duplicado.
- **JSON columns** (businessHours, terraceDepositRetentionWindow) — sin validation a nivel DTO; validar en service o validator dedicado.
- **Cross-field constraints**: ordinaryPaymentDayStart < End, lateFeeStartDay > End — rotura aquí causa cálculo de mora incorrecto.
