package com.iconads.player.data.repository

import android.content.Context
import com.iconads.player.data.api.NetworkModule
import com.iconads.player.data.db.AppDatabase
import com.iconads.player.data.db.entity.MetricEntity
import com.iconads.player.data.model.MetricUpload
import com.iconads.player.util.DevicePrefs
import java.time.Instant
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.util.concurrent.TimeUnit

class MetricRepository(private val context: Context) {

    private val db = AppDatabase.get(context)
    private val prefs = DevicePrefs(context)

    suspend fun record(
        adId: Int,
        campaignId: Int,
        playedAt: Long,
        durationPlayedS: Int,
        completed: Boolean,
        error: Boolean = false,
    ) {
        db.metricDao().insert(
            MetricEntity(
                adId = adId,
                campaignId = campaignId,
                playedAt = playedAt,
                durationPlayedS = durationPlayedS,
                completed = completed,
                error = error,
            )
        )
    }

    suspend fun uploadPending(): Int {
        val token = prefs.getToken() ?: return 0
        val pending = db.metricDao().getPending()
        if (pending.isEmpty()) return 0

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
        db.metricDao().markUploaded(pending.map { it.id })

        // Limpiar métricas viejas ya subidas (>30 días)
        val cutoff = System.currentTimeMillis() - TimeUnit.DAYS.toMillis(30)
        db.metricDao().deleteOldUploaded(cutoff)

        return pending.size
    }
}
