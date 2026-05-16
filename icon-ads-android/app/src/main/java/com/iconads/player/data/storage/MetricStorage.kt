package com.iconads.player.data.storage

import android.content.Context
import android.util.Log
import com.google.gson.Gson
import com.iconads.player.data.model.MetricRecord
import java.io.File

class MetricStorage(context: Context) {

    private val file = File(context.filesDir, "metrics_pending.json")
    private val gson = Gson()

    @Synchronized
    fun append(metric: MetricRecord) {
        val list = readAll().toMutableList()
        list.add(metric)
        try {
            file.writeText(gson.toJson(list))
        } catch (e: Exception) {
            Log.e(TAG, "Error guardando métrica", e)
        }
    }

    @Synchronized
    fun readAll(): List<MetricRecord> {
        if (!file.exists() || file.length() == 0L) return emptyList()
        return try {
            gson.fromJson(file.readText(), Array<MetricRecord>::class.java).toList()
        } catch (e: Exception) {
            Log.e(TAG, "Error leyendo métricas, descartando", e)
            emptyList()
        }
    }

    @Synchronized
    fun clear() {
        file.delete()
    }

    companion object {
        private const val TAG = "MetricStorage"
    }
}
