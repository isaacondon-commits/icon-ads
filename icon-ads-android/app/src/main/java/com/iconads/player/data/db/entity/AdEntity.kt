package com.iconads.player.data.db.entity

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "ads")
data class AdEntity(
    @PrimaryKey val id: Int,
    val name: String,
    val type: String,          // "video" | "image"
    val filename: String,
    val localPath: String,
    val durationS: Int,
    val sortOrder: Int,
    val campaignId: Int,
    val playlistVersion: Int,
    val level: Int,            // 1=current, 2=backup, 3=institutional
)
