package com.iconads.player.work

import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.StatFs
import android.util.Log
import androidx.work.*
import com.google.firebase.messaging.FirebaseMessaging
import com.iconads.player.data.api.NetworkModule
import com.iconads.player.data.model.FcmTokenRequest
import com.iconads.player.data.model.RegisterRequest
import com.iconads.player.data.repository.PlaylistRepository
import com.iconads.player.util.DevicePrefs
import kotlinx.coroutines.suspendCancellableCoroutine
import java.time.Instant
import java.time.ZoneId
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume

class SyncWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {

    private val prefs = DevicePrefs(context)
    private val playlistRepo = PlaylistRepository(context)
    private val tz: String = ZoneId.systemDefault().id

    private fun now() = Instant.now().toString()

    private fun hasEnoughStorage(minBytes: Long = 500L * 1024 * 1024): Boolean {
        return try {
            StatFs(applicationContext.filesDir.path).availableBytes >= minBytes
        } catch (e: Exception) {
            true
        }
    }

    override suspend fun doWork(): Result {
        return try {
            ensureRegistered()
            syncFcmTokenIfNeeded()
            sync()
            Result.success()
        } catch (e: Exception) {
            Log.e(TAG, "[${now()}] Sync falló (intento ${runAttemptCount + 1})", e)
            if (runAttemptCount < 3) Result.retry() else Result.failure()
        }
    }

    private suspend fun ensureRegistered() {
        if (prefs.getToken() != null) return

        val deviceId = DevicePrefs.getDeviceId(applicationContext)
        val api = NetworkModule.provideDeviceApi(null)
        val response = api.register(
            RegisterRequest(
                deviceId = deviceId,
                name = "Tablet ${deviceId.take(8)}",
            )
        )
        prefs.setToken(response.token)
        prefs.setTabletId(response.tabletId)
        Log.i(TAG, "[${now()} $tz] Dispositivo registrado — tabletId=${response.tabletId}")
    }

    // Fetches the current FCM token and uploads it if it differs from the last one
    // confirmed sent — covers both first install and token-refresh events, without
    // relying on onNewToken firing again while the app happens to be running.
    private suspend fun syncFcmTokenIfNeeded() {
        val deviceToken = prefs.getToken() ?: return
        val fcmToken = try {
            suspendCancellableCoroutine<String?> { cont ->
                FirebaseMessaging.getInstance().token
                    .addOnSuccessListener { cont.resume(it) }
                    .addOnFailureListener { cont.resume(null) }
            }
        } catch (e: Exception) {
            Log.w(TAG, "[${now()} $tz] No se pudo obtener FCM token: ${e.message}")
            null
        } ?: return

        if (fcmToken == prefs.getFcmTokenSent()) return

        try {
            NetworkModule.provideDeviceApi(deviceToken).updateFcmToken(FcmTokenRequest(fcmToken))
            prefs.setFcmToken(fcmToken)
            prefs.setFcmTokenSent(fcmToken)
            Log.i(TAG, "[${now()} $tz] FCM token actualizado en el backend")
        } catch (e: Exception) {
            Log.w(TAG, "[${now()} $tz] No se pudo enviar FCM token: ${e.message}")
        }
    }

    private suspend fun sync() {
        val token = prefs.getToken() ?: return
        val api = NetworkModule.provideDeviceApi(token)

        val currentVersion = prefs.getPlaylistVersion()
        val syncResp = try {
            api.sync(
                version = currentVersion,
                osVersion = Build.VERSION.RELEASE,
                deviceModel = Build.MODEL,
            )
        } catch (e: retrofit2.HttpException) {
            if (e.code() == 401) {
                // Token rechazado — probablemente revocado desde el panel admin.
                // Limpiamos el token local; el próximo ciclo se re-registra solo.
                Log.w(TAG, "[${now()} $tz] Token rechazado (401) — limpiando para re-registrar")
                prefs.clearToken()
                return
            }
            throw e
        }

        if (syncResp.rotated180 != prefs.getRotated180()) {
            prefs.setRotated180(syncResp.rotated180)
            Log.i(TAG, "[${now()} $tz] rotated180 → ${syncResp.rotated180}")
            applicationContext.sendBroadcast(
                Intent(ACTION_ROTATION_CHANGED).apply { setPackage(applicationContext.packageName) }
            )
        }

        if (!syncResp.needsUpdate) {
            Log.d(TAG, "[${now()} $tz] Ya en versión ${syncResp.version}, sin cambios")
            return
        }

        Log.i(TAG, "[${now()} $tz] Nueva versión disponible: ${syncResp.version}")

        if (!hasEnoughStorage()) {
            Log.e(TAG, "[${now()} $tz] Almacenamiento insuficiente (<500 MB) — abortando descarga")
            error("Almacenamiento insuficiente para descargar playlist")
        }

        val packageUrl = syncResp.packageUrl
            ?: "api/device/package/${syncResp.version}"

        val downloadResp = api.downloadPackage(packageUrl)
        val body = downloadResp.body() ?: error("Respuesta vacía al descargar paquete")
        val hash = downloadResp.headers()["X-Playlist-Hash"] ?: ""

        playlistRepo.installPackage(body, syncResp.version, hash)
        prefs.setPlaylistVersion(syncResp.version)

        // Notificar al PlayerActivity que recargue la playlist
        applicationContext.sendBroadcast(
            Intent(ACTION_PLAYLIST_UPDATED).apply {
                setPackage(applicationContext.packageName)
            }
        )
        Log.i(TAG, "[${now()} $tz] Sync completado → v${syncResp.version}")
    }

    companion object {
        const val TAG = "SyncWorker"
        const val ACTION_PLAYLIST_UPDATED = "com.iconads.player.PLAYLIST_UPDATED"
        const val ACTION_ROTATION_CHANGED = "com.iconads.player.ROTATION_CHANGED"
        const val WORK_NAME = "iconads_daily_sync"

        fun schedule(context: Context) {
            val constraints = Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .build()

            val request = PeriodicWorkRequestBuilder<SyncWorker>(1, TimeUnit.HOURS)
                .setConstraints(constraints)
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 15, TimeUnit.MINUTES)
                .build()

            WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                WORK_NAME,
                ExistingPeriodicWorkPolicy.KEEP,
                request,
            )
        }

        fun scheduleImmediate(context: Context) {
            val constraints = Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .build()

            val request = OneTimeWorkRequestBuilder<SyncWorker>()
                .setConstraints(constraints)
                .build()

            WorkManager.getInstance(context).enqueue(request)
        }
    }
}
