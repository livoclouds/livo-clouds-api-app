# Unit-Test + e2e Audit — Master Index

Historial de auditorías de cobertura de pruebas (unit + e2e) para
`livo-clouds-api-app` (NestJS 10 + Fastify + Prisma 6.8).

Cada versión vive en `<version>/<YYYY-MM-DD>/` siguiendo la convención del
`docs/api-review/` ya establecido en este repo. Los documentos del kickoff
(`report.md`, `report.html`, `strategy.md`, `modules/NN-*.md`) son **frozen**
desde el momento en que se publica la versión; solo `progress/overall-progress.md`
y `progress/overall-progress.html` **mutan** con cada PR.

> **📊 [Abrir el dashboard HTML del v1 →](./v1/2026-05-22/report.html)**
> Resumen visual de toda la auditoría — ábrelo en navegador. Cada tarjeta de
> módulo enlaza al `.md` correspondiente.
>
> **📈 [Abrir el progress tracker (vivo) →](./v1/2026-05-22/progress/overall-progress.html)**

---

## Versiones

| Versión | Fecha | Alcance | Módulos | Tests sugeridos | Tiempo Claude Code | Estado |
|---|---|---|---:|---:|---|---|
| [v1](./v1/2026-05-22/) | 2026-05-22 | Baseline — auditoría completa, plan por fases (seguridad → financiero → datos → operacional) | 22 | ~140 archivos · ~810 casos (unit + e2e) | ~5 710 min · ~95 h | 🟢 plan publicado · 0/96 sesiones ejecutadas |

---

## Convención de carpetas

```
unit-test-audit/
├── README.md                          ← este archivo (siempre primero)
└── v1/2026-05-22/                     ← snapshot del kickoff (frozen + progress/)
    ├── report.md                     informe técnico ejecutivo (FROZEN)
    ├── report.html                   dashboard HTML profesional (FROZEN)
    ├── strategy.md                   stack, vitest/jest config, metodología (FROZEN)
    ├── modules/                      un .md por módulo (22 docs, FROZEN)
    │   ├── 00-foundation-common.md
    │   ├── 01-auth-and-guards.md     (Tier 1)
    │   ├── 02-users.md               (Tier 1)
    │   ├── 03-condominiums.md        (Tier 1)
    │   ├── 04-imports.md             (Tier 2)
    │   ├── 05-classification.md      (Tier 2)
    │   ├── 06-transactions.md        (Tier 2)
    │   ├── 07-reconciliation-rules.md (Tier 2)
    │   ├── 08-reports.md             (Tier 2)
    │   ├── 09-collection.md          (Tier 2)
    │   ├── 10-petty-cash.md          (Tier 2)
    │   ├── 11-dashboard.md           (Tier 2)
    │   ├── 12-residents.md           (Tier 3)
    │   ├── 13-settings.md            (Tier 3)
    │   ├── 14-bank-profiles.md       (Tier 3)
    │   ├── 15-calendar.md            (Tier 3)
    │   ├── 16-inventory.md           (Tier 3)
    │   ├── 17-notifications.md       (Tier 4)
    │   ├── 18-whatsapp.md            (Tier 4)
    │   ├── 19-audit.md               (Tier 4)
    │   ├── 20-email.md               (Tier 4)
    │   └── 21-storage.md             (Tier 4)
    └── progress/                     LIVING — muta con cada PR
        ├── overall-progress.md       tracker textual
        └── overall-progress.html     tracker visual
└── v2/YYYY-MM-DD/                     ← futuras revisiones (no creada aún)
    └── ...
```

**Formato de nombre de carpeta**: `<version>/<YYYY-MM-DD>` — la fecha es el
**kickoff** de la auditoría (no la última actualización).

**Numeración de los módulos**: el prefijo `NN-` codifica el orden global de
ataque por **tier de seguridad → financiero → datos → operacional**.

---

## Tracking de estado — v1

Para el detalle vivo, ver **[`v1/2026-05-22/progress/overall-progress.md`](./v1/2026-05-22/progress/overall-progress.md)**.

Resumen rápido (snapshot 2026-05-22):

| Fase | Mediana | Estado |
|---|---:|---|
| 0 — Infraestructura e2e | 75 min | pending |
| 1 — Tier 1 (Seguridad) | 1 195 min | pending |
| 2 — Tier 2 (Financiero) | 2 255 min | pending |
| 3 — Tier 3 (Datos) | 1 305 min | pending |
| 4 — Tier 4 (Operacional) | 955 min | pending |
| **TOTAL** | **~5 710 min · ~95 h** | — |

---

## Cómo trabajar con este audit

### Para arrancar la primera ronda

1. Leer `v1/2026-05-22/strategy.md` (decisiones técnicas + convenciones).
2. Ejecutar **Fase 0** (instalar `supertest`, crear `test/jest-e2e.json` + `setup.e2e.ts`, configurar test DB). Verificar que los 45 specs existentes (`npm test`) siguen verdes.
3. Ejecutar **Fase 1** — módulos `00` a `03` en orden:
   - `00-foundation-common`: filters, interceptors, utils (encryption + phone normalization), configs, prisma service, health.
   - `01-auth-and-guards`: 4 guards (jwt, roles, **condominium-access**, throttler) + ampliar auth + e2e auth.
   - `02-users`: CRUD + role hierarchy + email uniqueness + safeSelect.
   - `03-condominiums`: CRUD + slug global unique + role-based visibility + deactivation.
4. Marcar estado en `progress/overall-progress.md` tras cada PR.

### Para añadir tests a un módulo específico

1. Abrir su `v1/2026-05-22/modules/NN-<modulo>.md`.
2. Revisar:
   - Sección 1 — tests que ya existen (no duplicar).
   - Sección 2 — inventario de unidades testables.
   - Sección 3 y 4 — qué pruebas escribir (unit y e2e).
   - Sección 6 — fases internas del módulo.
   - Sección 7 — refactors previos requeridos (extracción de helpers).
   - Sección 8 — restricciones (invariantes que el test fija en piedra).
3. Escribir tests cumpliendo `strategy.md §4` (patrón `makePrismaMock`, `bcryptjs` mock, AAA).
4. Verificar `npm run typecheck` + `npm run lint` + `npm test` (+ `npm run test:e2e` si aplica).
5. PR con título `tests: <module> — fase N (v1)`, body detallado, sin auto-commit, sin Co-Authored-By, sin prefix convencional.
6. Actualizar `progress/overall-progress.md` con número de PR + sesiones gastadas reales.

### Cuándo crear un v2

- Cuando se cierren todas las fases del v1.
- O cuando un cambio mayor (nuevo módulo, refactor arquitectónico, integración nueva con Meta/Resend/R2) invalide partes del baseline.

Para crearlo:
1. Crear carpeta `v2/YYYY-MM-DD/` con `report.md` + `report.html` + `strategy.md` + `modules/` + `progress/`.
2. Generar baseline con métricas reales: `npm run test:cov` (unit) + `npm run test:e2e:cov` (e2e, ya disponible tras v1 Fase 0).
3. Añadir fila a la tabla **Versiones** de arriba.

---

## Relación con `docs/api-review/`

| Aspecto | `api-review/v1/2026-05-13/` | `unit-test-audit/v1/2026-05-22/` |
|---|---|---|
| Tema | Performance + risk de endpoints | Cobertura de pruebas (unit + e2e) |
| Output | findings + roadmap de optimización | tests por módulo + plan de implementación |
| Convención de carpeta | `<version>/<date>/` + `progress/` | misma (1:1) |
| HTML | `findings-summary.html` | `report.html` + `progress/overall-progress.html` |

Ambos son **complementarios**: api-review identifica problemas y riesgos del
runtime; unit-test-audit asegura que la corrección de esos riesgos no
regrese.

---

## Documentación relacionada

- [`CLAUDE.md`](../../CLAUDE.md) — Stack, multi-tenancy, patrones (sin sección de testing — esta auditoría establece la baseline).
- [`docs/api-review/`](../api-review/) — Audit de performance + risk (precedente directo de convención).
- Repo del web (cross-repo): `~/code/github/livoclouds/livo-clouds-web-app/docs/unit-test-audit/rev01_2026-05-22_unit-test-baseline/` — audit equivalente para el frontend (Next.js + Vitest), entregado vía PR #132.

---

*Documento vivo. Cuando se inicien las fases, actualizar el tracker en
`v1/2026-05-22/progress/` con el progreso real.*
