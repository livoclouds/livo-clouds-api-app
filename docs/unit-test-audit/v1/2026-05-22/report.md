# Unit-Test + e2e Coverage Audit — v1 (2026-05-22)

> **Informe técnico ejecutivo** del estado actual de cobertura de pruebas
> (unit + e2e) en `livo-clouds-api-app` (NestJS 10 + Fastify + Prisma 6.8),
> plan de implementación por fases priorizado por **seguridad + aislamiento de
> tenant primero, luego financiero**, y estimación total de Claude Code.
> Léase junto a `strategy.md` (decisiones técnicas) y `modules/NN-*.md`.

---

## 1. Resumen ejecutivo

| Métrica | Valor |
|---|---|
| Módulos auditados | **22** (21 features + 1 foundation transversal) |
| Tests unitarios existentes | **45 archivos `.spec.ts` · ~734 bloques `describe`+`it`** |
| Tests e2e existentes | **0** (script `npm run test:e2e` apunta a `test/jest-e2e.json` inexistente) |
| Módulos con cobertura ≥ 50 % | **5** (whatsapp 85% · calendar 80% · notifications 75% · residents 60% · auth 97%) |
| Módulos sin **ninguna** prueba | **13** (audit, users, settings, petty-cash, reconciliation-rules, reports, collection, bank-profiles, condominiums, dashboard, email, storage, imports) |
| Archivos de test nuevos sugeridos | **~85 unit · ~55 e2e ≈ 140 total** |
| Casos nuevos sugeridos (`it`) | **~580 unit · ~230 e2e ≈ 810 total** |
| Tiempo total estimado Claude Code (mediana) | **~5 710 min ≈ 95 h ≈ ~95 sesiones acumuladas** |
| Cobertura proyectada al cerrar v1 | **≥ 80% de la lógica testable + flujos críticos e2e** |

---

## 2. Matriz de cobertura global

Leyenda — Estado: 🟢 ≥ 50 % · 🟡 10–49 % parcial · 🔴 0 % · ⚪ N/A.
Tier: F = Foundation · T1 = Seguridad/Tenant · T2 = Financiero · T3 = Datos · T4 = Operacional.

| # | Módulo | Tier | Estado | Specs actuales | Tests sugeridos | Min (mediana) | Sesiones |
|---:|---|:---:|:---:|---:|---:|---:|---:|
| 00 | Foundation (common · config · prisma · health) | F | 🔴 | 0 | 8 unit + 1 e2e | 215 | 3.5 |
| 01 | Auth + Guards | T1 | 🟢 | 3 | 6 unit + 6 e2e | 560 | 9 |
| 02 | Users | T1 | 🔴 | 0 | 3 unit + 3 e2e | 220 | 3.5 |
| 03 | Condominiums | T1 | 🔴 | 0 | 3 unit + 3 e2e | 200 | 3 |
| 04 | Imports (pipeline) | T2 | 🔴 | 0 | 5 unit + 6 e2e | 660 | 11 |
| 05 | Classification | T2 | 🟡 | 3 | 3 unit + 5 e2e | 415 | 7 |
| 06 | Transactions | T2 | 🟡 | 1 | 3 unit + 3 e2e | 225 | 4 |
| 07 | Reconciliation-rules | T2 | 🔴 | 0 | 3 unit + 2 e2e | 155 | 2.5 |
| 08 | Reports | T2 | 🔴 | 0 | 3 unit + 3 e2e | 200 | 3.5 |
| 09 | Collection | T2 | 🔴 | 0 | 3 unit + 3 e2e | 200 | 3.5 |
| 10 | Petty Cash (folio race) | T2 | 🔴 | 0 | 3 unit + 3 e2e | 250 | 4 |
| 11 | Dashboard | T2 | 🔴 | 0 | 2 unit + 2 e2e | 150 | 2.5 |
| 12 | Residents | T3 | 🟡 | 2 | 3 unit + 4 e2e | 335 | 5.5 |
| 13 | Settings | T3 | 🔴 | 0 | 3 unit + 3 e2e | 190 | 3 |
| 14 | Bank-profiles | T3 | 🔴 | 0 | 3 unit + 3 e2e | 205 | 3.5 |
| 15 | Calendar / Terraza | T3 | 🟢 | 7 | 2 unit + 5 e2e | 355 | 6 |
| 16 | Inventory | T3 | 🟡 | 2 | 3 unit + 3 e2e | 220 | 3.5 |
| 17 | Notifications | T4 | 🟢 | 11 | 3 unit + 3 e2e | 310 | 5 |
| 18 | WhatsApp | T4 | 🟢 | 16 | 4 unit + 4 e2e | 420 | 7 |
| 19 | Audit | T4 | 🔴 | 0 | 2 unit + 3 e2e | 155 | 2.5 |
| 20 | Email | T4 | 🔴 | 0 | 1 unit + 0 e2e | 30 | 0.5 |
| 21 | Storage | T4 | 🔴 | 0 | 1 unit + 0 e2e | 40 | 0.7 |
| | **TOTAL** | | | **45** | **~140** | **5 710** | **~95 h** |

---

## 3. Decisiones de alcance (heredadas de `strategy.md`)

1. **Unit + e2e** en el alcance inmediato. Fase 0 crea infra e2e (`test/` + `jest-e2e.json` + `supertest`).
2. **Ubicación**: `docs/unit-test-audit/v1/2026-05-22/` siguiendo la convención
   `<version>/YYYY-MM-DD/` del `docs/api-review/v1/2026-05-13/` existente.
3. **Orden global**: **seguridad + aislamiento de tenant primero**, luego
   financiero, datos, operacional.
4. **Patrón de extracción**: replicar `pattern-compiler.ts`, `terrace-booking-matcher.ts`, `recurrence.ts`, `identity-parser.ts` cuando una lógica densa lo amerite.
5. **Mocks externos**: Meta (vía `WhatsAppMetaClientService` wrapper), Resend (constructor), Cloudflare R2 (S3Client commands). Nunca calls reales en tests.

---

## 4. Plan de fases global

### Fase 0 — Infraestructura e2e (única vez)

- `npm install --save-dev supertest @types/supertest`.
- Crear `test/jest-e2e.json` y `test/setup.e2e.ts`.
- Configurar test DB (`DATABASE_URL=$TEST_DATABASE_URL`); ejecutar `prisma migrate deploy` + `prisma db seed` en globalSetup.
- Verificar que `npm test` (unit) sigue verde (los 45 specs existentes).

**Estimación**: 60–90 min. **1 sesión**.

### Fase 1 — Tier 1 (Seguridad + Tenant)

| Módulo | Sesiones |
|---|---:|
| 00 Foundation | 3.5 |
| 01 Auth + Guards | 9 |
| 02 Users | 3.5 |
| 03 Condominiums | 3 |
| **Subtotal** | **~19** |

**Mediana**: 1 195 min · **~19–20 sesiones**.

### Fase 2 — Tier 2 (Financiero crítico)

| Módulo | Sesiones |
|---|---:|
| 04 Imports | 11 |
| 05 Classification | 7 |
| 06 Transactions | 4 |
| 07 Reconciliation-rules | 2.5 |
| 08 Reports | 3.5 |
| 09 Collection | 3.5 |
| 10 Petty Cash | 4 |
| 11 Dashboard | 2.5 |
| **Subtotal** | **~38** |

**Mediana**: 2 255 min · **~37–38 sesiones**.

### Fase 3 — Tier 3 (Datos / dominio)

| Módulo | Sesiones |
|---|---:|
| 12 Residents | 5.5 |
| 13 Settings | 3 |
| 14 Bank-profiles | 3.5 |
| 15 Calendar | 6 |
| 16 Inventory | 3.5 |
| **Subtotal** | **~22** |

**Mediana**: 1 305 min · **~22 sesiones**.

### Fase 4 — Tier 4 (Operacional / soporte)

| Módulo | Sesiones |
|---|---:|
| 17 Notifications | 5 |
| 18 WhatsApp | 7 |
| 19 Audit | 2.5 |
| 20 Email | 0.5 |
| 21 Storage | 0.7 |
| **Subtotal** | **~16** |

**Mediana**: 955 min · **~16 sesiones**.

### Total global

| Fase | Mediana (min) | Sesiones (≈) |
|---|---:|---:|
| Fase 0 — Infra e2e | 75 | 1 |
| Fase 1 — Tier 1 | 1 195 | ~19 |
| Fase 2 — Tier 2 | 2 255 | ~38 |
| Fase 3 — Tier 3 | 1 305 | ~22 |
| Fase 4 — Tier 4 | 955 | ~16 |
| **Total** | **~5 785 min ≈ 96 h** | **~96 sesiones** |

> "Sesión" = ~45–60 min de trabajo efectivo de Claude Code (`strategy.md §7.4`).

---

## 5. Top 10 unidades a priorizar (impacto × complejidad)

Transversal — los archivos donde un bug es más caro y la prueba más rentable.

1. **`src/common/guards/condominium-access.guard.ts`** ⭐ — frontera de aislamiento multi-tenant. Un bug aquí filtra datos entre tenants.
2. **`src/modules/imports/imports.service.ts`** — pipeline completo (parse + dedup + reconcile + classify). 0 specs.
3. **`src/modules/imports/parser/excel.parser.ts`** — 5 formatos de fecha; columnas con aliases ES/EN; magic bytes. 0 specs.
4. **`src/modules/auth/auth.service.ts::refresh()`** — token rotation + reuse detection (LOG-011). Cubierto — verificar gaps menores.
5. **`src/modules/classification/classification.service.ts::classifyBatch`** — clasificación + period detection + FinancialMonthlySummary upsert.
6. **`src/modules/petty-cash/petty-cash.service.ts::create()`** — patrón canónico P2002 retry (CLAUDE.md §5 lo cita explícitamente).
7. **`src/modules/users/users.service.ts`** — bcryptjs 12 rounds + role hierarchy + email uniqueness scoped. 0 specs.
8. **`src/modules/audit/audit.service.ts`** — append-only invariant; rotura = compliance violation. 0 specs.
9. **`src/modules/whatsapp/whatsapp-meta-client.service.ts`** — wrapper de Meta API; HMAC webhook verify; encryption de credentials.
10. **`src/modules/transactions/transactions.service.ts::exportClassifiedCsv`** — EXPORT_HARD_CAP 50 000 + streaming. 0 specs.

---

## 6. Hallazgos colaterales (detectados al auditar)

1. **`test/jest-e2e.json` no existe** — el script `npm run test:e2e` está **roto desde siempre**. Fase 0 lo arregla creando `test/` + config.
2. **`CLAUDE.md` del API no tiene sección de testing** — a diferencia del web (§18). Este audit la establece de facto vía `strategy.md`; propuesta de elevarla al CLAUDE.md en PR posterior.
3. **`supertest` no está en devDependencies** — necesario para e2e (Fase 0 lo instala).
4. **Imports module (2 605 LOC) sin **ninguna** prueba** — gap más crítico del repo dado su impacto financiero.
5. **Petty-cash folio race** está documentada en CLAUDE.md como referencia pero **sin test** que la fije.

---

## 7. Restricciones del `CLAUDE.md` que afectan el plan

15 invariantes enumeradas en `strategy.md §5`. Las más relevantes:

- **Tenant scoping** vía `request.condominiumId` del `CondominiumAccessGuard`. Nunca de query/body/path.
- **Pagination shape**: `{ data, meta: { total, page, limit, totalPages } }`. Defaults documentados (residents 200/500, calendar 500/2000, etc.).
- **P2002 retry pattern** referenciado en petty-cash. Replicar al añadir nuevos identificadores tenant-scoped.
- **Time-bounded endpoints** (calendar, transactions, audit) exigen from/to validados + overlap predicate.
- **NestJS Logger** siempre, nunca `console.*`.
- **Append-only audit** — invariante de compliance.
- **safeSelect()** — nunca `passwordHash` en responses.
- **bcryptjs 12 rounds** (NUNCA bcrypt; Vercel compat).
- **Encryption WhatsApp**: AES-256-GCM + auth tag; nunca plaintext en logs/responses.
- **Webhook HMAC verify** con `timingSafeEqual`.

---

## 8. Cómo ejecutar este plan

Dos modos:

- **Modo lineal**: Fase 0 → 1 → 2 → 3 → 4 en orden.
- **Modo módulo-por-módulo**: tras Fase 0, cada módulo es un PR independiente.

Flujo por módulo:
1. Leer su `modules/NN-*.md`.
2. Aplicar extracciones de helpers si la sección 7 las indica.
3. Escribir unit tests primero (mock Prisma + `@nestjs/testing`), e2e después (supertest + test DB).
4. Correr `npm test` + (si aplica) `npm run test:e2e`.
5. PR con título `tests: <module> — fase N (v1)`, sin auto-commit, sin Co-Authored-By.

---

## 9. Indicadores baseline → v2

| Indicador | Baseline v1 | Objetivo v2 |
|---|---:|---:|
| Specs `.spec.ts` totales | 45 | ~130 |
| Tests `.e2e-spec.ts` totales | 0 | ~55 |
| Bloques `it` totales | ~734 | ~1 540 |
| Módulos con cobertura ≥ 50 % | 5 | 19 |
| Módulos sin tests | 13 | ≤ 2 |
| Cobertura global `src/modules/` (lines) | ~30 % | ≥ 80 % |
| Cobertura global `src/common/` (lines) | ~0 % | ≥ 90 % |

Cuando se cierre v1, generar v2 con métricas reales (`npm run test:cov`) y comparar.

---

*Para el dashboard visual con KPIs en color y tarjetas clickables, ver
[`report.html`](./report.html). Para la metodología técnica, ver
[`strategy.md`](./strategy.md). Para el tracking de ejecución, ver
[`progress/overall-progress.md`](./progress/overall-progress.md). Para detalle
por módulo, ver [`modules/`](./modules/).*
