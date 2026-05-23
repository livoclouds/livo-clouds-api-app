# 18 — WhatsApp (Mensajería, FAQs, Bot, Webhooks)

**Tier**: 4 — Operacional (módulo más grande del repo)
**Rutas**: `src/modules/whatsapp/` (51 files, **8 300 LOC**, 16 specs)
**Modelos**: `WhatsAppCredential`, `WhatsAppBotConfig`, `WhatsAppFaq`, `WhatsAppConversation`, `WhatsAppMessage`, `WhatsAppUnregisteredContact`, `WhatsAppNotificationPreference`

---

## 1. Estado actual de cobertura

| Grupo | Archivos | Cobertura |
|---|---|---|
| Core service | `whatsapp.service.spec.ts` (~42 it) | ✅ credentials, FAQ matching, escalation routing, msg extraction |
| Notification dispatch | `whatsapp-notification-dispatcher.spec.ts` (~12 it) | ✅ multi-channel escalation |
| Preferences | `whatsapp-notification-preference.spec.ts` (~18 it) | ✅ update, audit, phone validation |
| Push | `whatsapp-push.service.spec.ts` (~9 it) | ✅ VAPID config, invalid subscription cleanup |
| Identity | `whatsapp-identity-capture.spec.ts` (~6 it) | ✅ resident matching, confirmation msg |
| Media | `whatsapp-media.service.spec.ts` (~6 it) | ✅ download/decrypt/size |
| Analytics | `whatsapp-analytics.service.spec.ts` (~8 it) | ✅ range aggregation |
| Retention | `whatsapp-retention.service.spec.ts` (~7 it) | ✅ old conversation cutoff |
| Unregistered | `whatsapp-unregistered.service.spec.ts` (~13 it) | ✅ registration flow |
| Renotify | `whatsapp-renotify.scheduler.spec.ts` (~7 it) | ✅ delay + preference check |
| Business hours | `whatsapp.business.hours.spec.ts` (~23 it) | ✅ off-hours, next-window |
| Credentials | `whatsapp.credentials.validate.spec.ts` (~8 it) | ✅ encryption round-trip, HMAC, phone validation |
| Residents normalize | `whatsapp.residents.normalize.spec.ts` (~12 it) | ✅ MX phone, bulk update |
| FAQ usage stats | `whatsapp.faq.usage-stats.spec.ts` (~5 it) | ✅ increment, sort |
| Internal cron | `whatsapp-internal-cron.controller.spec.ts` (~11 it) | ✅ auth + job invocation |
| Identity parser util | `utils/identity-parser.spec.ts` (~12 it) | ✅ state machine |

Cobertura efectiva: **~85%** — el mejor cubierto del repo.

Gaps: `WhatsAppMetaClientService` (wrapper de Meta — sin spec dedicado), webhook controller, controller principal, DTOs.

---

## 2. Inventario de unidades testables (gaps)

### 2.1 `WhatsAppMetaClientService` (~10 KB)

Wrapper de Meta Graph API. Sin spec dedicado — cada consumidor lo mockea, pero el wrapper en sí no se testa.

| Método | Cubre |
|---|---|
| `sendTextMessage()` | POST a Meta Graph `/messages` con bearer token |
| `sendTemplate()` | POST template payload |
| `validatePhoneNumber()` | GET Meta phone validation |
| `downloadMedia(mediaId)` | GET signed URL → download buffer |

### 2.2 `WhatsAppWebhookController.receiveWebhook` (en `whatsapp.controller.ts` o dedicado)

| Unidad | Cubre |
|---|---|
| `receiveWebhook(req)` | Verify `x-hub-signature-256` HMAC; parse Meta payload; route to service |

### 2.3 Main controller (`whatsapp.controller.ts` ~18 KB)

Múltiples endpoints (send, FAQs, conversations, analytics, settings).

### 2.4 DTOs (16 files, ~800 LOC)

SendMessageDto, ValidateNumberDto, NormalizePhonesDto, PushSubscriptionDto, AnalyticsQueryDto, etc.

---

## 3. Pruebas unitarias sugeridas

| Archivo | Casos clave |
|---|---|
| `whatsapp/whatsapp-meta-client.service.spec.ts` | Mock global `fetch`; `sendTextMessage` POST con body correcto; error 4xx/5xx → mapeo a `{ failed: true, failureKind: 'http' }` (no throw); network error → `{ failureKind: 'network' }`; access token enviado en header Bearer; phone validation parse code status |
| `whatsapp/whatsapp-webhook.controller.spec.ts` | Valid HMAC sig → 200 + routing al service; tampered body → 401; missing sig → 401; signature con prefix `sha256=` aceptada; empty body rechazado |
| `whatsapp/whatsapp.controller.spec.ts` | Endpoints role-gated; delegation |
| `whatsapp/dto/__tests__/dtos.spec.ts` (consolidado, 16 DTOs) | SendMessageDto: type enum (TEXT/TEMPLATE/IMAGE/DOCUMENT); to phone formato E.164; ValidateNumberDto phone; NormalizePhonesDto array de phones; otras validaciones |

**Total**: 4 archivos, ~35 casos.

---

## 4. Pruebas e2e sugeridas

| Archivo | Flujos |
|---|---|
| `test/whatsapp-webhook-receive.e2e-spec.ts` | POST `/webhook/whatsapp/condo-slug` con Meta payload + HMAC sig valid → 200; sig inválida → 401; payload inválido → 400 |
| `test/whatsapp-credentials.e2e-spec.ts` | PATCH credentials con access token → service llama Meta validatePhoneNumber (mock) → stores encrypted; response sanitizada (NO token leak); decrypt round-trip ok |
| `test/whatsapp-escalation.e2e-spec.ts` | Mark conversation escalated → dispatcher carga admin preferences → envía WhatsApp + Web Push (mocked); audit logs |
| `test/whatsapp-faq-ranking.e2e-spec.ts` | Create 3 FAQs; mensajes inbound disparan match → usage counts++; GET analytics → top FAQs sorted by usage desc |

**Total e2e**: 4 archivos, ~16 escenarios.

---

## 5. Estimación de tiempo Claude Code

| Bloque | Archivos | Min |
|---|---:|---:|
| Meta client wrapper spec (HTTP mock) | 1 | 30–45 |
| Webhook controller spec (HMAC verify) | 1 | 25–40 |
| Main controller spec | 1 | 20–30 |
| DTOs consolidado (16 DTOs) | 1 | 35–55 |
| e2e (4 archivos — webhook + escalation complejos) | 4 | 160–260 |
| **Subtotal** | **8** | **270–430 min** |
| Margen 20 % | — | +55–85 |
| **Total estimado** | — | **325–515 min ≈ 5–9 sesiones** |

Mediana ≈ **420 min ≈ 7 h de Claude Code**.

---

## 6. Fases internas

- **F1 — Meta client wrapper + webhook controller** (security critical): 1.5 sesiones.
- **F2 — Main controller + DTOs**: 1.5 sesiones.
- **F3 — e2e (webhook + credentials)**: 2 sesiones.
- **F4 — e2e (escalation + FAQ ranking)**: 2 sesiones.

---

## 7. Prerrequisitos / refactors

Ninguno. El módulo ya está bien estructurado con `WhatsAppMetaClientService` wrapper para todos los calls externos.

---

## 8. Restricciones / notas

- **Credential encryption** invariant (depende de `00-foundation-common.md` encryption.util): tokens stored como `(ciphertext, iv, authTag)` AES-256-GCM. NUNCA en plaintext en responses ni logs. Test cubre — verificar al ampliar.
- **HMAC webhook verify** invariant (depende de `verifyHmacSha256` de foundation): rotura permite spoofing de Meta. Test e2e cubre con sig valid + invalid + tampered.
- **Token leak**: el spec `whatsapp.credentials.validate.spec.ts` ya verifica que `JSON.stringify(result)` NO contiene el token. Mantener al ampliar.
- **Multi-tenant credential isolation**: solo una credential activa por condo. Tests cubren.
- **Personal phone verification 24h window**: tests del preference service ya lo cubren.
- **Media privacy**: encrypted at rest; decrypt on-demand. Tests cubren.
