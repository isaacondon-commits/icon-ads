package com.iconads.player.update

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.os.Build
import android.util.Log

/**
 * Recibe el resultado de [SelfUpdateInstaller.install].
 *
 * Si el sistema exige confirmación manual (tablet sin Device Owner que todavía
 * no tiene a esta app como "installer of record"), lanza el diálogo del
 * instalador. En Device Owner nunca llega ese estado: pasa directo a
 * `STATUS_SUCCESS` y la app se reinicia sola.
 */
class UpdateInstallReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != SelfUpdateInstaller.ACTION_INSTALL_RESULT) return

        when (val status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, Int.MIN_VALUE)) {
            PackageInstaller.STATUS_PENDING_USER_ACTION -> {
                val confirm = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    intent.getParcelableExtra(Intent.EXTRA_INTENT, Intent::class.java)
                } else {
                    @Suppress("DEPRECATION")
                    intent.getParcelableExtra(Intent.EXTRA_INTENT)
                }
                if (confirm != null) {
                    confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    try {
                        context.startActivity(confirm)
                        Log.i(TAG, "Confirmación de instalación mostrada (sin Device Owner)")
                    } catch (e: Exception) {
                        Log.e(TAG, "No se pudo abrir la confirmación: ${e.message}")
                    }
                }
            }
            PackageInstaller.STATUS_SUCCESS ->
                Log.i(TAG, "Actualización instalada — la app se reiniciará")
            else -> {
                val msg = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE)
                Log.e(TAG, "Instalación falló: status=$status msg=$msg")
            }
        }
    }

    companion object {
        private const val TAG = "UpdateInstallReceiver"
    }
}
