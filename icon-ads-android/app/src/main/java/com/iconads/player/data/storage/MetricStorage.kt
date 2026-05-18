package com.iconads.player.data.storage

import android.content.Context
import com.iconads.player.data.db.AppDatabase
import com.iconads.player.data.db.entity.MetricEntity
import com.iconads.player.data.model.MetricRecord

class MetricStorage(context: Context) {

    private val dao = AppDatabase.getInstance(context).metricDao()

    fun append(metric: MetricRecord) {
        dao.insert(
            MetricEntity(
                adId = metric.adId,
                campaignId = metric.campaignId,
                playedAt = metric.playedAt,
                durationPlayedS = metric.durationPlayedS,
                completed = metric.completed,
                error = metric.error,
            )
        )
    }

    fun readAll(): List<MetricRecord> =
        dao.getAll().map { e ->
            MetricRecord(
                adId = e.adId,
                campaignId = e.campaignId,
                playedAt = e.playedAt,
                durationPlayedS = e.durationPlayedS,
                completed = e.completed,
                error = e.error,
            )
        }

    fun clear() {
        dao.deleteAll()
    }
}
