package com.iconads.player

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.BatteryManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.util.Log
import android.view.KeyEvent
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
import com.iconads.player.BuildConfig
import com.iconads.player.data.api.NetworkModule
import android.Manifest
import android.content.pm.PackageManager
import androidx.core.app.ActivityCompat
import com.iconads.player.data.model.Ad
import com.iconads.player.data.model.RegisterRequest
import com.iconads.player.data.model.SurveyAnswerRequest
import com.iconads.player.data.model.SurveyQuestion
import com.iconads.player.data.repository.MetricRepository
import com.iconads.player.data.repository.PlaylistRepository
import com.iconads.player.databinding.ActivityPlayerBinding
import com.iconads.player.util.DevicePrefs
import com.iconads.player.work.SyncWorker
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
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
        showOnboardingStatus("Conectando con el servidor...")
        // Registro + sync + upload de métricas inmediatos, sin esperar WorkManager
        lifecycleScope.launch {
            registerNow()
            syncNow()
            uploadMetricsNow()
        }
        // Ciclo periódico cada 30 s — reintenta registro si todavía no hay token
        lifecycleScope.launch {
            while (true) {
                delay(30_000L)
                Log.d(TAG, "ciclo periódico 30s")
                if (prefs.getToken() == null) registerNow()  // retry si el registro falló al arrancar
                syncNow()
                uploadMetricsNow()
            }
        }
        SyncWorker.schedule(this)
        startLocationService()
        loadAndPlay()
        // Poll for admin messages every 5 min (#4)
        lifecycleScope.launch {
            while (true) {
                delay(5 * 60_000L)
                checkAdminMessages()
            }
        }
        // Poll for surveys every 6 hours (#47)
        lifecycleScope.launch {
            delay(2 * 60_000L)
            while (true) {
                checkSurvey()
                delay(6 * 60 * 60_000L)
            }
        }
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

    // Kiosco: bloquear botón back
    @Deprecated("Deprecated in Java")
    override fun onBackPressed() { /* bloqueado en modo kiosco */ }

    // Kiosco: consumir HOME y RECENTS para evitar salida accidental
    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
        return when (keyCode) {
            KeyEvent.KEYCODE_HOME, KeyEvent.KEYCODE_APP_SWITCH, KeyEvent.KEYCODE_MENU -> true
            else -> super.onKeyDown(keyCode, event)
        }
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
                Log.e(TAG, "ExoPlayer error (ad ${ads.getOrNull(currentIndex)?.id}): ${error.message}")
                // Hide video immediately to avoid black screen
                binding.playerView.visibility = View.GONE
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
        // A playlist reload can land an empty list while a video/image callback
        // is already in flight (e.g. campaign expired mid-playback) — guard
        // against a modulo-by-zero crash.
        if (ads.isEmpty()) return
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

    private fun showOnboardingStatus(message: String) {
        binding.loadingView.visibility = View.VISIBLE
        binding.loadingStatusText.text = message
    }

    private fun showLoading(show: Boolean) {
        if (show) {
            binding.loadingView.alpha = 1f
            binding.loadingView.visibility = View.VISIBLE
            binding.loadingStatusText.text = "Cargando contenido..."
        } else {
            binding.loadingView.animate()
                .alpha(0f)
                .setDuration(500)
                .withEndAction {
                    binding.loadingView.visibility = View.GONE
                    binding.loadingView.alpha = 1f
                }
                .start()
        }
    }

    // ── Registro + sync inmediatos ───────────────────────────────────────────

    private fun getBatteryLevel(): Int? {
        return try {
            val bm = getSystemService(Context.BATTERY_SERVICE) as BatteryManager
            val level = bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)
            if (level < 0) null else level
        } catch (e: Exception) { null }
    }

    private fun getCpuTemperature(): Float? {
        return try {
            val file = java.io.File("/sys/class/thermal/thermal_zone0/temp")
            if (file.exists()) file.readText().trim().toFloat() / 1000f else null
        } catch (e: Exception) { null }
    }

    private suspend fun syncNow() {
        val token = prefs.getToken() ?: run {
            Log.w(TAG, "syncNow: sin token — abortando")
            return
        }
        val battery = getBatteryLevel()
        val temp = getCpuTemperature()
        Log.i(TAG, "syncNow: versión local=${prefs.getPlaylistVersion()} battery=${battery}% temp=${temp}°C")
        try {
            val api = NetworkModule.provideDeviceApi(token)
            val syncResp = withContext(Dispatchers.IO) { api.sync(prefs.getPlaylistVersion(), battery, temp, BuildConfig.VERSION_NAME) }
            Log.i(TAG, "syncNow: needsUpdate=${syncResp.needsUpdate} v${syncResp.version} msg=${syncResp.message}")
            if (!syncResp.needsUpdate) return

            val packageUrl = syncResp.packageUrl ?: "api/device/package/${syncResp.version}"
            Log.i(TAG, "syncNow: descargando $packageUrl")
            val dlResp = withContext(Dispatchers.IO) { api.downloadPackage(packageUrl) }
            if (!dlResp.isSuccessful) {
                Log.e(TAG, "syncNow: HTTP ${dlResp.code()} descargando paquete")
                return
            }
            val body = dlResp.body() ?: run { Log.e(TAG, "syncNow: body vacío"); return }
            val hash = dlResp.headers()["X-Playlist-Hash"] ?: ""
            Log.i(TAG, "syncNow: instalando v${syncResp.version} hash=${hash.take(8)}")
            withContext(Dispatchers.IO) { playlistRepo.installPackage(body, syncResp.version, hash) }
            prefs.setPlaylistVersion(syncResp.version)
            Log.i(TAG, "syncNow: instalación OK — difundiendo actualización")
            sendBroadcast(Intent(SyncWorker.ACTION_PLAYLIST_UPDATED).apply { setPackage(packageName) })
        } catch (e: Exception) {
            Log.e(TAG, "syncNow: FALLÓ ${e.javaClass.simpleName}: ${e.message}", e)
        }
    }

    private suspend fun uploadMetricsNow() {
        try {
            val uploaded = withContext(Dispatchers.IO) { metricRepo.uploadPending() }
            if (uploaded > 0) Log.i(TAG, "uploadMetricsNow: $uploaded métricas subidas")
        } catch (e: Exception) {
            Log.w(TAG, "uploadMetricsNow: ${e.javaClass.simpleName}: ${e.message}")
        }
    }

    private suspend fun checkAdminMessages() {
        val token = prefs.getToken() ?: return
        try {
            val messages = withContext(Dispatchers.IO) { NetworkModule.provideDeviceApi(token).getMessages() }
            for (msg in messages) {
                withContext(Dispatchers.Main) { showAdminMessage(msg.message) }
                delay(11_000L) // wait for overlay to finish before showing next
            }
        } catch (e: Exception) {
            Log.w(TAG, "checkAdminMessages: ${e.javaClass.simpleName}: ${e.message}")
        }
    }

    private fun showAdminMessage(text: String) {
        binding.messageOverlay.visibility = android.view.View.VISIBLE
        binding.messageText.text = text
        imageHandler.postDelayed({
            binding.messageOverlay.visibility = android.view.View.GONE
        }, 10_000L)
    }

    private fun startLocationService() {
        val hasFine = ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
        val hasCoarse = ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED
        if (hasFine || hasCoarse) {
            LocationService.start(this)
        } else {
            ActivityCompat.requestPermissions(this,
                arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION),
                LOCATION_PERM_REQ)
        }
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == LOCATION_PERM_REQ && grantResults.any { it == PackageManager.PERMISSION_GRANTED }) {
            LocationService.start(this)
        }
    }

    private suspend fun checkSurvey() {
        val token = prefs.getToken() ?: return
        try {
            val resp = withContext(Dispatchers.IO) { NetworkModule.provideDeviceApi(token).getSurvey() }
            if (resp.isSuccessful && resp.body() != null) {
                withContext(Dispatchers.Main) { showSurvey(resp.body()!!) }
            }
        } catch (e: Exception) {
            Log.w(TAG, "checkSurvey: ${e.javaClass.simpleName}: ${e.message}")
        }
    }

    private fun showSurvey(survey: SurveyQuestion) {
        val optButtons = listOf(binding.surveyOpt0, binding.surveyOpt1, binding.surveyOpt2, binding.surveyOpt3)
        binding.surveyQuestionText.text = survey.question
        optButtons.forEachIndexed { idx, btn ->
            if (idx < survey.options.size) {
                btn.visibility = View.VISIBLE
                btn.text = survey.options[idx]
                btn.setOnClickListener { submitSurveyAnswer(survey.id, idx) }
            } else {
                btn.visibility = View.GONE
            }
        }
        binding.surveyDismiss.setOnClickListener {
            binding.surveyOverlay.visibility = View.GONE
        }
        binding.surveyOverlay.visibility = View.VISIBLE
    }

    private fun submitSurveyAnswer(surveyId: Int, optionIndex: Int) {
        lifecycleScope.launch {
            try {
                val token = prefs.getToken() ?: return@launch
                withContext(Dispatchers.IO) {
                    NetworkModule.provideDeviceApi(token).submitSurveyAnswer(
                        SurveyAnswerRequest(surveyId, optionIndex)
                    )
                }
            } catch (e: Exception) {
                Log.w(TAG, "submitSurveyAnswer: ${e.message}")
            } finally {
                binding.surveyOverlay.visibility = View.GONE
            }
        }
    }

    private suspend fun registerNow() {
        if (prefs.getToken() != null) {
            Log.i(TAG, "registerNow: ya registrado — tabletId=${prefs.getTabletId()}, omitiendo")
            return
        }
        val deviceId = DevicePrefs.getDeviceId(this)
        Log.i(TAG, "registerNow: iniciando — deviceId=$deviceId url=${BuildConfig.BASE_URL}/api/device/register")
        withContext(Dispatchers.Main) { showOnboardingStatus("Conectando con el servidor...") }
        try {
            val response = withContext(Dispatchers.IO) {
                NetworkModule.provideDeviceApi(null).register(
                    RegisterRequest(
                        deviceId = deviceId,
                        name = "Tablet ${deviceId.take(8)}",
                    )
                )
            }
            prefs.setToken(response.token)
            prefs.setTabletId(response.tabletId)
            Log.i(TAG, "registerNow: OK — tabletId=${response.tabletId} token=${response.token.take(8)}…")
            withContext(Dispatchers.Main) {
                showOnboardingStatus("Tablet registrada — sincronizando contenido...")
                vibrate(300)
            }
        } catch (e: Exception) {
            Log.e(TAG, "registerNow: FALLÓ [${e.javaClass.simpleName}] ${e.message} — backend=${BuildConfig.BASE_URL}", e)
            withContext(Dispatchers.Main) { showOnboardingStatus("Sin conexión — reintentando...") }
        }
    }

    private fun vibrate(ms: Long) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                (getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager)
                    .defaultVibrator
                    .vibrate(VibrationEffect.createOneShot(ms, VibrationEffect.DEFAULT_AMPLITUDE))
            } else {
                @Suppress("DEPRECATION")
                (getSystemService(Context.VIBRATOR_SERVICE) as Vibrator)
                    .vibrate(VibrationEffect.createOneShot(ms, VibrationEffect.DEFAULT_AMPLITUDE))
            }
        } catch (e: Exception) {
            Log.w(TAG, "vibrate: ${e.message}")
        }
    }

    companion object {
        private const val TAG = "PlayerActivity"
        private const val LOCATION_PERM_REQ = 101
    }
}
