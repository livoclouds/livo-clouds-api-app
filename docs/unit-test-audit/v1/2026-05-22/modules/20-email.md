# 20 — Email (Resend transactional)

**Tier**: 4 — Soporte
**Rutas**: `src/modules/email/` (2 files, 84 LOC, 0 specs)

---

## 1. Estado actual de cobertura

| Estado | Detalle |
|---|---|
| Tests existentes | **ninguno** |
| External service | Resend API |

---

## 2. Inventario de unidades testables

### 2.1 Service (`email.service.ts` 76 LOC)

| Método | Complejidad | Cubre |
|---|---|---|
| `sendPasswordResetEmail(email, token, locale)` | Media | Si `RESEND_API_KEY` ausente → log warning + return (graceful degradation); call `Resend.emails.send`; URL construida con `email.appUrl + /<locale>/reset-password?token=`; catch error → log + swallow (NO rethrow) |
| `onModuleInit` | Baja | Inicializa client Resend si key presente |

---

## 3. Pruebas unitarias sugeridas

| Archivo | Casos clave |
|---|---|
| `email/email.service.spec.ts` | Sin `RESEND_API_KEY` → log warning + return undefined (graceful, no throw); con key → Resend constructor llamado; `sendPasswordResetEmail` arma body con to + subject + html; URL incluye locale + token; Resend.send throws → caught + logged + return undefined (NO rethrow); subject en ES vs EN según locale |

**Total**: 1 archivo, ~8 casos.

---

## 4. Pruebas e2e sugeridas

E2e indirecto: `test/auth-password-reset.e2e-spec.ts` (módulo 01) ya cubre que `POST /auth/forgot-password` siempre devuelve 200 (regardless of email send result). No e2e dedicado.

**Total e2e**: 0 archivos dedicados (cubierto cross-module).

---

## 5. Estimación de tiempo Claude Code

| Bloque | Archivos | Min |
|---|---:|---:|
| Service spec | 1 | 20–30 |
| **Total estimado** | — | **20–30 min ≈ 0.5 sesión** |
| Margen | — | +5–10 |
| **Final** | — | **~30 min ≈ 0.5 sesión** |

---

## 6. Fases internas

- **F1 — Service spec único**: 0.5 sesión.

---

## 7. Prerrequisitos / refactors

Ninguno.

---

## 8. Restricciones / notas

- **Graceful degradation** invariant: email failure NUNCA debe bloquear el endpoint que lo invoca (e.g. `POST /auth/forgot-password` devuelve 200 incluso si Resend falla — esto es CRÍTICO para anti-enumeration). Test fija.
- **No throw** policy: el service swallow errores de Resend; loggea sí.
- **Locale-aware URL**: `${appUrl}/${locale}/reset-password?token=${token}`. Test con `en` y `es`.
- **Cost-aware**: Resend cobra por email; e2e dedicado se mockea siempre.
