package com.iconads.player.power

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.hardware.TriggerEvent
import android.hardware.TriggerEventListener
import android.os.BatteryManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.iconads.player.PlayerActivity
import com.iconads.player.R
import com.iconads.player.kiosk.KioskManager
import kotlin.math.abs
import kotlin.math.sqrt

/**
 * Servicio en primer plano que corre siempre. Maneja el ciclo de vida de la
 * app en función de la alimentación del taxi y del movimiento:
 *
 *  - Llega corriente (auto en contacto)  -> abre el player, aunque la tablet
 *    esté bloqueada.
 *  - Se corta la corriente (auto apagado) -> cierra el player y bloquea la
 *    tablet (con debounce, porque al arrancar el motor la tensión cae un
 *    instante).
 *  - 10 min sin movimiento con corriente  -> cierra el player y bloquea; se
 *    reabre solo cuando el auto vuelve a moverse (sensor de movimiento
 *    significativo).
 *
 * El apagado/bloqueo real de pantalla necesita que la app sea Device Owner
 * (ver [KioskManager]). Sin eso, "cerrar" = pausar y oscurecer la pantalla.
 */
class PowerController : Service() {

    private val handler = Handler(Looper.getMainLooper())
    private lateinit var sensorManager: SensorManager
    private var accel: Sensor? = null
    private var sigMotion: Sensor? = null

    private var lastMotionMs = System.currentTimeMillis()
    private var lastAccelMag = SensorManager.GRAVITY_EARTH
    private var appClosed = false
    private var pendingPowerOff: Runnable? = null

    private val powerReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            when (intent.action) {
                Intent.ACTION_POWER_CONNECTED -> onPowerConnected()
                Intent.ACTION_POWER_DISCONNECTED -> onPowerDisconnected()
            }
        }
    }

    private val accelListener = object : SensorEventListener {
        override fun onSensorChanged(e: SensorEvent) {
            val mag = sqrt(
                e.values[0] * e.values[0] + e.values[1] * e.values[1] + e.values[2] * e.values[2]
            )
            if (abs(mag - lastAccelMag) > MOTION_DELTA) {
                lastMotionMs = System.currentTimeMillis()
            }
            lastAccelMag = mag
        }

        override fun onAccuracyChanged(s: Sensor, a: Int) {}
    }

    private val sigMotionListener = object : TriggerEventListener() {
        override fun onTrigger(event: TriggerEvent) {
            Log.i(TAG, "Movimiento significativo detectado")
            if (isPlugged()) {
                openApp()
            } else {
                // Se movió pero el auto sigue apagado — nadie puede usar la
                // tablet: seguimos bloqueados y re-armamos el disparador.
                armSignificantMotion()
            }
        }
    }

    private val stillnessCheck = object : Runnable {
        override fun run() {
            if (!appClosed && isPlugged() &&
                System.currentTimeMillis() - lastMotionMs > STILLNESS_TIMEOUT_MS
            ) {
                Log.i(TAG, "10 min sin movimiento — cerrando app")
                closeApp(byStillness = true)
            }
            handler.postDelayed(this, STILLNESS_POLL_MS)
        }
    }

    override fun onCreate() {
        super.onCreate()
        startForeground(NOTIF_ID, buildNotification())
        sensorManager = getSystemService(SENSOR_SERVICE) as SensorManager
        accel = sensorManager.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)
        sigMotion = sensorManager.getDefaultSensor(Sensor.TYPE_SIGNIFICANT_MOTION)

        ContextCompat.registerReceiver(
            this,
            powerReceiver,
            IntentFilter().apply {
                addAction(Intent.ACTION_POWER_CONNECTED)
                addAction(Intent.ACTION_POWER_DISCONNECTED)
            },
            ContextCompat.RECEIVER_NOT_EXPORTED,
        )

        KioskManager.applyPolicies(this)

        // Estado inicial al arrancar (boot / actualización de la app).
        if (isPlugged()) onPowerConnected() else closeApp(byStillness = false)

        handler.postDelayed(stillnessCheck, STILLNESS_POLL_MS)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int = START_STICKY

    override fun onDestroy() {
        super.onDestroy()
        handler.removeCallbacksAndMessages(null)
        try { unregisterReceiver(powerReceiver) } catch (_: Exception) {}
        try { sensorManager.unregisterListener(accelListener) } catch (_: Exception) {}
    }

    override fun onBind(intent: Intent?): IBinder? = null

    // ── Corriente ────────────────────────────────────────────────────────────

    private fun onPowerConnected() {
        Log.i(TAG, "Corriente conectada — auto en contacto")
        pendingPowerOff?.let { handler.removeCallbacks(it) }
        pendingPowerOff = null
        openApp()
    }

    private fun onPowerDisconnected() {
        Log.i(TAG, "Corriente desconectada — esperando confirmación (${POWER_OFF_DEBOUNCE_MS}ms)")
        pendingPowerOff?.let { handler.removeCallbacks(it) }
        val r = Runnable {
            if (!isPlugged()) {
                Log.i(TAG, "Sin corriente confirmado — cerrando app")
                closeApp(byStillness = false)
            } else {
                Log.i(TAG, "Falsa alarma (arranque de motor) — se mantiene la app")
            }
        }
        pendingPowerOff = r
        handler.postDelayed(r, POWER_OFF_DEBOUNCE_MS)
    }

    // ── Abrir / cerrar player ────────────────────────────────────────────────

    private fun openApp() {
        appClosed = false
        lastMotionMs = System.currentTimeMillis()
        lastAccelMag = SensorManager.GRAVITY_EARTH
        try { sensorManager.unregisterListener(accelListener) } catch (_: Exception) {}
        accel?.let {
            sensorManager.registerListener(accelListener, it, SensorManager.SENSOR_DELAY_NORMAL)
        }
        forceScreenOn()
        startActivity(
            Intent(this, PlayerActivity::class.java).addFlags(
                Intent.FLAG_ACTIVITY_NEW_TASK or
                    Intent.FLAG_ACTIVITY_REORDER_TO_FRONT or
                    Intent.FLAG_ACTIVITY_SINGLE_TOP
            )
        )
    }

    // Con el equipo en Doze y pantalla apagada (tras lockNow), startActivity +
    // setTurnScreenOn no encienden la pantalla: la ventana nunca llega a
    // "visible" y FLAG_KEEP_SCREEN_ON queda inerte, así que se vuelve a dormir
    // a los ~10 s. Un wake lock con ACQUIRE_CAUSES_WAKEUP fuerza el encendido;
    // se suelta solo a los 5 s, para entonces la Activity ya está al frente y
    // sostiene la pantalla con su propio FLAG_KEEP_SCREEN_ON.
    private fun forceScreenOn() {
        try {
            val pm = getSystemService(POWER_SERVICE) as android.os.PowerManager
            @Suppress("DEPRECATION")
            pm.newWakeLock(
                android.os.PowerManager.SCREEN_BRIGHT_WAKE_LOCK or
                    android.os.PowerManager.ACQUIRE_CAUSES_WAKEUP or
                    android.os.PowerManager.ON_AFTER_RELEASE,
                "iconads:poweron",
            ).apply { acquire(10_000L) }
        } catch (e: Exception) {
            Log.w(TAG, "forceScreenOn: ${e.message}")
        }
    }

    private fun closeApp(byStillness: Boolean) {
        appClosed = true
        try { sensorManager.unregisterListener(accelListener) } catch (_: Exception) {}
        sendBroadcast(Intent(ACTION_CLOSE_APP).setPackage(packageName))
        KioskManager.lockDown(this)
        // Sólo re-abrimos por movimiento si el auto sigue dando corriente.
        // Si se cerró por falta de corriente, sólo la corriente lo reabre.
        if (byStillness) armSignificantMotion()
    }

    private fun armSignificantMotion() {
        sigMotion?.let { sensorManager.requestTriggerSensor(sigMotionListener, it) }
    }

    // ── Utilidades ───────────────────────────────────────────────────────────

    private fun isPlugged(): Boolean {
        val i = registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED)) ?: return false
        return i.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0) != 0
    }

    private fun buildNotification(): Notification {
        val channelId = "iconads_power"
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                channelId, "Control de encendido",
                NotificationManager.IMPORTANCE_MIN,
            ).apply { setShowBadge(false) }
            getSystemService(NotificationManager::class.java)?.createNotificationChannel(channel)
        }
        return NotificationCompat.Builder(this, channelId)
            .setContentTitle("ICON ADS")
            .setContentText("Servicio activo")
            .setSmallIcon(R.mipmap.ic_launcher)
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .setOngoing(true)
            .build()
    }

    companion object {
        private const val TAG = "PowerController"
        private const val NOTIF_ID = 43

        /** Colchón para el bajón de tensión al arrancar el motor. */
        private const val POWER_OFF_DEBOUNCE_MS = 4_000L

        /** Sin movimiento por este tiempo (con corriente) -> se cierra la app. */
        private const val STILLNESS_TIMEOUT_MS = 10 * 60_000L
        private const val STILLNESS_POLL_MS = 30_000L

        /** Delta de aceleración (m/s^2) que cuenta como "el auto se movió". */
        private const val MOTION_DELTA = 0.8f

        const val ACTION_CLOSE_APP = "com.iconads.player.CLOSE_APP"

        fun start(context: Context) {
            val i = Intent(context, PowerController::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(i)
            } else {
                context.startService(i)
            }
        }
    }
}
