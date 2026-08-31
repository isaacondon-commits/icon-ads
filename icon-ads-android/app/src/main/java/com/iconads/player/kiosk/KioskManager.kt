package com.iconads.player.kiosk

import android.Manifest
import android.app.admin.DevicePolicyManager
import android.content.Context
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
     * Auto apagado (sin corriente) o tablet quieta 10 min: re-activa el
     * bloqueo y apaga la pantalla de inmediato. Nadie puede tocar la tablet.
     */
    fun lockDown(context: Context) {
        if (!isDeviceOwner(context)) return
        val admin = AdminReceiver.component(context)
        try {
            dpm(context).setKeyguardDisabled(admin, false)
            dpm(context).lockNow()
        } catch (e: Exception) {
            Log.w(TAG, "lockDown: ${e.message}")
        }
    }
}
