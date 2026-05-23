# 00 — Foundation (common · config · prisma · health)

**Tier**: Transversal — base sobre la que se apoyan los demás módulos
**Rutas**: `src/common/{decorators,filters,interceptors,types,utils}/` · `src/config/` · `src/prisma/` · `src/health/`
**(Los `src/common/guards/` se documentan en `01-auth-and-guards.md` porque forman la frontera de seguridad)**
**Tamaño**: ~462 LOC `common/` + 64 `config/` + 22 `prisma/` + 16 `health/` ≈ **~565 LOC**

---

## 1. Estado actual de cobertura

| Estado | Detalle |
|---|---|
| Tests existentes en estas rutas | **ninguno** (0 de 0 expected) |
| Tooling | Jest 29 + ts-jest + @nestjs/testing ya configurados |

---

## 2. Inventario de unidades testables

### 2.1 `src/common/decorators/` (~20 LOC, 3 archivos)

| Decorator | Complejidad | Lo que hace |
|---|---|---|
| `@Public()` | Baja | Metadata `IS_PUBLIC_KEY=true` para que `JwtAuthGuard` salte la validación de JWT |
| `@CurrentUser()` | Baja | Param decorator que inyecta `request.user` como `JwtPayload` |
| `@Roles(...roles)` | Baja | Metadata `ROLES_KEY=UserRole[]` para `RolesGuard` |

### 2.2 `src/common/filters/http-exception.filter.ts` (73 LOC)

| Unidad | Complejidad | Cubre |
|---|---|---|
| `GlobalExceptionFilter.catch()` | Media | Normaliza toda excepción a `{ errors: [{ code, reason, datetime, path }] }`. Mapea HttpException → status code → enum `code` (BAD_REQUEST/UNAUTHORIZED/FORBIDDEN/NOT_FOUND/CONFLICT/UNPROCESSABLE_ENTITY/TOO_MANY_REQUESTS/INTERNAL_SERVER_ERROR). Loggea no-HTTP errors. |

### 2.3 `src/common/interceptors/response.interceptor.ts` (19 LOC)

| Unidad | Complejidad | Cubre |
|---|---|---|
| `ResponseInterceptor.intercept()` | Baja | Envuelve respuestas exitosas en `{ data: T }`. APP_INTERCEPTOR global. |

### 2.4 `src/common/types/index.ts` (~44 LOC)

| Unidad | Tipo | Notas |
|---|---|---|
| `UserRole` enum (ROOT, TENANT_ADMIN, READ_ONLY, GUARD, NEIGHBOR) | Type | Sin lógica runtime — no se testa |
| `OnboardingStatus` enum (NOT_STARTED, IN_PROGRESS, COMPLETED, SKIPPED) | Type | idem |
| `JwtPayload` interface | Type | idem |
| `PaginationQuery`, `PaginatedResult<T>` interfaces | Type | idem (su shape se valida indirectamente en cada endpoint de lista) |

### 2.5 `src/common/utils/` (~156 LOC, 2 archivos)

| Util | Complejidad | Cubre |
|---|---|---|
| `encryption.util.ts::encrypt(plaintext, keyHex)` | Media | AES-256-GCM; IV aleatorio 12 bytes; devuelve `{ ciphertext, iv, authTag }` base64 |
| `encryption.util.ts::decrypt(ciphertext, iv, authTag, keyHex)` | Media | Lanza "Decryption failed" si authTag no coincide o input inválido |
| `encryption.util.ts::verifyHmacSha256(rawBody, signature, secret)` | Media | `timingSafeEqual` para evitar timing leak; acepta prefix `sha256=` |
| `phone-normalization.util.ts::normalizeMexicanPhone(raw)` | Media | Devuelve `{ outcome: 'normalized'/'alreadyValid'/'skipped'/'invalid', value }` |
| `phone-normalization.util.ts::maskPhone(value)` | Baja | Enmascara todo menos los últimos 4 dígitos |

### 2.6 `src/config/` (~64 LOC, 7 archivos)

| Config | Complejidad | Cubre |
|---|---|---|
| `app.config.ts` | Baja | `registerAs('app', () => ({ port, nodeEnv }))` |
| `cors.config.ts` | Baja | `CORS_ORIGIN` parseado a array |
| `database.config.ts` | Baja | `DATABASE_URL`, `DIRECT_URL` |
| `jwt.config.ts` | Baja | `JWT_SECRET`, `JWT_REFRESH_SECRET`, `JWT_EXPIRES_IN`, `JWT_REFRESH_EXPIRES_IN` |
| `email.config.ts` | Baja | `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_APP_URL` |
| `storage.config.ts` | Baja | Credenciales R2/S3 |
| `whatsapp.config.ts` | Baja | Meta credentials |

### 2.7 `src/prisma/` (~22 LOC, 2 archivos)

| Unidad | Complejidad | Cubre |
|---|---|---|
| `PrismaService` (extends PrismaClient) | Baja | `onModuleInit` → `$connect`; `onModuleDestroy` → `$disconnect`. Sin lógica de negocio. |

### 2.8 `src/health/health.controller.ts` (16 LOC)

| Unidad | Complejidad | Cubre |
|---|---|---|
| `HealthController.check()` | Baja | `@Public` + `@SkipThrottle`. Devuelve `{ status: 'ok', timestamp: ISO8601 }`. Sin BD. |

---

## 3. Pruebas unitarias sugeridas

| Archivo a crear | Casos clave | Cnt |
|---|---|---:|
| `src/common/filters/http-exception.filter.spec.ts` | NotFoundException→404+`NOT_FOUND`; ForbiddenException→403; UnauthorizedException→401; ConflictException→409; BadRequestException→400; ValidationError array→`UNPROCESSABLE_ENTITY` con reason comma-separated; Error genérico→500+log; response incluye datetime ISO8601 y path | 9 |
| `src/common/interceptors/response.interceptor.spec.ts` | Success → wrapped en `{ data: T }`; data null preservado; data array preservado | 3 |
| `src/common/utils/encryption.util.spec.ts` | Round-trip encrypt→decrypt; wrong key throws; tampered ciphertext throws; tampered authTag throws; IV aleatorio (dos encrypts iguales producen ciphertext distinto); empty plaintext OK; `verifyHmacSha256` valid sig→true; tampered body→false; tampered sig→false; sin prefix `sha256=` works | 11 |
| `src/common/utils/phone-normalization.util.spec.ts` | `5551234567` → normalized `+525551234567`; `+525551234567` → alreadyValid; `+521551234567` → normalized (legacy prefix); `5215551234567` → skipped (ambiguous); `+14155552671` → skipped (no MX); `""` / null → invalid; `"abc"` → invalid; `maskPhone` con varios largos | 10 |
| `src/common/decorators/__tests__/decorators.spec.ts` (consolidado) | `@Public` setea metadata `IS_PUBLIC_KEY=true`; `@Roles(ROOT, TENANT_ADMIN)` setea metadata correcto; `@CurrentUser` extrae `request.user` | 4 |
| `src/config/__tests__/configs.spec.ts` (consolidado) | jwt.config lee env correctamente; defaults aplican cuando env no está; cors.config parsea comma-separated; storage.config exige las 4 vars | 6 |
| `src/prisma/prisma.service.spec.ts` | `onModuleInit` invoca `$connect`; `onModuleDestroy` invoca `$disconnect` | 2 |
| `src/health/health.controller.spec.ts` | Devuelve `{ status: 'ok', timestamp: ISO8601 }`; sin BD; timestamp es ISO8601 válido | 3 |

**Total**: 8 archivos, **~48 casos**.

---

## 4. Pruebas e2e sugeridas

Foundation se cubre indirectamente en los e2e de cada módulo:
- `ResponseInterceptor` se ejerce en cualquier endpoint exitoso.
- `GlobalExceptionFilter` se ejerce en cualquier endpoint con error.
- `JwtAuthGuard`/`RolesGuard` en cualquier endpoint protegido.

E2e específico de foundation:
- `GET /health` → 200 + shape `{ status: 'ok', timestamp }` sin autenticación.

**Total e2e dedicados**: 1 archivo (`test/health.e2e-spec.ts`), 2 casos.

---

## 5. Estimación de tiempo Claude Code

| Bloque | Archivos | Min |
|---|---:|---:|
| Filter, Interceptor, Decorators consolidado, Health | 4 | 60–95 |
| Encryption util (round-trip + HMAC) | 1 | 20–35 |
| Phone normalization util | 1 | 20–30 |
| Configs consolidado, Prisma service | 2 | 25–40 |
| e2e health | 1 | 15–25 |
| **Subtotal** | **9** | **140–225 min** |
| Margen 18 % | — | +25–40 |
| **Total estimado** | — | **165–265 min ≈ 3–5 sesiones** |

Mediana ≈ **215 min ≈ 3.5 h de Claude Code**.

---

## 6. Fases internas

- **F1 — Plumbing puro** (filter, interceptor, response, health, decorators, configs, prisma): 2 sesiones.
- **F2 — Utils críticos** (encryption, phone normalization): 1.5 sesiones.
- **F3 — e2e health**: 0.5 sesión.

---

## 7. Prerrequisitos / refactors

Ninguno. Toda la lógica testeable de foundation ya está extraída.

---

## 8. Restricciones / notas

- Foundation no tiene componentes do-not-refactor; cualquier mejora menor es bienvenida.
- **Encryption** es base de seguridad de WhatsApp (`19-whatsapp.md`); su correctness es prerequisito para esos tests.
- **Phone normalization** la usan WhatsApp + Residents (validación de teléfonos al crear/actualizar); su correctness afecta a `19-whatsapp.md` y `12-residents.md`.
- **`PrismaService` testing minimal** — la lógica real vive en cada service; el wrapper aquí es pura instanciación.
- `JwtAuthGuard`/`RolesGuard`/`CondominiumAccessGuard`/`ThrottlerUserGuard` se documentan en **`01-auth-and-guards.md`** (porque son la frontera de seguridad).
