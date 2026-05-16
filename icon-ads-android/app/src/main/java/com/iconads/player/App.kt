package com.iconads.player

import android.app.Application
import com.iconads.player.work.MetricUploadWorker
import com.iconads.player.work.SyncWorker

class App : Application() {
    override fun onCreate() {
        super.onCreate()
        SyncWorker.schedule(this)
        MetricUploadWorker.schedule(this)
    }
}
