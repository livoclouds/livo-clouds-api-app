# Estrategia de Pruebas Unitarias + e2e — v1 (2026-05-22)

> Documento técnico que ancla el alcance, herramientas, convenciones, y metodología
> de estimación usados por todo el `v1/2026-05-22/`. Léase **antes** de cualquier
> `modules/NN-<modulo>.md` o del `report.md`/`report.html`.

---

## 1. Alcance del v1

Dos tipos de prueba caen dentro del alcance:

1. **Pruebas unitarias** (`*.spec.ts`, entorno `node`, mock de Prisma). Verifican
   services, controllers, guards, interceptors, filters, DTOs (class-validator),
   utilidades puras, listeners de eventos, gateways, crons. Es el patrón que el
   repo **ya está usando** (45 specs existentes con 734 bloques
   `describe`+`it`, todos pasan vía `npm test`).
2. **Pruebas e2e** (`test/<flujo>.e2e-spec.ts`, supertest + Fastify, DB test
   efímera). Verifican flujos completos desde HTTP a Prisma — login, importación,
   reconciliación, residents CRUD, terrace booking, webhook WhatsApp.

Quedan fuera del v1:
- **Test de Meta Graph API reales** — todos los flujos WhatsApp mockean
  `WhatsAppMetaClientService` (la clase wrapper existe a propósito para esto).
- **Test contra Resend real** — graceful degradation cubre el path "sin API key";
  el path con API key se mockea.
- **Test contra Cloudflare R2 real** — `StorageService` se mockea con jest.fn
  sobre los comandos S3 SDK (PutObjectCommand, GetObjectCommand).
- **Load testing / performance benchmarks** — fuera del scope de un coverage audit.

---

## 2. Stack de pruebas

| Capa | Herramienta | Estado |
|---|---|---|
| Runner | **Jest 29.7** | Ya presente (`jest@^29.7.0`) |
| Preprocesador | **ts-jest 29.3** | Ya presente |
| NestJS testing module | **@nestjs/testing 10.4** | Ya presente |
| Entorno | `testEnvironment: "node"` | Ya configurado en `package.json` clave `jest` |
| HTTP supertest (e2e) | **`supertest` + `@types/supertest`** | **Por añadir** |
| HMAC / encryption mocks | crypto built-in | Sin cambios |
| Mocks externos (Meta, Resend, R2) | `jest.fn()` + clase wrapper | Sin cambios |
| Coverage | Jest built-in (`--coverage`) | Ya disponible (`npm run test:cov`) |

### Dependencias a instalar (Fase 0)

```bash
npm install --save-dev supertest @types/supertest
```

> El repo usa **npm** como package manager primario (también hay `pnpm-lock.yaml`
> pero `package-lock.json` es el de referencia — ver `CLAUDE.md` y los scripts
> `npm run prisma:*`).

---

## 3. Cambios a la configuración de tests

### 3.1 Unit tests (sin cambios)

La config inline en `package.json` ya funciona:

```json
"jest": {
  "moduleFileExtensions": ["js", "json", "ts"],
  "rootDir": "src",
  "testRegex": ".*\\.spec\\.ts$",
  "transform": { "^.+\\.(t|j)s$": "ts-jest" },
  "collectCoverageFrom": ["**/*.(t|j)s"],
  "coverageDirectory": "../coverage",
  "testEnvironment": "node"
}
```

Los 45 specs existentes ejecutan idéntico tras este audit.

### 3.2 e2e tests (**hoy roto — Fase 0 lo arregla**)

El script `npm run test:e2e` referencia `./test/jest-e2e.json` que **no existe**
(la carpeta `test/` tampoco). Fase 0 del rollout debe:

1. Crear `test/` en la raíz del repo.
2. Crear `test/jest-e2e.json`:

   ```json
   {
     "moduleFileExtensions": ["js", "json", "ts"],
     "rootDir": ".",
     "testEnvironment": "node",
     "testRegex": ".e2e-spec.ts$",
     "transform": { "^.+\\.(t|j)s$": "ts-jest" },
     "moduleNameMapper": { "^@/(.*)$": "<rootDir>/../src/$1" },
     "setupFilesAfterEnv": ["./setup.e2e.ts"]
   }
   ```

3. Crear `test/setup.e2e.ts` que bootstrap-ee Fastify una vez, levante la
   `PrismaService` contra la **test DB**, y ejecute `prisma migrate deploy` +
   `prisma db seed` antes de la suite (o por suite, según trade-off).
4. Añadir scripts auxiliares:

   ```json
   "test:e2e:cov": "jest --config ./test/jest-e2e.json --coverage",
   "test:e2e:setup": "DATABASE_URL=$TEST_DATABASE_URL prisma migrate deploy && DATABASE_URL=$TEST_DATABASE_URL prisma db seed"
   ```

### 3.3 Decisión Prisma en e2e (importante)

Dos opciones, **se recomienda la primera para flujos críticos**:

**(A) Test DB efímera (recomendado para login/import/reconciliación)**:
- `DATABASE_URL=$TEST_DATABASE_URL` apuntando a una Postgres separada (docker
  compose `test-db`, o Neon branch dedicada).
- `prisma migrate deploy` + `prisma db seed` en `globalSetup`.
- Cada suite usa `TRUNCATE`+seed entre tests, o transacciones rollback.
- **Pro**: cubre joins reales, constraints, P2002, transacciones.
- **Contra**: ~10–30s setup; necesita infra.

**(B) Mock del `PrismaService` al boundary (para flujos no-críticos)**:
- `Test.createTestingModule({...}).overrideProvider(PrismaService).useValue(prismaMock)`.
- **Pro**: rápido, sin infra.
- **Contra**: no cubre joins/constraints; equivale a un unit test con HTTP layer.

> Recomendado: **mix**. Flujos financieros/auth → DB real. CRUD simple →
> mock Prisma. Se decide por módulo en el `modules/NN-*.md`.

---

## 4. Convenciones del repo (heredadas de `CLAUDE.md`)

### 4.1 Colocación

- **Unit tests**: `[archivo].spec.ts` colocado junto al `.ts` que prueba.
- **e2e tests**: `test/<flujo>.e2e-spec.ts` (un archivo por flujo crítico).
- Subcarpetas con `__tests__/` son aceptables si crecen.

### 4.2 Extracción de helpers puros

Cuando un service tiene lógica densa que se beneficia de testarse pura, se
extrae a un archivo hermano `.ts`. El repo ya tiene precedentes:

| Service origen | Helper extraído | Test |
|---|---|---|
| `classification.service.ts` | `classification/terrace-booking-matcher.ts` | ✅ `terrace-booking-matcher.spec.ts` |
| `classification.service.ts` | `classification/terrace-keywords.util.ts` | ✅ `terrace-keywords.util.spec.ts` |
| `calendar.service.ts` | `calendar/recurrence.ts` | ✅ `recurrence.spec.ts` |
| `calendar.service.ts` | `calendar/terrace-metadata.validator.ts` | ✅ `terrace-metadata.validator.spec.ts` |
| `calendar.service.ts` | `calendar/visibility.util.ts` | ✅ `visibility.util.spec.ts` |
| `calendar.service.ts` | `calendar/timezone.util.ts` | ✅ `timezone.util.spec.ts` |
| `calendar.service.ts` (reclassify trigger) | `calendar/reclassify/should-trigger-reclassify.ts` | ✅ `should-trigger-reclassify.spec.ts` |
| `whatsapp.service.ts` (parser) | `whatsapp/utils/identity-parser.ts` | ✅ `identity-parser.spec.ts` |
| `whatsapp.service.ts` (hours) | `whatsapp/utils/business-hours.util.ts` | ✅ `business-hours.spec.ts` |

Este patrón se replica para extracciones nuevas que aparezcan necesarias al
escribir tests (p. ej. `imports/parser/excel.parser.ts` ya es un helper puro
listo para test).

### 4.3 Patrón de mock — `makePrismaMock()`

Cada service-spec define helpers para construir mocks tipados de Prisma.
Patrón canónico ya en uso en `auth/auth.service.spec.ts`:

```ts
interface PrismaMock {
  user: { findFirst: jest.Mock; findMany: jest.Mock; create: jest.Mock; updateMany: jest.Mock; };
  refreshToken: { findFirst: jest.Mock; create: jest.Mock; updateMany: jest.Mock; };
  passwordResetToken: { create: jest.Mock; findFirst: jest.Mock; update: jest.Mock; };
  $transaction: jest.Mock;
}

function makePrismaMock(): PrismaMock {
  return {
    user: { findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn(), updateMany: jest.fn() },
    refreshToken: { findFirst: jest.fn(), create: jest.fn(), updateMany: jest.fn() },
    passwordResetToken: { create: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
    $transaction: jest.fn((arg) => Array.isArray(arg) ? Promise.all(arg) : arg(prismaMock)),
  };
}
```

Reutilizar este patrón para los nuevos service-specs. Incluir solo las
delegations Prisma que el service-bajo-prueba realmente llama.

### 4.4 `bcryptjs` mocking

Para evitar 12 rondas reales en tests:

```ts
jest.mock('bcryptjs', () => ({
  hashSync: jest.fn(() => '$2b$12$test-dummy-hash'),
  hash: jest.fn(async () => '$2b$12$test-dummy-hash'),
  compare: jest.fn(),
}));
```

> Nota: el repo usa `bcryptjs`, **no** `bcrypt` (compatibilidad Vercel —
> `CLAUDE.md`).

### 4.5 Mocking de servicios externos (Meta, Resend, R2)

La clase wrapper `WhatsAppMetaClientService` existe a propósito para
mockear Meta en un solo punto:

```ts
const metaClient = {
  sendTextMessage: jest.fn(),
  sendTemplate: jest.fn(),
  validatePhoneNumber: jest.fn(),
  downloadMedia: jest.fn(),
};

const module = await Test.createTestingModule({
  providers: [
    WhatsAppService,
    { provide: WhatsAppMetaClientService, useValue: metaClient },
    { provide: PrismaService, useValue: prismaMock },
    // ...
  ],
}).compile();
```

Resend: mockear `email.service.ts` directamente o el constructor de `Resend`.
R2: mockear `S3Client.send()` para cada Command (Put/Get/Delete).

### 4.6 Naming y AAA

- Suites con `describe('<ServiceName>.<methodName>')`.
- Casos con `it('<observable behavior>', async () => {...})`.
- Patrón Arrange-Act-Assert (algunos specs ya lo señalan con comentarios).
- Cero `any`; tipos del módulo bajo prueba o de `@/common/types`.
- Fixtures financieras realistas: montos como `1250.50` (no `1+1`), fechas
  como `2026-05-22T18:00:00Z`, IDs UUID-like.

---

## 5. Reglas heredadas del `CLAUDE.md` (que todo test debe respetar)

Estas son **invariantes que los tests fijan en piedra** — un test rojo aquí
señala una regresión grave:

1. **Pagination shape**: cada endpoint de lista devuelve `{ data: T[], meta: { total, page, limit, totalPages } }`. Defaults documentados en `CLAUDE.md` (residents 200/500, collection 200/1000, calendar 500/2000, audit/imports 50/200).
2. **Tenant scoping**: cada `where` deriva `condominiumId` de `request.condominiumId` puesto por `CondominiumAccessGuard`. **Nunca** de query params, body, o path más allá del slug validado. `ROOT` bypassea en el guard, no en el service.
3. **Projection**: `findMany()` sobre tablas no acotadas (`Transaction`, `AuditLog`, `ImportBatch`, `CalendarEvent`, `PettyCashMovement`) usa `select` o `include` explícito.
4. **Time-bounded endpoints**: `/calendar/events`, `/transactions`, `/audit/logs` exigen `from`/`to` validados; el service aplica el overlap predicate.
5. **Batched DB access**: cuando N items necesitan un lookup (p. ej. dedup SHA-256 de import), una sola query `findMany({ where: { x: { in: [...] } } })`. Nunca loop con `await` secuencial.
6. **Concurrencia P2002**: identificadores tenant-scoped (`PettyCashMovement.folio` con `@@unique([condominiumId, folio])`) envuelven `count + create` en retry acotado capturando `P2002`. `MAX_FOLIO_RETRIES = 5`. Tests deben simular la race.
7. **Throttling**: `@Throttle({ burst, sustained })` en endpoints cuyo trabajo escala con payload (bulk reconcile, bulk classify, import process). Global `ThrottlerUserGuard` scopea por `(condominiumId, userId)`.
8. **Logging**: NestJS `Logger` siempre, **nunca** `console.*`. Cada service instancia `private readonly logger = new Logger(ServiceName.name);`. Tests pueden espiar `logger.warn/log/error`.
9. **Swagger**: off en production (`if (process.env.NODE_ENV !== 'production')` en `main.ts`).
10. **safeSelect()**: services nunca devuelven `passwordHash`. Verificar en tests de `users`, `auth`, `findMe`.
11. **Soft delete**: `User` y `Resident` tienen `deletedAt`. Cada query debe filtrar `deletedAt: null`. Tests deben cubrir el caso de un user/resident soft-deleted que NO debe aparecer.
12. **Refresh token rotation**: cada `refresh()` revoca el viejo (`revokedAt = new Date()`) antes de emitir el nuevo. Reuse de un token ya revocado → revocar TODOS los activos del usuario + audit `AUTH_REFRESH_REUSE_DETECTED`.
13. **Append-only audit**: módulo `audit` **nunca** `update`/`delete`. Solo `create`. Tests fijan esa invariante.
14. **Encryption WhatsApp**: tokens almacenados como `(ciphertext, iv, authTag)` AES-256-GCM. Tests round-trip + tamper rejection. Nunca expongan plaintext en responses ni en logs.
15. **HMAC webhook**: Meta webhooks verifican `x-hub-signature-256` con HMAC-SHA256 + `timingSafeEqual`. Tests con firma válida, body alterado, firma vacía.

---

## 6. Clasificación de unidades testables

Cada unidad en los `modules/NN-*.md` se etiqueta con uno de estos tipos:

| Tipo | Cómo se prueba | Entorno | Ejemplos en el repo |
|---|---|---|---|
| **Service method** | `Test.createTestingModule` con Prisma mock, `service.method(...)` → assert | `node` | `auth.service.spec.ts`, `calendar.service.spec.ts` |
| **Controller endpoint** | Mock service, instanciar controller, llamar método | `node` | `auth.controller.spec.ts`, `notifications.controller.spec.ts` |
| **Guard** | Mock ExecutionContext + Reflector, llamar `canActivate()` | `node` | (sin tests aún — Tier 1) |
| **Interceptor / Filter** | Mock ExecutionContext / ArgumentsHost | `node` | (sin tests aún) |
| **DTO + class-validator** | `validate(plainToInstance(Dto, payload))` → assert errores | `node` | `list-residents.dto.spec.ts`, `list-common-areas.dto.spec.ts` |
| **Pure helper / util** | Llamada directa con input → assert output | `node` | `recurrence.spec.ts`, `terrace-metadata.validator.spec.ts`, `business-hours.spec.ts` |
| **Event listener** | Instanciar listener, inyectar dependencias mock, llamar `handle()` | `node` | `auth-notifications.listener.spec.ts` |
| **Gateway (SSE)** | Instanciar gateway, `register()` + `emitAfterWrite()` → assert subscriptions | `node` | `notifications.gateway.spec.ts` |
| **Cron** | Instanciar cron, mock dependencias, llamar `handleCron()` | `node` | `notifications.cron.spec.ts` |
| **External-API wrapper** | Mock `fetch` o el client SDK, verificar payload + manejo de errores | `node` | (sin tests aún — `whatsapp-meta-client.service.ts`) |
| **e2e flow** | `supertest(app.getHttpServer()).post(...).send(...).expect(...)` | `node` + test DB | (sin tests aún — Fase 0) |

---

## 7. Metodología de estimación — "tiempo Claude Code"

> **Atención**: las estimaciones son del tiempo de ejecución de Claude Code
> trabajando autónomamente sobre el repo, **no** del tiempo de un humano.

### 7.1 Tabla base por archivo de test

| Categoría | Min por archivo `.spec.ts` |
|---|---:|
| Unit de service simple (mock Prisma plano, 2–3 ramas) | **10–15 min** |
| Unit de service medio (multi-rama, helpers, EventEmitter, AuditService) | **20–35 min** |
| Unit de service complejo (clasificación, parsers, recurrencia, dispatch) | **40–60 min** |
| Unit de controller (delega a service mock, DTO binding) | **10–15 min** |
| Unit de DTO (class-validator + class-transformer) | **10–15 min** |
| Unit de guard | **20–30 min** (multi-tenant + roles) |
| Unit de interceptor / filter | **15–25 min** |
| Unit de event listener | **15–25 min** |
| Unit de gateway (SSE / WebSocket) | **25–40 min** (subscriptions, cleanup) |
| Unit de cron | **15–25 min** |
| Unit de external-API wrapper (Meta, Resend, R2) | **20–35 min** |
| Unit de pure helper / util | **10–20 min** |
| e2e single flow (supertest + Fastify + test DB) | **30–60 min** |

### 7.2 Coste adicional ("refactor previo")

Cuando un service requiere extraer un helper antes de testarse cómodamente:

- Extracción simple (mover 1 función pura inline a `.ts` y reimportar): **10–15 min**.
- Extracción media (mover un bloque de filtros/sort + actualizar consumidor): **20–30 min**.
- Extracción compleja (separar responsabilidades, tipos compartidos): **30–60 min**.

### 7.3 Sobrecoste por módulo

A la suma de archivos del módulo se suma un **margen de corrección de fallos**
del **15–20 %** para iteraciones de tests rojos, ajustes de tipos, paridad
`npm run typecheck` y `npm run lint`.

### 7.4 Cómo leer las estimaciones

- Las cifras son rangos (min–max). El `report.md` y `report.html` totalizan
  con el **punto medio** del rango.
- Una "sesión" de Claude Code en este repo se considera ~45–60 min de trabajo
  efectivo (lectura + escritura + ejecución de `npm test`). El total por módulo
  también se expresa en "sesiones equivalentes".

---

## 8. Ejecución incremental

Cada módulo se entrega como un PR independiente que cumple:

1. `npm run typecheck` y `npm run lint` pasan.
2. `npm test` pasa (incluyendo los tests nuevos del módulo).
3. Si el módulo añade e2e: `npm run test:e2e` pasa (requiere test DB
   levantada).
4. Cero cambios fuera del scope del módulo + posibles extracciones de helpers
   puros.
5. Se respeta `CLAUDE.md §Git`: no se commitea automáticamente; sin
   `Co-Authored-By`; título imperativo; cuerpo detallado.

---

## 9. CLAUDE.md no tiene sección de testing — esta auditoría la establece

A diferencia del web (`§18` del CLAUDE.md del web), el CLAUDE.md del API
**no tiene una sección dedicada a testing**. Este audit la establece de facto
vía `strategy.md` (este documento) y los `modules/NN-*.md`. Se propone (no
ejecutado en v1) elevarla al CLAUDE.md del API en un PR posterior con:

- Stack (Jest, supertest, mocks).
- Convenciones (helpers `makePrismaMock`, bcryptjs mock, AAA).
- Invariantes (las 15 enumeradas en §5 de este doc).
- Política de cobertura (qué módulos exigen 100 %, cuáles 80 %, cuáles best-effort).
- Comandos (`npm test`, `npm run test:cov`, `npm run test:e2e`).
