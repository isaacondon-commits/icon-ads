package com.iconads.player.work

import android.content.Context
import android.content.Intent
import android.util.Log
import androidx.work.*
import com.iconads.player.data.api.NetworkModule
import com.iconads.player.data.model.RegisterRequest
import com.iconads.player.data.repository.PlaylistRepository
import com.iconads.player.util.DevicePrefs
import java.util.concurrent.TimeUnit

class SyncWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {

    private val prefs = DevicePrefs(context)
    private val playlistRepo = PlaylistRepository(context)

    override suspend fun doWork(): Result {
        return try {
            ensureRegistered()
            sync()
            Result.success()
        } catch (e: Exception) {
            Log.e(TAG, "Sync falló", e)
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
        Log.i(TAG, "Dispositivo registrado — tabletId=${response.tabletId}")
    }

    private suspend fun sync() {
        val token = prefs.getToken() ?: return
        val api = NetworkModule.provideDeviceApi(token)

        val currentVersion = prefs.getPlaylistVersion()
        val syncResp = api.sync(currentVersion)

        if (!syncResp.needsUpdate) {
            Log.d(TAG, "Ya en versión ${syncResp.version}, sin cambios")
            return
        }

        Log.i(TAG, "Nueva versión disponible: ${syncResp.version}")
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
        Log.i(TAG, "Sync completado → v${syncResp.version}")
    }

    companion object {
        const val TAG = "SyncWorker"
        const val ACTION_PLAYLIST_UPDATED = "com.iconads.player.PLAYLIST_UPDATED"
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
