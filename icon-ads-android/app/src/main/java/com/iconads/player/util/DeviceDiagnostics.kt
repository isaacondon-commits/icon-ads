package com.iconads.player.util

import android.app.ActivityManager
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.BatteryManager
import android.os.Build
import android.os.PowerManager
import android.os.StatFs
import android.os.SystemClock
import com.iconads.player.BuildConfig
import com.iconads.player.kiosk.KioskManager
import java.io.File

// Diagnóstico completo que el panel pide desde Mantenimiento: almacenamiento,
// memoria, batería, red y estado del sistema. Todo best-effort: un dato que no
// se puede leer queda en null y no frena al resto.
object DeviceDiagnostics {

    fun collect(context: Context): MutableMap<String, Any?> {
        val d = linkedMapOf<String, Any?>()
        d["appVersion"] = BuildConfig.VERSION_NAME
        d["appVersionCode"] = BuildConfig.VERSION_CODE
        d["android"] = Build.VERSION.RELEASE
        d["sdk"] = Build.VERSION.SDK_INT
        d["model"] = "${Build.MANUFACTURER} ${Build.MODEL}"
        d["uptimeMin"] = SystemClock.elapsedRealtime() / 60_000
        d["deviceClock"] = System.currentTimeMillis()

        safe {
            val st = StatFs(context.filesDir.absolutePath)
            d["storageFreeMb"] = st.availableBytes / MB
            d["storageTotalMb"] = st.totalBytes / MB
        }
        safe { d["playlistMb"] = dirSize(File(context.filesDir, "playlists")) / MB }
        safe { d["cacheMb"] = dirSize(context.cacheDir) / MB }

        safe {
            val am = context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
            val mi = ActivityManager.MemoryInfo().also { am.getMemoryInfo(it) }
            d["ramFreeMb"] = mi.availMem / MB
            d["ramTotalMb"] = mi.totalMem / MB
            d["lowMemory"] = mi.lowMemory
        }

        safe {
            val i = context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
            if (i != null) {
                val level = i.getIntExtra(BatteryManager.EXTRA_LEVEL, -1)
                val scale = i.getIntExtra(BatteryManager.EXTRA_SCALE, -1)
                if (level >= 0 && scale > 0) d["batteryPct"] = level * 100 / scale
                d["batteryHealth"] = when (i.getIntExtra(BatteryManager.EXTRA_HEALTH, 0)) {
                    BatteryManager.BATTERY_HEALTH_GOOD -> "buena"
                    BatteryManager.BATTERY_HEALTH_OVERHEAT -> "recalentada"
                    BatteryManager.BATTERY_HEALTH_DEAD -> "agotada"
                    BatteryManager.BATTERY_HEALTH_OVER_VOLTAGE -> "sobretensión"
                    BatteryManager.BATTERY_HEALTH_COLD -> "fría"
                    BatteryManager.BATTERY_HEALTH_UNSPECIFIED_FAILURE -> "falla"
                    else -> "desconocida"
                }
                d["batteryTempC"] = i.getIntExtra(BatteryManager.EXTRA_TEMPERATURE, Int.MIN_VALUE)
                    .takeIf { it != Int.MIN_VALUE }?.let { it / 10.0 }
                d["batteryVoltageMv"] = i.getIntExtra(BatteryManager.EXTRA_VOLTAGE, -1).takeIf { it > 0 }
                d["charging"] = when (i.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0)) {
                    BatteryManager.BATTERY_PLUGGED_AC -> "cargador"
                    BatteryManager.BATTERY_PLUGGED_USB -> "usb"
                    BatteryManager.BATTERY_PLUGGED_WIRELESS -> "inalámbrica"
                    else -> "desenchufada"
                }
            }
        }

        safe {
            val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
            val caps = cm.activeNetwork?.let { cm.getNetworkCapabilities(it) }
            d["network"] = when {
                caps == null -> "sin red"
                caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> "wifi"
                caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> "datos móviles"
                caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) -> "ethernet"
                else -> "otra"
            }
            if (caps != null) {
                d["internet"] = caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
                d["downKbps"] = caps.linkDownstreamBandwidthKbps
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    d["signalDbm"] = caps.signalStrength.takeIf { it != Int.MIN_VALUE }
                }
            }
        }

        safe {
            val pm = context.getSystemService(Context.POWER_SERVICE) as PowerManager
            d["screenOn"] = pm.isInteractive
            d["powerSave"] = pm.isPowerSaveMode
        }
        safe { d["deviceOwner"] = KioskManager.isDeviceOwner(context) }
        return d
    }

    private const val MB = 1024L * 1024L

    private fun dirSize(f: File): Long =
        if (!f.exists()) 0L else if (f.isFile) f.length() else (f.listFiles() ?: emptyArray()).sumOf { dirSize(it) }

    private inline fun safe(block: () -> Unit) {
        try { block() } catch (_: Throwable) { }
    }
}
