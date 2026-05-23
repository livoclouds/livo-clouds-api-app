# 01 — Auth + Guards (Frontera de Seguridad)

**Tier**: 1 — Seguridad
**Rutas**: `src/modules/auth/` (13 files, 2020 LOC) + `src/common/guards/` (4 guards, ~123 LOC)
**Tamaño**: ~2 143 LOC combinado

Agrupado en un solo doc porque `auth` + `guards` son la **frontera de seguridad
unificada**: el guard valida el JWT que `auth` emite; un fallo en cualquiera
filtra datos entre tenants.

---

## 1. Estado actual de cobertura

| Archivo | Cubre |
|---|---|
| `auth/auth.service.spec.ts` (765 LOC, 7 describe / 50 it) ✅ | Login + refresh + logout + me + forgot/reset + token reuse detection + timing-safe dummy hash |
| `auth/auth.controller.spec.ts` (283 LOC, 6 describe / 24 it) ✅ | DTO validation + endpoint routing + context capture (IP, UA, request-id) |
| `auth/strategies/jwt.strategy.spec.ts` (132 LOC, 1 describe / 7 it) ✅ | Active+non-deleted user lookup, ROOT pass-through |
| `common/guards/*` (4 archivos) | **ninguno** — 0 tests |

Cobertura efectiva: auth muy bien cubierto (~97%); guards 0%.

---

## 2. Inventario de unidades testables

### 2.1 Auth — ya cubierto ✅

`AuthService` (login, refresh, logout, getMe, forgotPassword, resetPassword,
getOnboarding, updateOnboarding) y `JwtStrategy.validate()` ya tienen tests
sólidos. **Gap**: validar que la cobertura está al día tras cualquier cambio.

`AuthController` también cubierto — DTO + endpoint routing.

### 2.2 Guards (`src/common/guards/`) — sin cubrir

| Guard | LOC | Complejidad | Lo que hace |
|---|---:|---|---|
| `JwtAuthGuard` | 36 | Media | Extiende `AuthGuard('jwt')`. Lee `IS_PUBLIC_KEY`; si true, bypass. Si no, delega a passport-jwt. `handleRequest()` masajea errores |
| `RolesGuard` | 43 | Media | Lee `ROLES_KEY`. Si no hay → allow. Si hay → check `user.role` ∈ list. Throws `ForbiddenException` |
| `CondominiumAccessGuard` ⭐ | 54 | **Alta** | Lee `:condominiumSlug`. Valida condominium exists + isActive. Setea `request.condominiumId`. ROOT bypassea ownership; otros deben coincidir con `user.condominiumId` |
| `ThrottlerUserGuard` | 28 | Baja | Override de `getTracker()` para devolver `${condominiumId}:${sub}` (o `sub` para ROOT; IP para anónimos) |

---

## 3. Pruebas unitarias sugeridas (lógica pura)

### 3.1 Auth (ampliaciones — gaps menores)

| Archivo | Casos clave |
|---|---|
| `auth/auth.service.spec.ts` (revisar) | Verificar cobertura de `getOnboarding` + `updateOnboarding` (mencionados como "N/A" en exploración previa); añadir si faltan |
| `auth/dto/__tests__/dtos.spec.ts` (consolidado) | `LoginDto` email + password min 8; `RefreshTokenDto`; `ForgotPasswordDto` email; `ResetPasswordDto` token + newPassword; `UpdateOnboardingDto` enum |

### 3.2 Guards (los 4)

| Archivo | Casos clave |
|---|---|
| `common/guards/jwt-auth.guard.spec.ts` | `@Public` endpoint → bypass (true sin JWT check); endpoint protegido sin Bearer → super.canActivate() falla; con Bearer válido → user inyectado; `handleRequest` con err → UnauthorizedException; con !user → UnauthorizedException |
| `common/guards/roles.guard.spec.ts` | Sin `@Roles` → allow; `@Roles(TENANT_ADMIN)` + user.role=TENANT_ADMIN → true; mismatch → 403; `@Roles(ROOT, TENANT_ADMIN)` + role=TENANT_ADMIN → true; sin request.user → 403 |
| `common/guards/condominium-access.guard.spec.ts` ⭐ | Slug existe + active + user own → `request.condominiumId` seteado + true; slug existe + active + ROOT → bypass true; slug no existe → 404 NotFoundException; condo `isActive=false` → 403; slug coincide pero user.condominiumId distinto → 403 ownership; sin param `:condominiumSlug` → pass-through (true); ROOT con `condominiumId=null` → bypass funciona |
| `common/guards/throttler-user.guard.spec.ts` | Authenticated con condominiumId → `${condominiumId}:${sub}`; ROOT con condominiumId=null → `${sub}`; sin autenticar → IP; sin IP → 'unknown' |

**Total**: 6 archivos (con 2 ampliaciones), ~45 casos.

---

## 4. Pruebas e2e sugeridas

### 4.1 Auth (flujos críticos completos)

| Archivo | Flujos |
|---|---|
| `test/auth-login.e2e-spec.ts` | Login OK (valid creds + role-shaped response); login wrong password → 401 genérico (no enumeration); login user inactivo → 401 genérico; login user soft-deleted → 401 genérico; verificar `lastLoginAt` se actualiza |
| `test/auth-refresh.e2e-spec.ts` | Refresh OK con rotación (nuevo refreshToken, viejo con `revokedAt`); refresh con token ya revocado → revoca **TODOS** los activos del user + audit `AUTH_REFRESH_REUSE_DETECTED`; refresh con expirado → 401 |
| `test/auth-password-reset.e2e-spec.ts` | `forgot-password` con cualquier email → 200 mensaje genérico (anti-enumeration); 429 → error; reset con token válido → password updated + todos los refresh tokens revocados; reset con token expirado → 401; reset con token ya usado → 401 |
| `test/auth-logout.e2e-spec.ts` | logout revoca el refresh token; `GET /auth/me` con access revocado → 401 |
| `test/auth-me.e2e-spec.ts` | `GET /auth/me` con válido → user + onboarding; `PATCH /auth/me/onboarding { status: COMPLETED }` → onboardingCompletedAt stamped |

### 4.2 Guards (cross-cutting, se ejercen en cada flujo)

Cubierto en cada e2e por módulo, pero un `test/guards.e2e-spec.ts` específico vale:
- `JwtAuthGuard`: `@Public` endpoint (e.g. `/health`) sin Bearer → 200; protegido sin Bearer → 401.
- `RolesGuard`: TENANT_ADMIN intenta endpoint @Roles(ROOT) → 403.
- `CondominiumAccessGuard`: TENANT_ADMIN de condoA intenta endpoint de condoB → 403; ROOT pasa.
- `ThrottlerUserGuard`: burst exceeded → 429; per-tenant tracking aislado.

**Total e2e**: 6 archivos, ~25 escenarios.

---

## 5. Estimación de tiempo Claude Code

| Bloque | Archivos | Min |
|---|---:|---:|
| Auth: ampliar `auth.service.spec` (gaps) + DTOs consolidado | 2 | 35–55 |
| 4 guards (jwt, roles, **condominium-access** ⭐, throttler) | 4 | 100–150 |
| 5 e2e auth flows | 5 | 200–300 |
| e2e guards consolidado | 1 | 40–60 |
| **Subtotal** | **12** | **375–565 min** |
| Margen 20 % | — | +75–115 |
| **Total estimado** | — | **450–680 min ≈ 7–11 sesiones** |

Mediana ≈ **560 min ≈ 9 h de Claude Code**.

---

## 6. Fases internas

- **F1 — Guards unit tests** (frontera de seguridad, prioridad máxima): 2.5 sesiones.
- **F2 — Auth gaps + DTOs**: 1 sesión.
- **F3 — e2e auth (login, refresh, password reset)** — los tres son críticos: 3 sesiones.
- **F4 — e2e auth (logout, me) + e2e guards consolidado**: 2 sesiones.

---

## 7. Prerrequisitos / refactors

Ninguno. Toda la lógica está testeable directamente. El patrón de mock para
`CondominiumAccessGuard` (Prisma + Reflector + ExecutionContext) se establece
aquí y se reutiliza en `02-users.md`, `03-condominiums.md` y todos los Tier
2/3 que usan tenant scoping.

---

## 8. Restricciones / notas

- **Invariantes que estos tests fijan en piedra** (rotura = vulnerabilidad):
  - `CondominiumAccessGuard` **siempre** valida `isActive` antes de setear `condominiumId`.
  - `CondominiumAccessGuard` **siempre** verifica ownership salvo para ROOT.
  - `JwtStrategy` **siempre** filtra `isActive: true, deletedAt: null`.
  - `RolesGuard` **nunca** auto-permite cuando hay `@Roles` definido.
  - `AuthService.refresh()` **siempre** revoca el viejo antes de emitir el nuevo.
  - `AuthService.refresh()` **siempre** revoca TODOS los activos al detectar reuse.
  - `AuthService.forgotPassword()` **siempre** devuelve mensaje genérico (anti-enum).
  - `AuthService.login()` **siempre** corre `bcrypt.compare` (con DUMMY_HASH si user no existe — anti-timing).
- **Encryption WhatsApp** (`19-whatsapp.md`) depende de `common/utils/encryption.util.ts` cubierto en `00-foundation-common.md`. Asegurar F1 de foundation antes de F1 de whatsapp.
- **`@Throttle` decorators** que arman la rate-limit policy del módulo (auth tiene varios: login 5/10s burst, forgot-pw 3/min, etc.) se documentan vía `ThrottlerModule` setup; no se testan unitariamente (es un integration test si se quiere — fuera de scope v1).
