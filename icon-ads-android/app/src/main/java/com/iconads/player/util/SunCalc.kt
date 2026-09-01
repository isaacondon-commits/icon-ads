package com.iconads.player.util

import java.util.Calendar
import kotlin.math.abs
import kotlin.math.acos
import kotlin.math.asin
import kotlin.math.atan
import kotlin.math.cos
import kotlin.math.floor
import kotlin.math.sin
import kotlin.math.tan

/**
 * Amanecer / atardecer para una fecha y ubicación, con el algoritmo clásico del
 * Almanac (US Naval Observatory). Precisión ~1 min, suficiente para el brillo.
 *
 * Devuelve minutos desde la medianoche local. No hay librería: son ~30 líneas de
 * trigonometría.
 */
object SunCalc {

    // Montevideo. Sin horario de verano desde 2015, así que el offset es fijo.
    const val MONTEVIDEO_LAT = -34.9011
    const val MONTEVIDEO_LNG = -56.1645
    const val MONTEVIDEO_TZ_HOURS = -3.0

    private const val ZENITH = 90.833 // oficial (incluye refracción atmosférica)

    /** Pair(amanecerMin, atardecerMin) o null si el sol no sale/se pone ese día. */
    fun sunriseSunsetMinutes(
        cal: Calendar,
        latDeg: Double = MONTEVIDEO_LAT,
        lngDeg: Double = MONTEVIDEO_LNG,
        tzHours: Double = MONTEVIDEO_TZ_HOURS,
    ): Pair<Int, Int>? {
        val n = cal.get(Calendar.DAY_OF_YEAR)
        val rise = event(n, latDeg, lngDeg, tzHours, rising = true) ?: return null
        val set = event(n, latDeg, lngDeg, tzHours, rising = false) ?: return null
        return rise to set
    }

    private fun event(n: Int, lat: Double, lng: Double, tz: Double, rising: Boolean): Int? {
        val lngHour = lng / 15.0
        val t = if (rising) n + ((6.0 - lngHour) / 24.0) else n + ((18.0 - lngHour) / 24.0)

        val m = (0.9856 * t) - 3.289
        var l = m + (1.916 * sin(Math.toRadians(m))) + (0.020 * sin(Math.toRadians(2 * m))) + 282.634
        l = norm(l, 360.0)

        var ra = Math.toDegrees(atan(0.91764 * tan(Math.toRadians(l))))
        ra = norm(ra, 360.0)
        // Poner RA en el mismo cuadrante que L.
        ra += (floor(l / 90.0) * 90.0) - (floor(ra / 90.0) * 90.0)
        ra /= 15.0

        val sinDec = 0.39782 * sin(Math.toRadians(l))
        val cosDec = cos(asin(sinDec))
        val cosH = (cos(Math.toRadians(ZENITH)) - (sinDec * sin(Math.toRadians(lat)))) /
            (cosDec * cos(Math.toRadians(lat)))
        if (abs(cosH) > 1.0) return null

        var h = if (rising) 360.0 - Math.toDegrees(acos(cosH)) else Math.toDegrees(acos(cosH))
        h /= 15.0

        val meanT = h + ra - (0.06571 * t) - 6.622
        val ut = norm(meanT - lngHour, 24.0)
        val localT = norm(ut + tz, 24.0)
        return Math.round(localT * 60.0).toInt().coerceIn(0, 1439)
    }

    private fun norm(x: Double, max: Double): Double {
        var v = x % max
        if (v < 0) v += max
        return v
    }
}
