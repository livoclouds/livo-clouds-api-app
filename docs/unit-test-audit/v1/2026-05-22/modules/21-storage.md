# 21 — Storage (Cloudflare R2)

**Tier**: 4 — Soporte
**Rutas**: `src/modules/storage/` (2 files, 101 LOC, 0 specs)

---

## 1. Estado actual de cobertura

| Estado | Detalle |
|---|---|
| Tests existentes | **ninguno** |
| External service | Cloudflare R2 (via AWS S3 SDK) |

---

## 2. Inventario de unidades testables

### 2.1 Service (`storage.service.ts` 93 LOC)

| Método | Complejidad | Cubre |
|---|---|---|
| `uploadFile(buffer, key, mimeType)` | Baja | `S3Client.send(PutObjectCommand)` con bucket + key + body |
| `getPresignedUrl(key, expiresIn=3600)` | Baja | `getSignedUrl(s3Client, GetObjectCommand, { expiresIn })` |
| `downloadFile(key)` | Baja | `S3Client.send(GetObjectCommand)` → stream body → chunks concatenated |
| `deleteFile(key)` | Baja | `S3Client.send(DeleteObjectCommand)` |
| `isConfigured()` | Baja | Boolean basado en presencia de 4 env vars |
| `constructor` | Baja | Throws si alguna env var falta → `this.configured = false`; cada método throws "not configured" |

---

## 3. Pruebas unitarias sugeridas

| Archivo | Casos clave |
|---|---|
| `storage/storage.service.spec.ts` | Sin las 4 env vars → `isConfigured() === false` + cada método throws "External storage is not configured"; con todo configurado → `S3Client.send` mockeado, verifica command + params; `uploadFile` invoca PutObjectCommand con bucket+key+body+contentType; `getPresignedUrl` invoca getSignedUrl con TTL custom (default 3600); `downloadFile` stream chunks → Buffer concatenado correctamente (mock 2-3 chunks); `deleteFile` invoca DeleteObjectCommand |

**Total**: 1 archivo, ~10 casos.

---

## 4. Pruebas e2e sugeridas

E2e indirecto: cualquier flujo que use storage (imports upload → R2 ya se mockea allí, no e2e dedicado).

Si se quisiera e2e dedicado: requiere `minio` o `localstack` corriendo, fuera de scope v1.

**Total e2e**: 0 archivos dedicados (cubierto cross-module).

---

## 5. Estimación de tiempo Claude Code

| Bloque | Archivos | Min |
|---|---:|---:|
| Service spec | 1 | 25–40 |
| **Total estimado** | — | **25–40 min ≈ 0.5 sesión** |
| Margen | — | +5–10 |
| **Final** | — | **~40 min ≈ 0.5–1 sesión** |

---

## 6. Fases internas

- **F1 — Service spec único**: 0.5 sesión.

---

## 7. Prerrequisitos / refactors

Ninguno.

---

## 8. Restricciones / notas

- **Config validation** invariant: las 4 env vars (accountId, accessKeyId, secretAccessKey, bucketName) son obligatorias. Sin alguna → todos los métodos throw. Test cubre.
- **Error propagation policy**: a diferencia de email (graceful), storage **propaga** errores (throw). Caller decide qué hacer. Test fija.
- **Signed URL expiry**: default 3600s. Tests con custom TTL.
- **Stream-based download**: no carga el archivo entero en memoria; chunks concatenados. Test con mock stream verifica.
- **Cost-aware**: R2 cobra por request; e2e dedicado siempre mockea S3Client.
