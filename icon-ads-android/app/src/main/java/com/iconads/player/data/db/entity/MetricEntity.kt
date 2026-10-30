package com.iconads.player.data.db.entity

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "metrics")
data class MetricEntity(
    @PrimaryKey(autoGenerate = true) val id: Int = 0,
    val adId: Int,
    // Ya no se usa (el server saca la empresa del anuncio). Queda la columna
    // para no migrar la base local de las tablets.
    val campaignId: Int = 0,
    val playedAt: Long,
    val durationPlayedS: Int,
    val completed: Boolean,
    val error: Boolean,
)
