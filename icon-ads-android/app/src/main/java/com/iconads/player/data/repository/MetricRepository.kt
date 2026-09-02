package com.iconads.player.data.repository

import android.content.Context
import com.iconads.player.data.api.NetworkModule
import com.iconads.player.data.model.MetricRecord
import com.iconads.player.data.model.MetricUpload
import com.iconads.player.data.storage.MetricStorage
import com.iconads.player.util.DevicePrefs
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.time.Instant
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter

class MetricRepository(context: Context) {

    private val storage = MetricStorage(context)
    private val prefs = DevicePrefs(context)

    fun record(
        adId: Int,
        campaignId: Int,
        playedAt: Long,
        durationPlayedS: Int,
        completed: Boolean,
        error: Boolean = false,
    ) {
        storage.append(
            MetricRecord(
                adId = adId,
                campaignId = campaignId,
                playedAt = playedAt,
                durationPlayedS = durationPlayedS,
                completed = completed,
                error = error,
            )
        )
    }

    suspend fun uploadPending(): Int = uploadLock.withLock {
        val token = prefs.getToken() ?: return@withLock 0
        val api = NetworkModule.provideDeviceApi(token)

        // De a SLICE: acota el POST y, sobre todo, el DELETE ... IN (SQLite
        // topea en 999 variables — un backlog grande hacía explotar deleteByIds
        // y la cola quedaba trabada para siempre: la tablet reproducía pero no
        // registraba nada). Se borra cada slice recién cuando su POST confirma.
        var uploaded = 0
        repeat(MAX_SLICES_PER_RUN) {
            val slice = storage.readBatch(SLICE)
            if (slice.isEmpty()) return@withLock uploaded

            val payload = slice.map { m ->
                MetricUpload(
                    adId = m.adId,
                    campaignId = m.campaignId,
                    playedAt = Instant.ofEpochMilli(m.playedAt)
                        .atOffset(ZoneOffset.UTC)
                        .format(DateTimeFormatter.ISO_OFFSET_DATE_TIME),
                    durationPlayedS = m.durationPlayedS,
                    completed = m.completed,
                    error = m.error,
                )
            }
            api.uploadMetrics(payload)                 // throws -> corta, se reintenta luego
            storage.deleteByIds(slice.map { it.id })
            uploaded += slice.size
        }
        // Si quedó backlog enorme tras el tope de slices, recortar lo más viejo.
        storage.trimTo(MAX_QUEUE)
        uploaded
    }

    companion object {
        private const val SLICE = 400
        private const val MAX_SLICES_PER_RUN = 40      // hasta 16k por corrida
        private const val MAX_QUEUE = 20000
        // Proceso-wide: evita que dos subidas concurrentes lean el mismo lote.
        private val uploadLock = Mutex()
    }
}
