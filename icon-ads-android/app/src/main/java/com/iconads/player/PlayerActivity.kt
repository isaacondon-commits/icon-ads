package com.iconads.player

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.View
import android.view.WindowManager
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.lifecycle.lifecycleScope
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import coil.load
import com.iconads.player.data.model.Ad
import com.iconads.player.data.repository.MetricRepository
import com.iconads.player.data.repository.PlaylistRepository
import com.iconads.player.databinding.ActivityPlayerBinding
import com.iconads.player.util.DevicePrefs
import com.iconads.player.work.SyncWorker
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

class PlayerActivity : AppCompatActivity() {

    private lateinit var binding: ActivityPlayerBinding
    private lateinit var exoPlayer: ExoPlayer
    private lateinit var prefs: DevicePrefs
    private lateinit var playlistRepo: PlaylistRepository
    private lateinit var metricRepo: MetricRepository

    private val imageHandler = Handler(Looper.getMainLooper())
    private var ads: List<Ad> = emptyList()
    private var currentIndex = 0
    private var adStartTime = 0L
    private var failCount = 0

    private val playlistUpdatedReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            Log.i(TAG, "Playlist actualizada — recargando")
            loadAndPlay()
        }
    }

    // ────────────────────────────────────────────────────────────────────────

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityPlayerBinding.inflate(layoutInflater)
        setContentView(binding.root)

        prefs = DevicePrefs(this)
        playlistRepo = PlaylistRepository(this)
        metricRepo = MetricRepository(this)

        setupWindow()
        setupExoPlayer()
        SyncWorker.scheduleImmediate(this)
        loadAndPlay()
    }

    override fun onStart() {
        super.onStart()
        ContextCompat.registerReceiver(
            this,
            playlistUpdatedReceiver,
            IntentFilter(SyncWorker.ACTION_PLAYLIST_UPDATED),
            ContextCompat.RECEIVER_NOT_EXPORTED,
        )
    }

    override fun onStop() {
        super.onStop()
        unregisterReceiver(playlistUpdatedReceiver)
    }

    override fun onResume() {
        super.onResume()
        hideSystemUI()
        if (ads.isNotEmpty()) exoPlayer.play()
    }

    override fun onPause() {
        super.onPause()
        exoPlayer.pause()
        imageHandler.removeCallbacksAndMessages(null)
    }

    override fun onDestroy() {
        super.onDestroy()
        exoPlayer.release()
        imageHandler.removeCallbacksAndMessages(null)
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) hideSystemUI()
    }

    // ── Configuración ────────────────────────────────────────────────────────

    private fun setupWindow() {
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        try { startLockTask() } catch (e: Exception) { Log.w(TAG, "Lock task no disponible") }
    }

    private fun hideSystemUI() {
        WindowInsetsControllerCompat(window, binding.root).apply {
            hide(WindowInsetsCompat.Type.systemBars())
            systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        }
    }

    private fun setupExoPlayer() {
        exoPlayer = ExoPlayer.Builder(this).build().also {
            binding.playerView.player = it
            binding.playerView.useController = false
        }
        exoPlayer.addListener(object : Player.Listener {
            override fun onPlaybackStateChanged(state: Int) {
                if (state == Player.STATE_ENDED) {
                    recordMetric(completed = true)
                    playNext()
                }
            }
            override fun onPlayerError(error: PlaybackException) {
                Log.e(TAG, "ExoPlayer error: ${error.message}")
                recordMetric(completed = false, error = true)
                failCount++
                when {
                    failCount < ads.size -> playNext()
                    ads.all { it.campaignId < 0 } -> scheduleRetry()
                    else -> activateFallback()
                }
            }
        })
    }

    // ── Carga de playlist ────────────────────────────────────────────────────

    private fun loadAndPlay() {
        lifecycleScope.launch {
            showLoading(true)
            ads = withContext(Dispatchers.IO) { playlistRepo.loadAds() }
            failCount = 0
            currentIndex = 0
            showLoading(false)
            if (ads.isNotEmpty()) playAd(ads[0])
        }
    }

    private fun activateFallback() {
        lifecycleScope.launch {
            ads = withContext(Dispatchers.IO) { playlistRepo.loadAds() }
            currentIndex = 0
            failCount = 0
            if (ads.isNotEmpty()) playAd(ads[0])
        }
    }

    private fun scheduleRetry() {
        Log.w(TAG, "Contenido institucional no disponible — reintentando en 30s")
        binding.playerView.visibility = View.GONE
        binding.imageView.visibility = View.GONE
        imageHandler.postDelayed({ loadAndPlay() }, 30_000L)
    }

    // ── Reproducción ─────────────────────────────────────────────────────────

    private fun playNext() {
        currentIndex = (currentIndex + 1) % ads.size
        playAd(ads[currentIndex])
    }

    private fun playAd(ad: Ad) {
        adStartTime = System.currentTimeMillis()
        imageHandler.removeCallbacksAndMessages(null)
        when (ad.type) {
            "video" -> playVideo(ad)
            "image" -> showImage(ad)
            else    -> playNext()
        }
    }

    private fun playVideo(ad: Ad) {
        binding.playerView.visibility = View.VISIBLE
        binding.imageView.visibility = View.GONE

        val uri = if (ad.localPath.startsWith("android.resource://")) {
            Uri.parse(ad.localPath)
        } else {
            Uri.fromFile(File(ad.localPath))
        }
        exoPlayer.apply { stop(); setMediaItem(MediaItem.fromUri(uri)); prepare(); play() }
    }

    private fun showImage(ad: Ad) {
        binding.playerView.visibility = View.GONE
        binding.imageView.visibility = View.VISIBLE
        exoPlayer.stop()

        binding.imageView.load(ad.localPath) {
            crossfade(300)
            error(android.R.color.black)
        }
        imageHandler.postDelayed({
            recordMetric(completed = true)
            playNext()
        }, ad.durationS * 1000L)
    }

    // ── Métricas ─────────────────────────────────────────────────────────────

    private fun recordMetric(completed: Boolean, error: Boolean = false) {
        val ad = ads.getOrNull(currentIndex) ?: return
        if (ad.campaignId < 0) return
        val playedAt = adStartTime
        val duration = ((System.currentTimeMillis() - adStartTime) / 1000).toInt()
        lifecycleScope.launch(Dispatchers.IO) {
            metricRepo.record(
                adId = ad.id,
                campaignId = ad.campaignId,
                playedAt = playedAt,
                durationPlayedS = duration,
                completed = completed,
                error = error,
            )
        }
    }

    private fun showLoading(show: Boolean) {
        binding.loadingView.visibility = if (show) View.VISIBLE else View.GONE
    }

    companion object {
        private const val TAG = "PlayerActivity"
    }
}
