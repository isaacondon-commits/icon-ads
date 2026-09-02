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
        // Trabajar con entidades (traen el id) y borrar SOLO lo subido: el ciclo
        // periódico y el MetricUploadWorker pueden llamar en paralelo, y si la
        // subida se cae después de que el server insertó, no se borra nada y se
        // reintenta el mismo lote -> el server ahora lo deduplica por clave
        // natural, pero igual no hay que multiplicar el trabajo.
        val pending = storage.readEntities()
        if (pending.isEmpty()) return@withLock 0

        val api = NetworkModule.provideDeviceApi(token)
        val payload = pending.map { m ->
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

        api.uploadMetrics(payload)
        storage.deleteByIds(pending.map { it.id })
        pending.size
    }

    companion object {
        // Proceso-wide: evita que dos subidas concurrentes lean el mismo lote.
        private val uploadLock = Mutex()
    }
}
