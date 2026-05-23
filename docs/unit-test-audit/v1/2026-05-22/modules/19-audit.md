# 19 — Audit (Append-Only Log)

**Tier**: 4 — Compliance crítico
**Rutas**: `src/modules/audit/` (3 files, 154 LOC, 0 specs)
**Modelo**: `AuditLog`

---

## 1. Estado actual de cobertura

| Estado | Detalle |
|---|---|
| Tests existentes | **ninguno** |
| **Invariante absoluta**: append-only (nunca UPDATE/DELETE) |

---

## 2. Inventario de unidades testables

### 2.1 Service (`audit.service.ts` 112 LOC)

| Método | Complejidad | Cubre |
|---|---|---|
| `log(args, txClient?)` | Baja | `prisma.auditLog.create`; opcional `TransactionClient` para atomicidad con la mutación caller |
| `findAll(condominiumId, dto)` | Media | Paginated; filtros (module, action, result, dateRange); max 200 |
| `findPlatformLogs(dto)` | Media | ROOT-only cross-tenant; sin date filter required para ROOT |

### 2.2 Controller (`audit.controller.ts` 32 LOC)

2 endpoints: `GET /audit` (ROOT) y `GET /condominiums/:slug/audit` (tenant-scoped).

---

## 3. Pruebas unitarias sugeridas

| Archivo | Casos clave |
|---|---|
| `audit/audit.service.spec.ts` | `log`: crea fila con action + beforeState + afterState + userId + condominiumId; con `txClient` pasado → usa el txClient (mock $transaction); `findAll`: paginated; filtros aplicados; date range overlap; max 200 enforced; tenant scope (NON-ROOT cannot ver platform logs); `findPlatformLogs`: ROOT pasa; otros throw o devuelven vacío; **append-only invariant**: el service NO expone `update`/`delete`/`deleteMany` — verificar que el contrato del módulo solo es `create + read` |
| `audit/audit.controller.spec.ts` | `GET /audit` ROOT-only; `GET /condominiums/:slug/audit` tenant + role-scoped |

**Total**: 2 archivos, ~15 casos.

---

## 4. Pruebas e2e sugeridas

| Archivo | Flujos |
|---|---|
| `test/audit-append-only.e2e-spec.ts` | Crear audit via cualquier mutación que dispare audit; GET /audit muestra entry; **NO existe endpoint de DELETE/PATCH** — confirmar 404 si alguien intenta `DELETE /audit/:id` |
| `test/audit-tenant-scope.e2e-spec.ts` | TENANT_ADMIN(condoA) GET → solo logs de condoA; ROOT GET /audit (sin slug) → todos los tenants; READ_ONLY → 403 |
| `test/audit-transactional.e2e-spec.ts` | En una mutation con bulk (e.g. classification.bulkReconcile), si la transacción rollback → audit entries también rollback (no quedan filas huérfanas) |

**Total e2e**: 3 archivos, ~10 escenarios.

---

## 5. Estimación de tiempo Claude Code

| Bloque | Archivos | Min |
|---|---:|---:|
| Service spec | 1 | 20–30 |
| Controller spec | 1 | 10–15 |
| e2e (3 archivos) | 3 | 75–115 |
| **Subtotal** | **5** | **105–160 min** |
| Margen 18 % | — | +20–30 |
| **Total estimado** | — | **125–190 min ≈ 2–3 sesiones** |

Mediana ≈ **155 min ≈ 2.5 h de Claude Code**.

---

## 6. Fases internas

- **F1 — Service + controller**: 1 sesión.
- **F2 — e2e (append-only + tenant + transactional)**: 1.5 sesiones.

---

## 7. Prerrequisitos / refactors

Ninguno. El módulo es pequeño y enfocado.

---

## 8. Restricciones / notas

- **Append-only invariant** absoluta: rotura aquí = compliance violation. NUNCA debe existir un método `update`/`delete` en este service. Test fija el contrato.
- **Transactional atomicity** crítica: `log(args, txClient)` permite que la audit entry commit/rollback con la mutación caller. Test e2e cubre.
- **Tenant isolation**: NON-ROOT scoped a condominiumId. ROOT cross-tenant.
- **Pagination defaults** (CLAUDE.md §5): audit 50/200.
- **Time-bounded filter** opcional pero common (dateFrom/dateTo); validar overlap predicate.
- **`findPlatformLogs`** sin date filter required for ROOT — diferencia con tenant-scoped.
