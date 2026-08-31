package com.iconads.player.receiver

import android.app.admin.DeviceAdminReceiver
import android.content.ComponentName
import android.content.Context

/**
 * Device Admin de la app. Sólo tiene efecto real cuando la tablet fue
 * provisionada como Device Owner:
 *
 *   adb shell dpm set-device-owner com.iconads.player/.receiver.AdminReceiver
 *
 * (tablet recién reseteada, sin ninguna cuenta agregada). Sin eso, la app
 * sigue funcionando en modo "mejor esfuerzo" — ver [com.iconads.player.kiosk.KioskManager].
 */
class AdminReceiver : DeviceAdminReceiver() {
    companion object {
        fun component(context: Context): ComponentName =
            ComponentName(context.applicationContext, AdminReceiver::class.java)
    }
}
