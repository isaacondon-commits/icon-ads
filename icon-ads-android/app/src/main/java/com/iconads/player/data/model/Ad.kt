package com.iconads.player.data.model

data class Ad(
    val id: Int,
    val name: String,
    val type: String,       // "video" | "image"
    val filename: String,
    val localPath: String,
    val durationS: Int,
    val sortOrder: Int,
    val campaignId: Int,
    val playlistVersion: Int,
    val level: Int,         // 1=current, 2=backup, 3=institutional
)
