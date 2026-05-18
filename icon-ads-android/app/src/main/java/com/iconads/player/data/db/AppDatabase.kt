package com.iconads.player.data.db

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import com.iconads.player.data.db.dao.MetricDao
import com.iconads.player.data.db.entity.MetricEntity

@Database(entities = [MetricEntity::class], version = 1, exportSchema = false)
abstract class AppDatabase : RoomDatabase() {

    abstract fun metricDao(): MetricDao

    companion object {
        @Volatile private var INSTANCE: AppDatabase? = null

        fun getInstance(context: Context): AppDatabase =
            INSTANCE ?: synchronized(this) {
                INSTANCE ?: Room.databaseBuilder(
                    context.applicationContext,
                    AppDatabase::class.java,
                    "iconads.db",
                ).build().also { INSTANCE = it }
            }
    }
}
