package com.iconads.player.work

import android.content.Context
import android.util.Log
import androidx.work.*
import com.iconads.player.data.repository.MetricRepository
import java.util.concurrent.TimeUnit

class MetricUploadWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        return try {
            val uploaded = MetricRepository(applicationContext).uploadPending()
            Log.d(TAG, "Métricas subidas: $uploaded")
            Result.success()
        } catch (e: Exception) {
            Log.w(TAG, "Error subiendo métricas: ${e.message}")
            Result.retry()
        }
    }

    companion object {
        private const val TAG = "MetricUploadWorker"
        private const val WORK_NAME = "iconads_metric_upload"

        fun schedule(context: Context) {
            val constraints = Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .build()

            val request = PeriodicWorkRequestBuilder<MetricUploadWorker>(30, TimeUnit.MINUTES)
                .setConstraints(constraints)
                .setBackoffCriteria(BackoffPolicy.LINEAR, 5, TimeUnit.MINUTES)
                .build()

            WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                WORK_NAME,
                ExistingPeriodicWorkPolicy.KEEP,
                request,
            )
        }
    }
}
