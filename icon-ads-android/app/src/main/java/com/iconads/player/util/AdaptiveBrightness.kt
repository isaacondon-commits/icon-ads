package com.iconads.player.util

import android.app.Activity
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.Window
import android.view.WindowManager
import java.util.Calendar
import kotlin.math.abs
import kotlin.math.log10

/**
 * Brillo automático hecho por la app.
 *
 * El ROM de estas tablets (Unisoc/Chuwi) no adapta el backlight solo aunque se
 * ponga SCREEN_BRIGHTNESS_MODE_AUTOMATIC — el brillo queda clavado. Acá leemos
 * el sensor de luz ambiente y ajustamos `window.screenBrightness` (0..1), que es
 * un override por-ventana y NO toca el brillo "manual" del sistema.
 *
 * Si la tablet no tiene sensor de luz (todas las de la flota, hoy), no hay con
 * qué adaptar de día — se deja al máximo. Lo único que sí se puede hacer sin
 * sensor es atenuar por horario: después del anochecer baja a NIGHT_LEVEL, de
 * día vuelve al máximo. Con sensor, ese mismo horario actúa como techo (por si
 * una luz cercana da una lectura alta de noche).
 */
class AdaptiveBrightness(activity: Activity) : SensorEventListener {

    private val sm = activity.getSystemService(SensorManager::class.java)
    private val lightSensor: Sensor? = sm?.getDefaultSensor(Sensor.TYPE_LIGHT)
    private val mainHandler = Handler(Looper.getMainLooper())

    val hasSensor: Boolean get() = lightSensor != null

    /** Último valor crudo del sensor (lux). null si no hay sensor o aún no llegó ninguna lectura. */
    var lastLux: Float? = null
        private set

    /** Fracción de brillo (0..1) que la app está aplicando ahora mismo. */
    var currentFraction: Float = 0.6f
        private set

    private var window: Window? = null
    private var running = false
    private var smoothedLux = -1f
    private var applied = -1f

    // (lux, fracción). Se interpola en log10(lux) para que el ojo lo sienta lineal.
    private val curve = listOf(
        1f to 0.05f,       // noche cerrada
        30f to 0.18f,      // interior tenue
        120f to 0.33f,     // interior normal
        400f to 0.50f,     // interior luminoso
        1500f to 0.72f,    // día nublado / sombra
        6000f to 0.90f,    // día claro
        25000f to 1.00f,   // sol directo
    )

    fun enable(w: Window) {
        window = w
        if (running) { applyNow(); return }
        running = true
        if (lightSensor != null) {
            sm?.registerListener(this, lightSensor, SensorManager.SENSOR_DELAY_NORMAL, mainHandler)
        } else {
            Log.w(TAG, "sin sensor de luz — brillo por horario (día=máx, noche=$NIGHT_LEVEL)")
        }
        // Sin sensor no hay eventos que disparen un recálculo: un tick propio
        // (y con sensor, de respaldo) es lo que hace que el atenuado nocturno
        // entre/salga solo al cruzar la hora, sin reiniciar la app.
        mainHandler.postDelayed(ticker, TICK_MS)
        Log.i(TAG, "brillo automático ON")
        applyNow()
    }

    fun resume(w: Window) = enable(w)

    /** Deja de escuchar el sensor pero NO cambia el brillo actual de la ventana. */
    fun pause() {
        if (!running) return
        running = false
        sm?.unregisterListener(this)
        mainHandler.removeCallbacks(slew)
        mainHandler.removeCallbacks(ticker)
    }

    /** Apaga y devuelve el control del brillo al sistema. */
    fun release() {
        pause()
        window?.let { w ->
            w.attributes = w.attributes.apply {
                screenBrightness = WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_NONE
            }
        }
        window = null
        applied = -1f
    }

    override fun onSensorChanged(e: SensorEvent) {
        val lux = e.values.firstOrNull() ?: return
        lastLux = lux
        smoothedLux = if (smoothedLux < 0f) lux else smoothedLux + (lux - smoothedLux) * 0.25f
        applyNow()
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {}

    private val slew = Runnable { if (running) applyNow() }
    private val ticker = object : Runnable {
        override fun run() {
            if (!running) return
            applyNow()
            mainHandler.postDelayed(this, TICK_MS)
        }
    }

    private fun applyNow() {
        val ceiling = nightCeiling()
        val target = when {
            !hasSensor -> ceiling
            smoothedLux < 0f -> currentFraction.coerceAtMost(ceiling)  // sin lectura aún
            else -> fractionFor(smoothedLux).coerceAtMost(ceiling)
        }
        val step = 0.06f  // ramp suave para que no parpadee
        currentFraction = when {
            target > currentFraction -> minOf(target, currentFraction + step)
            target < currentFraction -> maxOf(target, currentFraction - step)
            else -> target
        }
        setWindow(currentFraction, force = false)
        if (running && abs(currentFraction - target) > 0.002f) {
            mainHandler.removeCallbacks(slew)
            mainHandler.postDelayed(slew, 150)
        }
    }

    // Después del anochecer (hoy: horario fijo 20:00–07:00) el brillo no pasa
    // de NIGHT_LEVEL. De día no hay techo (1.0). Sin sensor de luz, ES el
    // brillo aplicado; con sensor, actúa como límite superior de la curva.
    private fun nightCeiling(): Float {
        val hour = Calendar.getInstance().get(Calendar.HOUR_OF_DAY)
        val isNight = if (NIGHT_START_HOUR > NIGHT_END_HOUR) {
            hour >= NIGHT_START_HOUR || hour < NIGHT_END_HOUR
        } else {
            hour in NIGHT_START_HOUR until NIGHT_END_HOUR
        }
        return if (isNight) NIGHT_LEVEL else 1f
    }

    private fun setWindow(frac: Float, force: Boolean) {
        val w = window ?: return
        val f = frac.coerceIn(0.02f, 1f)
        if (!force && abs(f - applied) < 0.006f) return
        applied = f
        w.attributes = w.attributes.apply { screenBrightness = f }
    }

    private fun fractionFor(lux: Float): Float {
        val x = log10(lux.coerceIn(1f, 40000f).toDouble())
        val first = curve.first()
        val last = curve.last()
        if (x <= log10(first.first.toDouble())) return first.second
        if (x >= log10(last.first.toDouble())) return last.second
        for (i in 0 until curve.size - 1) {
            val x0 = log10(curve[i].first.toDouble())
            val x1 = log10(curve[i + 1].first.toDouble())
            if (x in x0..x1) {
                val t = ((x - x0) / (x1 - x0)).toFloat()
                return curve[i].second + t * (curve[i + 1].second - curve[i].second)
            }
        }
        return last.second
    }

    companion object {
        private const val TAG = "AdaptiveBrightness"
        private const val NIGHT_START_HOUR = 20  // 20:00 — a partir de acá, atenuado
        private const val NIGHT_END_HOUR = 7     // 07:00 — a partir de acá, brillo normal
        private const val NIGHT_LEVEL = 0.55f    // techo nocturno (55%)
        private const val TICK_MS = 60_000L      // recalcular horario 1 vez por minuto
    }
}
