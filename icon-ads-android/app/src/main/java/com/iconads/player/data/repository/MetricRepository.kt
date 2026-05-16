package com.iconads.player.data.repository

import android.content.Context
import com.iconads.player.data.api.NetworkModule
import com.iconads.player.data.model.MetricRecord
import com.iconads.player.data.model.MetricUpload
import com.iconads.player.data.storage.MetricStorage
import com.iconads.player.util.DevicePrefs
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

    suspend fun uploadPending(): Int {
        val token = prefs.getToken() ?: return 0
        val pending = storage.readAll()
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
        storage.clear()
        return pending.size
    }
}
