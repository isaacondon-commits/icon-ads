package com.iconads.player.data.db.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.Query
import com.iconads.player.data.db.entity.MetricEntity

@Dao
interface MetricDao {
    @Insert
    fun insert(metric: MetricEntity)

    @Query("SELECT * FROM metrics ORDER BY id ASC")
    fun getAll(): List<MetricEntity>

    @Query("DELETE FROM metrics")
    fun deleteAll()
}
