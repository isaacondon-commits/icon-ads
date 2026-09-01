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
import org.json.JSONObject
import java.util.Calendar
import kotlin.math.abs
import kotlin.math.log10

/**
 * Brillo automático hecho por la app.
 *
 * El ROM de estas tablets (Unisoc/Chuwi) no adapta el backlight aunque se ponga
 * SCREEN_BRIGHTNESS_MODE_AUTOMATIC, y NINGUNA tiene sensor de luz. Así que el
 * brillo se maneja por HORARIO SOLAR: cada día se calcula el amanecer y el
 * atardecer reales de Montevideo ([SunCalc]) y el brillo sigue una tabla
 * relativa a esos eventos ([schedule], que llega del panel; si no, la de acá).
 *
 * Se aplica sobre `window.screenBrightness` (0..1) — override por-ventana, no
 * toca el brillo "manual" del sistema. Si en el futuro alguna tablet tuviera
 * sensor de luz, la tabla solar actúa como techo de la curva de lux.
 */
class AdaptiveBrightness(activity: Activity) : SensorEventListener {

    data class SchedulePoint(val ref: String, val offsetMin: Int, val pct: Int)

    private val sm = activity.getSystemService(SensorManager::class.java)
    private val lightSensor: Sensor? = sm?.getDefaultSensor(Sensor.TYPE_LIGHT)
    private val mainHandler = Handler(Looper.getMainLooper())

    val hasSensor: Boolean get() = lightSensor != null

    var lastLux: Float? = null
        private set

    /** Fracción de brillo (0..1) que la app está aplicando ahora mismo. */
    var currentFraction: Float = 0.6f
        private set

    private var window: Window? = null
    private var running = false
    private var smoothedLux = -1f
    private var applied = -1f

    private var schedule: List<SchedulePoint> = DEFAULT_SCHEDULE
    private var sunCacheDay = -1
    private var sunriseMin = 6 * 60
    private var sunsetMin = 19 * 60

    // (lux, fracción) — interpolado en log10(lux). Sólo se usa si hay sensor.
    private val curve = listOf(
        1f to 0.05f, 30f to 0.18f, 120f to 0.33f, 400f to 0.50f,
        1500f to 0.72f, 6000f to 0.90f, 25000f to 1.00f,
    )

    /** Carga la tabla de brillo (JSON del backend). Si es inválida, se ignora. */
    fun applySchedule(json: String?) {
        if (json.isNullOrBlank()) return
        try {
            val arr = JSONObject(json).getJSONArray("points")
            val pts = ArrayList<SchedulePoint>(arr.length())
            for (i in 0 until arr.length()) {
                val o = arr.getJSONObject(i)
                val ref = if (o.getString("ref") == "sunset") "sunset" else "sunrise"
                pts.add(SchedulePoint(ref, o.getInt("offsetMin"), o.getInt("pct").coerceIn(0, 100)))
            }
            if (pts.size >= 2) {
                schedule = pts
                Log.i(TAG, "tabla de brillo actualizada (${pts.size} puntos)")
                if (running) applyNow()
            }
        } catch (e: Exception) {
            Log.w(TAG, "applySchedule: JSON inválido — ${e.message}")
        }
    }

    fun enable(w: Window) {
        window = w
        if (running) { applyNow(); return }
        running = true
        if (lightSensor != null) {
            sm?.registerListener(this, lightSensor, SensorManager.SENSOR_DELAY_NORMAL, mainHandler)
        } else {
            Log.w(TAG, "sin sensor de luz — brillo por horario solar")
        }
        mainHandler.postDelayed(ticker, TICK_MS)
        Log.i(TAG, "brillo automático ON")
        applyNow()
    }

    fun resume(w: Window) = enable(w)

    fun pause() {
        if (!running) return
        running = false
        sm?.unregisterListener(this)
        mainHandler.removeCallbacks(slew)
        mainHandler.removeCallbacks(ticker)
    }

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
        val scheduled = scheduledFraction()
        val target = when {
            !hasSensor -> scheduled
            smoothedLux < 0f -> currentFraction.coerceAtMost(scheduled)
            else -> fractionFor(smoothedLux).coerceAtMost(scheduled)
        }
        val step = 0.06f // ramp suave para que no parpadee
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

    // Brillo (0..1) según la tabla solar para el momento actual.
    private fun scheduledFraction(): Float {
        val cal = Calendar.getInstance()
        val doy = cal.get(Calendar.DAY_OF_YEAR)
        if (doy != sunCacheDay) {
            SunCalc.sunriseSunsetMinutes(cal)?.let { (r, s) ->
                sunriseMin = r; sunsetMin = s
                Log.i(TAG, "hoy: amanecer ${fmt(r)} · atardecer ${fmt(s)}")
            }
            sunCacheDay = doy
        }
        val nowMin = cal.get(Calendar.HOUR_OF_DAY) * 60 + cal.get(Calendar.MINUTE)
        val pts = schedule
            .map { (if (it.ref == "sunset") sunsetMin else sunriseMin) + it.offsetMin to it.pct / 100f }
            .sortedBy { it.first }
        if (pts.isEmpty()) return currentFraction
        if (nowMin <= pts.first().first) return pts.first().second
        if (nowMin >= pts.last().first) return pts.last().second
        for (i in 0 until pts.size - 1) {
            val (t0, v0) = pts[i]
            val (t1, v1) = pts[i + 1]
            if (nowMin in t0..t1) {
                if (t1 == t0) return v1
                val f = (nowMin - t0).toFloat() / (t1 - t0)
                return v0 + f * (v1 - v0)
            }
        }
        return pts.last().second
    }

    private fun fmt(min: Int) = "%02d:%02d".format(min / 60, min % 60)

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
        private const val TICK_MS = 60_000L // recalcular la tabla 1 vez por minuto

        // Tabla por defecto (misma que el backend): relativa al amanecer/atardecer.
        val DEFAULT_SCHEDULE = listOf(
            SchedulePoint("sunrise", -120, 25),
            SchedulePoint("sunrise", 0, 55),
            SchedulePoint("sunrise", 120, 90),
            SchedulePoint("sunset", -120, 90),
            SchedulePoint("sunset", 0, 55),
            SchedulePoint("sunset", 120, 25),
        )
    }
}
