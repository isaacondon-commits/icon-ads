package com.iconads.player.data.model

import com.google.gson.annotations.SerializedName

data class PlaylistJson(
    val version: Int,
    val hash: String,
    val generatedAt: String,
    val ads: List<AdJson>,
)

data class AdJson(
    val id: Int,
    val name: String,
    val type: String,
    val filename: String,
    @SerializedName("duration_s") val durationS: Int,
    val order: Int,
    val campaignId: Int,
)
