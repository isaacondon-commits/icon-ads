# ICON ADS — Documentación Técnica

## Arquitectura del sistema

```
┌─────────────────┐     HTTPS      ┌──────────────────────────┐
│  Android Tablet │ ─────────────► │  Backend (Render)        │
│  (Kotlin/ExoPlayer)              │  Node.js + Express       │
│                 │ ◄──────────── │  Prisma ORM              │
└─────────────────┘   playlist/ZIP └──────────┬───────────────┘
                                              │
                                    ┌─────────▼──────────┐
┌─────────────────┐     HTTPS      │  Supabase           │
│  Panel Admin    │ ─────────────► │  • PostgreSQL (DB)  │
│  (Next.js/Vercel)                │  • Storage (archivos)│
└─────────────────┘                └────────────────────-┘
```

**Flujo principal de las tablets:**
1. Boot → `BootReceiver` lanza `PlayerActivity`
2. `PlayerActivity.registerNow()` → POST `/api/device/register` → recibe token JWT
3. `SyncWorker` (cada 1h) → GET `/api/device/sync` → si hay cambios, descarga ZIP con `playlist.json` + archivos
4. Reproducción en loop: video (ExoPlayer) → imagen (Coil) → siguiente
5. Métricas: Room DB local → `MetricUploadWorker` sube cada 30min al backend

---

## Variables de entorno

### Backend (Render)

| Variable | Descripción | Requerida |
|---|---|---|
| `DATABASE_URL` | PostgreSQL pooler de Supabase (puerto 6543) | ✅ |
| `DIRECT_URL` | PostgreSQL directo (puerto 5432, para migraciones) | Recomendada |
| `JWT_SECRET` | Secreto para firmar tokens JWT | ✅ |
| `FRONTEND_URL` | URL del panel web (para CORS) | ✅ |
| `SUPABASE_URL` | URL del proyecto Supabase | Para Storage |
| `SUPABASE_SERVICE_KEY` | service_role key de Supabase | Para Storage |

**Formato DATABASE_URL (Supabase pooler con PgBouncer):**
```
postgresql://postgres.[project-ref]:[password]@aws-1-us-east-1.pooler.supabase.com:6543/postgres?pgbouncer=true
```

### Panel web (Vercel)

| Variable | Descripción |
|---|---|
| `NEXT_PUBLIC_API_URL` | URL del backend (`https://icon-ads-backend.onrender.com`) |

---

## Deploy desde cero

### 1. Base de datos — Supabase
1. Crear proyecto en [supabase.com](https://supabase.com)
2. Copiar `DATABASE_URL` (pooler, puerto 6543) y `DIRECT_URL` (directo, puerto 5432)
3. Crear bucket público llamado `ads` en Storage → o se crea automáticamente en el primer upload
4. Copiar `service_role` key desde Settings → API

### 2. Backend — Render
1. Conectar repositorio GitHub → seleccionar `icon-ads-backend` como root directory
2. Build command: `npm install && npx prisma generate && npx prisma migrate deploy`
3. Start command: `node server.js`
4. Setear variables de entorno (ver tabla arriba)
5. El `render.yaml` en la raíz del monorepo configura el servicio automáticamente

### 3. Panel web — Vercel
1. Importar repositorio → seleccionar `icon-ads-web` como root directory
2. Framework: Next.js (auto-detectado)
3. Setear `NEXT_PUBLIC_API_URL` con la URL del backend de Render

---

## Compilar la APK Android

### Requisitos
- Android Studio con JDK 21 (`C:\Program Files\Android\Android Studio\jbr`)
- Android SDK (`C:\Users\isaac\AppData\Local\Android\Sdk`)
- Archivo `icon-ads-android/keystore.properties` (no commiteado — ver nota de seguridad)
- Archivo `icon-ads-android/iconads-release.keystore` (no commiteado)

### Keystore (firma de release)
Si el keystore no existe, generarlo una sola vez:
```powershell
& "C:\Program Files\Android\Android Studio\jbr\bin\keytool.exe" `
  -genkeypair -v `
  -keystore "icon-ads-android\iconads-release.keystore" `
  -alias iconads -keyalg RSA -keysize 2048 -validity 10000 `
  -storepass iconads2024 -keypass iconads2024 `
  -dname "CN=ICON ADS, OU=Android, O=ICON ADS, L=Montevideo, ST=Montevideo, C=UY"
```

Crear `icon-ads-android/keystore.properties`:
```properties
storeFile=../iconads-release.keystore
storePassword=iconads2024
keyAlias=iconads
keyPassword=iconads2024
```

### Compilar APK de release
```powershell
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
$env:PATH = "$env:JAVA_HOME\bin;$env:PATH"
cd icon-ads-android
.\gradlew assembleRelease
```

APK de salida: `app/build/outputs/apk/release/app-release.apk`

### Compilar APK de debug
```powershell
.\gradlew assembleDebug
```
APK de salida: `app/build/outputs/apk/debug/app-debug.apk`

---

## Endpoints principales de la API

### Dispositivos (tablets)
| Método | Endpoint | Descripción |
|---|---|---|
| `POST` | `/api/device/register` | Registro automático de tablet nueva |
| `GET` | `/api/device/sync?version=N` | Verificar actualizaciones de playlist |
| `GET` | `/api/device/package/:version` | Descargar ZIP (playlist.json + archivos) |
| `POST` | `/api/device/metrics` | Subir métricas de reproducción (batch) |
| `POST` | `/api/device/error` | Registrar error del dispositivo |

**Auth:** Bearer token obtenido en `/register`

### Panel administrativo
| Método | Endpoint | Descripción |
|---|---|---|
| `POST` | `/api/auth/login` | Login → JWT |
| `GET` | `/api/campaigns` | Listar campañas |
| `POST` | `/api/campaigns` | Crear campaña |
| `POST` | `/api/ads/upload` | Subir archivo (imagen/video) a Supabase Storage |
| `GET` | `/api/tablets` | Listar tablets con estado online/offline |
| `GET` | `/api/stats` | Estadísticas globales (cacheado 5 min) |
| `GET` | `/api/health` | Health check público — `{status, db, supabase_storage, uptime}` |
| `GET` | `/api/admin/backup` | Exportar JSON completo |

**Auth:** Bearer JWT o cookie `token`

### Pública (sin login)
| Método | Endpoint | Descripción |
|---|---|---|
| `GET` | `/api/health` | Estado del sistema |
| `GET` | `/api/v1/public/*` | Endpoints con X-API-Key |

---

## Notas de seguridad

- **`keystore.properties` e `iconads-release.keystore` NUNCA deben commitearse** — están en `.gitignore`
- **`SUPABASE_SERVICE_KEY`** tiene acceso de admin a toda la DB — solo en variables de entorno del servidor
- **JWT_SECRET** debe ser una cadena aleatoria larga (≥32 chars) en producción
- El bucket `ads` de Supabase Storage es público (lectura) — los archivos son accesibles sin autenticación vía URL pública
