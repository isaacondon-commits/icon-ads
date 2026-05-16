package com.iconads.player.data.model

data class MetricRecord(
    val adId: Int,
    val campaignId: Int,
    val playedAt: Long,         // epoch millis
    val durationPlayedS: Int,
    val completed: Boolean,
    val error: Boolean = false,
)
