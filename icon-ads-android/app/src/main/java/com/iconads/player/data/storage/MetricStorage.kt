package com.iconads.player.data.storage

import android.content.Context
import com.iconads.player.data.db.AppDatabase
import com.iconads.player.data.db.entity.MetricEntity
import com.iconads.player.data.model.MetricRecord

// NOTA: la subida trabaja con MetricEntity (trae el id) y borra sólo las filas
// efectivamente subidas — usar clear() borraría también lo que se grabó
// mientras la subida estaba en vuelo.

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

    fun readEntities(): List<MetricEntity> = dao.getAll()

    fun readBatch(limit: Int): List<MetricEntity> = dao.getBatch(limit)

    fun count(): Int = dao.count()

    fun deleteByIds(ids: List<Int>) {
        if (ids.isNotEmpty()) dao.deleteByIds(ids)
    }

    // Descarta las más viejas si la cola se descontroló (subida caída mucho
    // tiempo). Evita que el archivo crezca sin límite.
    fun trimTo(max: Int) {
        val n = dao.count() - max
        if (n > 0) dao.deleteOldest(n)
    }

    fun clear() {
        dao.deleteAll()
    }
}
