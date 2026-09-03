package com.iconads.player.fcm

import android.content.Intent
import android.util.Log
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import com.iconads.player.power.PowerController
import com.iconads.player.util.DevicePrefs
import com.iconads.player.work.SyncWorker

class FcmService : FirebaseMessagingService() {

    // Just persists the token locally — SyncWorker compares it against the last
    // one confirmed sent to the backend and uploads it on its next run, so all
    // network I/O stays in one place instead of duplicating it here.
    override fun onNewToken(token: String) {
        Log.i(TAG, "onNewToken: ${token.take(12)}…")
        DevicePrefs(applicationContext).setFcmToken(token)
        SyncWorker.scheduleImmediate(applicationContext)
    }

    override fun onMessageReceived(message: RemoteMessage) {
        when (message.data["type"]) {
            "force_sync" -> {
                Log.i(TAG, "onMessageReceived: force_sync — encolando sync inmediato")
                SyncWorker.scheduleImmediate(applicationContext)
                // Además despierta a la Activity (el intervalo de sync ahora es
                // de minutos; sin esto las acciones del panel esperarían al
                // próximo ciclo). La Activity es la única que saca capturas.
                applicationContext.sendBroadcast(
                    Intent(ACTION_FORCE_SYNC_NOW).setPackage(applicationContext.packageName),
                )
            }
            "wake" -> {
                Log.i(TAG, "onMessageReceived: wake — encendiendo pantalla / player al frente")
                PowerController.remoteWake(applicationContext)
            }
        }
    }

    companion object {
        private const val TAG = "FcmService"
        const val ACTION_FORCE_SYNC_NOW = "com.iconads.player.FORCE_SYNC_NOW"
    }
}
