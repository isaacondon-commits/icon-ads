package com.iconads.player

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Build
import android.os.IBinder
import android.os.Looper
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.iconads.player.data.api.NetworkModule
import com.iconads.player.data.model.LocationUpload
import com.iconads.player.util.DevicePrefs
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import java.time.Instant

class LocationService : Service() {

    private lateinit var locationManager: LocationManager
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private val prefs by lazy { DevicePrefs(this) }

    private val locationListener = LocationListener { loc ->
        scope.launch { uploadLocation(loc) }
    }

    override fun onCreate() {
        super.onCreate()
        locationManager = getSystemService(LOCATION_SERVICE) as LocationManager
        startForeground(NOTIF_ID, buildNotification())
        requestUpdates()
    }

    private fun requestUpdates() {
        val hasCoarse = ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED
        val hasFine = ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
        if (!hasCoarse && !hasFine) {
            Log.w(TAG, "Sin permiso de ubicación — servicio en espera")
            return
        }
        try {
            // GPS (alta precisión)
            if (hasFine && locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
                locationManager.requestLocationUpdates(
                    LocationManager.GPS_PROVIDER,
                    INTERVAL_MS, MIN_DIST_M,
                    locationListener, Looper.getMainLooper()
                )
                Log.i(TAG, "GPS provider registrado")
            }
            // Red/WiFi (fallback)
            if (locationManager.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) {
                locationManager.requestLocationUpdates(
                    LocationManager.NETWORK_PROVIDER,
                    INTERVAL_MS, MIN_DIST_M,
                    locationListener, Looper.getMainLooper()
                )
                Log.i(TAG, "Network provider registrado")
            }
        } catch (e: SecurityException) {
            Log.w(TAG, "SecurityException al solicitar ubicación: ${e.message}")
        }
    }

    private suspend fun uploadLocation(loc: Location) {
        val token = prefs.getToken() ?: return
        try {
            NetworkModule.provideDeviceApi(token).uploadLocation(
                LocationUpload(
                    lat = loc.latitude,
                    lng = loc.longitude,
                    accuracy = if (loc.hasAccuracy()) loc.accuracy else null,
                    timestamp = Instant.ofEpochMilli(loc.time).toString(),
                )
            )
            Log.d(TAG, "GPS enviado: ${loc.latitude},${loc.longitude} acc=${loc.accuracy}m prv=${loc.provider}")
        } catch (e: Exception) {
            Log.w(TAG, "uploadLocation falló: ${e.javaClass.simpleName}: ${e.message}")
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        try { locationManager.removeUpdates(locationListener) } catch (_: Exception) {}
        scope.cancel()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun buildNotification(): Notification {
        val channelId = "iconads_location"
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                channelId, "Ubicación GPS",
                NotificationManager.IMPORTANCE_LOW
            ).apply { setShowBadge(false) }
            getSystemService(NotificationManager::class.java)?.createNotificationChannel(channel)
        }
        return NotificationCompat.Builder(this, channelId)
            .setContentTitle("ICON ADS")
            .setContentText("Rastreo GPS activo")
            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setOngoing(true)
            .build()
    }

    companion object {
        private const val TAG = "LocationService"
        private const val NOTIF_ID = 42
        private const val INTERVAL_MS = 60_000L   // 1 minuto
        private const val MIN_DIST_M = 0f

        fun start(context: Context) {
            val intent = Intent(context, LocationService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, LocationService::class.java))
        }
    }
}
