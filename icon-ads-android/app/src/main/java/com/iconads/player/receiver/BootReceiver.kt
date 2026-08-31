package com.iconads.player.receiver

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.iconads.player.power.PowerController

/**
 * Arranca el [PowerController] al encender la tablet o tras actualizar la app.
 * El propio servicio decide si abre el player (hay corriente / auto en
 * contacto) o deja la tablet bloqueada (sin corriente).
 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        when (intent.action) {
            Intent.ACTION_BOOT_COMPLETED,
            Intent.ACTION_MY_PACKAGE_REPLACED,
            "android.intent.action.QUICKBOOT_POWERON" -> {
                PowerController.start(context)
            }
        }
    }
}
