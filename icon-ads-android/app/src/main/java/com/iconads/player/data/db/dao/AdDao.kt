package com.iconads.player.data.db.dao

import androidx.room.*
import com.iconads.player.data.db.entity.AdEntity

@Dao
interface AdDao {

    @Query("SELECT * FROM ads WHERE level = :level ORDER BY sortOrder ASC")
    suspend fun getByLevel(level: Int): List<AdEntity>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertAll(ads: List<AdEntity>)

    @Query("DELETE FROM ads WHERE level = :level")
    suspend fun deleteByLevel(level: Int)

    @Transaction
    suspend fun replaceLevel(level: Int, ads: List<AdEntity>) {
        deleteByLevel(level)
        if (ads.isNotEmpty()) insertAll(ads)
    }
}
