# Overall Progress — v1 (2026-05-22) — LIVING TRACKER

> Este documento se actualiza conforme se ejecutan las fases del audit.
> Estados posibles: `pending` · `in-progress` · `completed` · `blocked` · `deferred`.
>
> A diferencia de `report.md`, `strategy.md` y los `modules/NN-*.md` (todos
> **frozen** desde el kickoff 2026-05-22), este archivo **muta** con cada PR.

---

## Estado global

| Indicador | Baseline (2026-05-22) | Actual | Objetivo v1 cerrado |
|---|---:|---:|---:|
| Specs `.spec.ts` totales | 45 | 45 | ~130 |
| Tests `.e2e-spec.ts` totales | 0 | 0 | ~55 |
| Bloques `it` totales | ~734 | ~734 | ~1 540 |
| Módulos con ≥ 50 % cobertura | 5 | 5 | 19 |
| Módulos sin tests | 13 | 13 | ≤ 2 |
| Sesiones Claude Code ejecutadas | 0 | 0 / ~96 | — |
| Min Claude Code acumulados | 0 | 0 / ~5 710 | — |

---

## Fases — tracking

| Fase | Descripción | Mediana (min) | Sesiones (≈) | Estado | Cerrada en |
|---|---|---:|---:|---|---|
| 0 | Infraestructura e2e (test/ + jest-e2e.json + supertest + test DB) | 75 | 1 | pending | — |
| 1 | Tier 1 — Seguridad + Tenant (Foundation + Auth/Guards + Users + Condominiums) | 1 195 | ~19 | pending | — |
| 2 | Tier 2 — Financiero crítico (8 módulos) | 2 255 | ~38 | pending | — |
| 3 | Tier 3 — Datos / dominio (5 módulos) | 1 305 | ~22 | pending | — |
| 4 | Tier 4 — Operacional (5 módulos) | 955 | ~16 | pending | — |

---

## Módulos — tracking

| # | Módulo | Tier | Specs actuales | Tests nuevos | Estimación | Estado | PR | Sesiones gastadas |
|---:|---|:---:|---:|---:|---:|---|---|---:|
| 00 | Foundation | F | 0 | 9 | 215 min | pending | — | 0 |
| 01 | Auth + Guards | T1 | 3 | 12 | 560 min | pending | — | 0 |
| 02 | Users | T1 | 0 | 6 | 220 min | pending | — | 0 |
| 03 | Condominiums | T1 | 0 | 6 | 200 min | pending | — | 0 |
| 04 | Imports | T2 | 0 | 11 | 660 min | pending | — | 0 |
| 05 | Classification | T2 | 3 | 8 | 415 min | pending | — | 0 |
| 06 | Transactions | T2 | 1 | 6 | 225 min | pending | — | 0 |
| 07 | Reconciliation-rules | T2 | 0 | 5 | 155 min | pending | — | 0 |
| 08 | Reports | T2 | 0 | 6 | 200 min | pending | — | 0 |
| 09 | Collection | T2 | 0 | 6 | 200 min | pending | — | 0 |
| 10 | Petty Cash | T2 | 0 | 6 | 250 min | pending | — | 0 |
| 11 | Dashboard | T2 | 0 | 4 | 150 min | pending | — | 0 |
| 12 | Residents | T3 | 2 | 7 | 335 min | pending | — | 0 |
| 13 | Settings | T3 | 0 | 6 | 190 min | pending | — | 0 |
| 14 | Bank-profiles | T3 | 0 | 6 | 205 min | pending | — | 0 |
| 15 | Calendar | T3 | 7 | 7 | 355 min | pending | — | 0 |
| 16 | Inventory | T3 | 2 | 6 | 220 min | pending | — | 0 |
| 17 | Notifications | T4 | 11 | 6 | 310 min | pending | — | 0 |
| 18 | WhatsApp | T4 | 16 | 8 | 420 min | pending | — | 0 |
| 19 | Audit | T4 | 0 | 5 | 155 min | pending | — | 0 |
| 20 | Email | T4 | 0 | 1 | 30 min | pending | — | 0 |
| 21 | Storage | T4 | 0 | 1 | 40 min | pending | — | 0 |
| | **TOTAL** | | **45** | **~140** | **5 710** | — | — | **0** |

---

## Hallazgos colaterales — tracking

| ID | Hallazgo | Acción | Estado | Resuelto en |
|---|---|---|---|---|
| FN-1 | `test/jest-e2e.json` no existe — script `test:e2e` roto | Crear archivo + carpeta en Fase 0 | pending | — |
| FN-2 | `CLAUDE.md` del API sin sección de testing | Elevar `strategy.md` (este audit) al CLAUDE.md tras cerrar v1 | pending | — |
| FN-3 | `supertest` no instalado | `npm install --save-dev supertest @types/supertest` en Fase 0 | pending | — |
| FN-4 | Petty-cash folio race documentada en CLAUDE.md sin test | Test en módulo `10-petty-cash` (e2e race) | pending | — |

---

## Cómo actualizar este tracker

Cuando una fase o módulo cierra:
1. Cambiar `Estado` de `pending` → `in-progress` → `completed`.
2. Llenar `PR` con el número (e.g. `#42`).
3. Llenar `Sesiones gastadas` con el real (no la estimación).
4. Actualizar `Estado global` (sumar specs/e2e/it nuevos creados).
5. Cuando un hallazgo se resuelve, marcar `Estado` y `Resuelto en`.

Cuando se cierra el v1 entero, generar `report.html` versión `closed` con
estado final y crear `v2/YYYY-MM-DD/` con nuevo baseline (`npm run test:cov`
real).
