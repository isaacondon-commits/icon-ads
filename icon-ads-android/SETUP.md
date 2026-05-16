# Icon Ads Android — Setup

## Abrir el proyecto

1. Abrir **Android Studio**
2. `File → Open` → seleccionar la carpeta `icon-ads-android/`
3. Android Studio descargará el Gradle wrapper automáticamente

## Configurar la IP del servidor

Editar `app/build.gradle.kts` y cambiar la `BASE_URL` para apuntar al backend:

```kotlin
// Para emulador (localhost del host)
buildConfigField("String", "BASE_URL", "\"http://10.0.2.2:3000\"")

// Para tablet real en la misma red WiFi
buildConfigField("String", "BASE_URL", "\"http://192.168.X.X:3000\"")
```

## Fallback institucional

Colocar el video institucional en `app/src/main/res/raw/institutional.mp4`.
Este video se reproduce cuando no hay playlist descargada.

## Modo kiosco (Lock Task)

Para habilitar el verdadero modo kiosco, la tablet debe estar configurada como
**Device Owner**. Desde ADB:

```bash
adb shell dpm set-device-owner com.iconads.player/.receiver.AdminReceiver
```

Sin eso, `startLockTask()` falla silenciosamente y la app sigue funcionando
en fullscreen normal.

## API del dispositivo

| Endpoint | Descripción |
|---|---|
| `POST /api/device/register` | Primer arranque — obtiene token |
| `GET /api/device/sync?version=N` | Chequea si hay actualización |
| `GET /api/device/package/:v` | Descarga ZIP con playlist + media |
| `POST /api/device/metrics` | Sube métricas de reproducción |
| `POST /api/device/error` | Reporta errores al backend |

## Flujo de sincronización

```
Boot → PlayerActivity
  → SyncWorker (inmediato + cada 1h si hay internet)
      → /api/device/register (solo primera vez)
      → /api/device/sync?version=N
      → si needsUpdate: descarga ZIP → extrae → actualiza Room DB
      → broadcast PLAYLIST_UPDATED → PlayerActivity recarga
  → MetricUploadWorker (cada 30 min si hay internet)
      → sube métricas pendientes de Room DB
```

## Sistema de fallback 3 niveles

| Nivel | Fuente | Descripción |
|---|---|---|
| 1 | `files/playlists/current/` | Última sincronización exitosa |
| 2 | `files/playlists/backup/` | Sincronización anterior |
| 3 | `res/raw/institutional.mp4` | Video institucional hardcodeado |
