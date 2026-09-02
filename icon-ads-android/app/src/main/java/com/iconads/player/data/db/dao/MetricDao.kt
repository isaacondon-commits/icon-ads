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

    @Query("SELECT * FROM metrics ORDER BY id ASC LIMIT :limit")
    fun getBatch(limit: Int): List<MetricEntity>

    @Query("SELECT COUNT(*) FROM metrics")
    fun count(): Int

    // ids acotado a <=500 por el que llama — SQLite topea en 999 variables.
    @Query("DELETE FROM metrics WHERE id IN (:ids)")
    fun deleteByIds(ids: List<Int>)

    @Query("DELETE FROM metrics WHERE id IN (SELECT id FROM metrics ORDER BY id ASC LIMIT :n)")
    fun deleteOldest(n: Int)

    @Query("DELETE FROM metrics")
    fun deleteAll()
}
