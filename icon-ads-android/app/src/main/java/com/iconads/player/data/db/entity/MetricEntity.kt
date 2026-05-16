package com.iconads.player.data.db.entity

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "metrics")
data class MetricEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val adId: Int,
    val campaignId: Int,
    val playedAt: Long,         // epoch millis
    val durationPlayedS: Int,
    val completed: Boolean,
    val error: Boolean = false,
    val uploaded: Boolean = false,
)
