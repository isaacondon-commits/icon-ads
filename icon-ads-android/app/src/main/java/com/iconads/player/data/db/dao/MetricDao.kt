package com.iconads.player.data.db.dao

import androidx.room.*
import com.iconads.player.data.db.entity.MetricEntity

@Dao
interface MetricDao {

    @Insert
    suspend fun insert(metric: MetricEntity)

    @Query("SELECT * FROM metrics WHERE uploaded = 0 LIMIT 200")
    suspend fun getPending(): List<MetricEntity>

    @Query("UPDATE metrics SET uploaded = 1 WHERE id IN (:ids)")
    suspend fun markUploaded(ids: List<Long>)

    @Query("DELETE FROM metrics WHERE uploaded = 1 AND playedAt < :beforeEpoch")
    suspend fun deleteOldUploaded(beforeEpoch: Long)
}
