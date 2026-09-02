package com.iconads.player.kiosk

import android.Manifest
import android.app.Activity
import android.app.admin.DevicePolicyManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.AudioManager
import android.os.Build
import android.os.UserManager
import android.util.Log
import com.iconads.player.receiver.AdminReceiver
import com.iconads.player.util.DevicePrefs

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
            // En modo test se libera la barra de estado para poder configurar
            // la tablet (WiFi, datos). Fuera de modo test, kiosco cerrado.
            setKioskLock(context, !DevicePrefs(context).getTestMode())

            // Brillo según la política remota (auto / fijo).
            applyBrightnessPolicy(context, DevicePrefs(context).getBrightnessPolicy())

            // Silencio total: la tablet en el taxi nunca suena.
            enforceSilence(context)

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

    /**
     * Cierra (locked=true) o libera (locked=false) el kiosco a nivel sistema:
     * barra de estado y features de lock task. Con modo test se libera para
     * poder entrar a Ajustes.
     */
    fun setKioskLock(context: Context, locked: Boolean) {
        if (!isDeviceOwner(context)) return
        val admin = AdminReceiver.component(context)
        val dpm = dpm(context)
        try { dpm.setStatusBarDisabled(admin, locked) } catch (e: Exception) {
            Log.w(TAG, "setStatusBarDisabled: ${e.message}")
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            try {
                dpm.setLockTaskFeatures(
                    admin,
                    if (locked) DevicePolicyManager.LOCK_TASK_FEATURE_NONE
                    else DevicePolicyManager.LOCK_TASK_FEATURE_HOME or
                        DevicePolicyManager.LOCK_TASK_FEATURE_GLOBAL_ACTIONS or
                        DevicePolicyManager.LOCK_TASK_FEATURE_NOTIFICATIONS or
                        DevicePolicyManager.LOCK_TASK_FEATURE_SYSTEM_INFO,
                )
            } catch (e: Exception) {
                Log.w(TAG, "setLockTaskFeatures: ${e.message}")
            }
        }
    }

    /**
     * Aplica la política de brillo. `policy` = "auto" (brillo automático del
     * sistema) o un número 0-255 (brillo fijo, mode manual). En estas tablets
     * el auto dimma demasiado; conviene un fijo alto.
     */
    fun applyBrightnessPolicy(context: Context, policy: String) {
        if (!isDeviceOwner(context)) return
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P) return
        val admin = AdminReceiver.component(context)
        val dpm = dpm(context)
        try {
            if (policy == "auto") {
                dpm.setSystemSetting(
                    admin,
                    android.provider.Settings.System.SCREEN_BRIGHTNESS_MODE,
                    android.provider.Settings.System.SCREEN_BRIGHTNESS_MODE_AUTOMATIC.toString(),
                )
            } else {
                val n = policy.toIntOrNull()?.coerceIn(0, 255) ?: 220
                dpm.setSystemSetting(
                    admin,
                    android.provider.Settings.System.SCREEN_BRIGHTNESS_MODE,
                    android.provider.Settings.System.SCREEN_BRIGHTNESS_MODE_MANUAL.toString(),
                )
                dpm.setSystemSetting(
                    admin,
                    android.provider.Settings.System.SCREEN_BRIGHTNESS,
                    n.toString(),
                )
            }
            Log.i(TAG, "brillo → $policy")
        } catch (e: Exception) {
            Log.w(TAG, "applyBrightnessPolicy: ${e.message}")
        }
    }

    /**
     * Silencio. La tablet del taxi no debe sonar nunca.
     *  - Con Device Owner: mute maestro (una sola llamada, lo cubre todo).
     *  - Igual, por las dudas, todos los streams a 0.
     * Barato e idempotente. NO usa DISALLOW_ADJUST_VOLUME (esa restricción, en el
     * ROM Unisoc de estas tablets, no está probada y no hace falta: alcanza con
     * el mute maestro + consumir los botones de volumen en la Activity).
     */
    fun enforceSilence(context: Context) {
        if (isDeviceOwner(context) && Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            try {
                dpm(context).setMasterVolumeMuted(AdminReceiver.component(context), true)
            } catch (e: Exception) {
                Log.w(TAG, "setMasterVolumeMuted: ${e.message}")
            }
        }
        muteAllStreams(context)
    }

    fun muteAllStreams(context: Context) {
        val am = context.getSystemService(Context.AUDIO_SERVICE) as? AudioManager ?: return
        for (s in intArrayOf(
            AudioManager.STREAM_MUSIC,
            AudioManager.STREAM_SYSTEM,
            AudioManager.STREAM_RING,
            AudioManager.STREAM_NOTIFICATION,
            AudioManager.STREAM_ALARM,
        )) {
            try { am.setStreamVolume(s, 0, 0) } catch (_: Exception) { /* restringido / no soportado */ }
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
