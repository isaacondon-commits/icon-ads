package com.iconads.player.kiosk

import android.Manifest
import android.app.Activity
import android.app.admin.DevicePolicyManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.UserManager
import android.util.Log
import com.iconads.player.receiver.AdminReceiver

/**
 * Todo lo que sólo se puede hacer cuando la app es Device Owner
 * (`adb shell dpm set-device-owner com.iconads.player/.receiver.AdminReceiver`).
 *
 * Si la app NO es Device Owner cada método es un no-op silencioso y la app
 * cae al modo "mejor esfuerzo": la pantalla se muestra por encima del
 * bloqueo (`showWhenLocked`) pero no se puede apagar/lockear la tablet de
 * verdad ni ocultar la app de teléfono.
 */
object KioskManager {
    private const val TAG = "KioskManager"

    // Paquetes de UI de teléfono/llamada. Al ocultarlos, una llamada entrante
    // no tiene ninguna Activity que mostrar y el player nunca pierde foco.
    private val DIALER_PACKAGES = listOf(
        "com.google.android.dialer",
        "com.android.dialer",
        "com.samsung.android.dialer",
        "com.android.incallui",
    )

    private fun dpm(context: Context) =
        context.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager

    fun isDeviceOwner(context: Context): Boolean =
        try { dpm(context).isDeviceOwnerApp(context.packageName) } catch (_: Exception) { false }

    /** Device Admin "común" — se activa desde Ajustes o con [ensureDeviceAdmin],
     *  sin factory reset. Alcanza para `lockNow()` (apagar+bloquear pantalla). */
    fun isAdminActive(context: Context): Boolean =
        try { dpm(context).isAdminActive(AdminReceiver.component(context)) } catch (_: Exception) { false }

    /**
     * Pide activar el Device Admin (diálogo del sistema, un toque). Es lo
     * mínimo para que [lockDown] pueda apagar la pantalla al sacar el cargador
     * cuando la tablet NO es Device Owner. Si ya está activo, no hace nada.
     */
    fun ensureDeviceAdmin(activity: Activity) {
        if (isAdminActive(activity)) return
        val intent = Intent(DevicePolicyManager.ACTION_ADD_DEVICE_ADMIN).apply {
            putExtra(DevicePolicyManager.EXTRA_DEVICE_ADMIN, AdminReceiver.component(activity))
            putExtra(
                DevicePolicyManager.EXTRA_ADD_EXPLANATION,
                "ICON ADS lo usa para apagar la pantalla y ahorrar batería cuando el taxi está apagado.",
            )
        }
        try { activity.startActivity(intent) } catch (e: Exception) {
            Log.w(TAG, "ensureDeviceAdmin: ${e.message}")
        }
    }

    /**
     * Políticas permanentes de kiosco. Idempotente — se llama en cada arranque
     * del player y del [com.iconads.player.power.PowerController].
     */
    fun applyPolicies(context: Context) {
        if (!isDeviceOwner(context)) {
            Log.i(TAG, "No es Device Owner — modo mejor esfuerzo")
            return
        }
        val dpm = dpm(context)
        val admin = AdminReceiver.component(context)
        val pkg = context.packageName
        try {
            dpm.setLockTaskPackages(admin, arrayOf(pkg))
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                // Kiosco real: sin barra de estado, sin notificaciones, sin
                // keyguard mientras el player está en primer plano.
                dpm.setLockTaskFeatures(admin, DevicePolicyManager.LOCK_TASK_FEATURE_NONE)
            }
            dpm.setStatusBarDisabled(admin, true)

            // Brillo siempre en automático (Device Owner puede fijar este ajuste).
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                try {
                    dpm.setSystemSetting(
                        admin,
                        android.provider.Settings.System.SCREEN_BRIGHTNESS_MODE,
                        android.provider.Settings.System.SCREEN_BRIGHTNESS_MODE_AUTOMATIC.toString(),
                    )
                } catch (e: Exception) {
                    Log.w(TAG, "auto-brillo: ${e.message}")
                }
            }

            for (restriction in listOf(
                UserManager.DISALLOW_SAFE_BOOT,
                UserManager.DISALLOW_ADD_USER,
                UserManager.DISALLOW_CREATE_WINDOWS,
            )) {
                try { dpm.addUserRestriction(admin, restriction) } catch (e: Exception) {
                    Log.w(TAG, "restriction $restriction: ${e.message}")
                }
            }

            // Ocultar toda UI de teléfono para que no aparezca al entrar una llamada.
            for (dialer in DIALER_PACKAGES) {
                try {
                    context.packageManager.getPackageInfo(dialer, 0)
                    dpm.setApplicationHidden(admin, dialer, true)
                    Log.i(TAG, "Dialer oculto: $dialer")
                } catch (_: PackageManager.NameNotFoundException) {
                    // no instalado en esta tablet
                } catch (e: Exception) {
                    Log.w(TAG, "No se pudo ocultar $dialer: ${e.message}")
                }
            }

            // Autoconceder permisos peligrosos que la app necesita sin que
            // nadie toque un diálogo (ubicación GPS + colgar llamadas).
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                for (perm in listOf(
                    Manifest.permission.ACCESS_FINE_LOCATION,
                    Manifest.permission.ACCESS_COARSE_LOCATION,
                    Manifest.permission.READ_PHONE_STATE,
                    Manifest.permission.ANSWER_PHONE_CALLS,
                )) {
                    try {
                        dpm.setPermissionGrantState(
                            admin, pkg, perm,
                            DevicePolicyManager.PERMISSION_GRANT_STATE_GRANTED,
                        )
                    } catch (e: Exception) {
                        Log.w(TAG, "grant $perm: ${e.message}")
                    }
                }
            }
            Log.i(TAG, "Políticas de Device Owner aplicadas")
        } catch (e: Exception) {
            Log.w(TAG, "applyPolicies falló: ${e.message}")
        }
    }

    /** Player en primer plano (auto en contacto): sin bloqueo, aviso sin fricción. */
    fun enterPlaying(context: Context) {
        if (!isDeviceOwner(context)) return
        try {
            dpm(context).setKeyguardDisabled(AdminReceiver.component(context), true)
        } catch (e: Exception) {
            Log.w(TAG, "enterPlaying: ${e.message}")
        }
    }

    /**
     * Auto apagado (sin corriente) o tablet quieta 10 min: apaga la pantalla y
     * bloquea de inmediato.
     *
     *  - `lockNow()` funciona con Device Admin común (sin factory reset).
     *  - `setKeyguardDisabled(false)` sólo aplica en Device Owner (reactiva el
     *    keyguard que enterPlaying había desactivado).
     */
    fun lockDown(context: Context) {
        val admin = AdminReceiver.component(context)
        val dpm = dpm(context)
        if (isDeviceOwner(context)) {
            try { dpm.setKeyguardDisabled(admin, false) } catch (e: Exception) {
                Log.w(TAG, "lockDown keyguard: ${e.message}")
            }
        }
        if (dpm.isAdminActive(admin)) {
            try { dpm.lockNow() } catch (e: Exception) { Log.w(TAG, "lockNow: ${e.message}") }
        } else {
            Log.w(TAG, "lockDown: sin Device Admin activo — la pantalla no se puede apagar")
        }
    }
}
