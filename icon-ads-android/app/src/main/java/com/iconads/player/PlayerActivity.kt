package com.iconads.player

import android.annotation.SuppressLint
import android.app.KeyguardManager
import android.app.role.RoleManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.media.AudioManager
import android.telecom.TelecomManager
import android.telephony.PhoneStateListener
import android.telephony.TelephonyManager
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
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
import com.iconads.player.kiosk.KioskManager
import com.iconads.player.power.PowerController
import com.iconads.player.util.AdaptiveBrightness
import com.iconads.player.util.DevicePrefs
import com.iconads.player.work.SyncWorker
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import kotlin.math.sqrt

class PlayerActivity : AppCompatActivity() {

    private lateinit var binding: ActivityPlayerBinding
    private lateinit var exoPlayer: ExoPlayer
    private lateinit var prefs: DevicePrefs
    private lateinit var playlistRepo: PlaylistRepository
    private lateinit var metricRepo: MetricRepository
    private lateinit var sensorManager: SensorManager
    private var gravitySensor: Sensor? = null
    private val adaptiveBrightness by lazy { AdaptiveBrightness(this) }

    private val imageHandler = Handler(Looper.getMainLooper())
    private var ads: List<Ad> = emptyList()
    private var currentIndex = 0
    private var adStartTime = 0L
    private var failCount = 0
    // Última vez que un anuncio efectivamente pasó a mostrarse (playAd()).
    private var lastAdRenderedMs = 0L
    // Última vez que un FRAME real se dibujó (video: onRenderedFirstFrame;
    // imagen: Coil onSuccess). Es la señal fiable de "hay algo en pantalla".
    private var lastFrameRenderedMs = 0L
    private var errorStreak = 0

    // "Dormido": el PowerController pidió cerrar la app (auto apagado o tablet
    // quieta 10 min). Se pausa la reproducción y se oscurece la pantalla; el
    // bloqueo/apagado real lo hace KioskManager si la app es Device Owner.
    private var dormant = false

    // Evita bajar el paquete dos veces a la vez (la descarga corre detached del
    // loop de sync para no bloquear el heartbeat).
    private var packageDownloadInProgress = false

    // El operador bloqueó la tablet desde el panel (manualStatus="bloqueada").
    // A diferencia de `dormant` (apagado por energía/quietud), acá el kiosco
    // sigue armado y la pantalla prendida — sólo se frena la reproducción.
    private var blockedByPanel = false

    // Auto-detected via gravitySensorListener below — true once the tablet's
    // live orientation has settled ~180° away from its first-boot reference.
    private var sensorFlipped180 = false
    private var candidateFlipped: Boolean? = null
    private var candidateStreak = 0

    private val playlistUpdatedReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            Log.i(TAG, "Playlist actualizada — recargando")
            loadAndPlay()
        }
    }

    private val rotationChangedReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            Log.i(TAG, "rotated180 cambió — aplicando")
            applyRotation()
        }
    }

    // PowerController pide cerrar el player (sin corriente / 10 min quieta).
    private val closeAppReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            Log.i(TAG, "CLOSE_APP recibido — entrando en modo dormido")
            enterDormant()
        }
    }

    // Una llamada entrante saca el player de foco. Lo recuperamos al instante,
    // silenciamos el tono e intentamos colgar (requiere Device Owner o el
    // permiso ANSWER_PHONE_CALLS). En modo kiosco de Device Owner la UI de
    // llamada ni siquiera aparece porque el dialer está oculto.
    private val phoneStateListener = object : PhoneStateListener() {
        @Deprecated("Deprecated in Java")
        override fun onCallStateChanged(state: Int, phoneNumber: String?) {
            if (state == TelephonyManager.CALL_STATE_RINGING ||
                state == TelephonyManager.CALL_STATE_OFFHOOK
            ) {
                Log.i(TAG, "Llamada (state=$state) — recuperando foco del player")
                try {
                    (getSystemService(Context.AUDIO_SERVICE) as AudioManager)
                        .adjustStreamVolume(AudioManager.STREAM_RING, AudioManager.ADJUST_MUTE, 0)
                } catch (_: Exception) {}
                endCallIfPossible()
                startActivity(
                    Intent(this@PlayerActivity, PlayerActivity::class.java).addFlags(
                        Intent.FLAG_ACTIVITY_REORDER_TO_FRONT or Intent.FLAG_ACTIVITY_SINGLE_TOP
                    )
                )
            }
        }
    }

    // Auto 180° flip (#rotation-auto) — compares live gravity readings
    // against the reference captured on first boot (see DevicePrefs). If the
    // tablet is now settled ~180° away from how it was originally mounted,
    // it flips on its own without needing the admin panel toggle.
    //
    // Uses TYPE_GRAVITY (not raw accelerometer) since it's already low-pass
    // filtered by the OS to strip out linear acceleration — important here
    // because several tablets are mounted in moving vehicles. A streak of
    // consistent readings is still required before acting, as extra
    // debounce against bumps/turns.
    private val gravityListener = object : SensorEventListener {
        override fun onSensorChanged(event: SensorEvent) {
            val x = event.values[0]
            val y = event.values[1]
            val z = event.values[2]

            if (!prefs.hasGravityReference()) {
                prefs.setGravityReference(x, y, z)
                Log.i(TAG, "Referencia de gravedad calibrada (primer arranque)")
                return
            }

            val ref = prefs.getGravityReference()
            val magNow = sqrt(x * x + y * y + z * z)
            val magRef = sqrt(ref[0] * ref[0] + ref[1] * ref[1] + ref[2] * ref[2])
            if (magNow < 0.1f || magRef < 0.1f) return
            val dot = x * ref[0] + y * ref[1] + z * ref[2]
            val cos = (dot / (magNow * magRef)).coerceIn(-1f, 1f)

            val candidate = when {
                cos > FLIP_COS_THRESHOLD -> false  // orientación ~igual a la referencia
                cos < -FLIP_COS_THRESHOLD -> true  // orientación ~opuesta (180°)
                else -> return                     // ángulo intermedio (manipulación/curva) — ignorar
            }

            if (candidate == candidateFlipped) {
                candidateStreak++
            } else {
                candidateFlipped = candidate
                candidateStreak = 1
            }

            if (candidateStreak >= STABLE_READINGS_REQUIRED && candidate != sensorFlipped180) {
                sensorFlipped180 = candidate
                Log.i(TAG, "Sensor detectó tablet física ${if (candidate) "boca abajo" else "en posición normal"} — aplicando")
                applyRotation()
            }
        }

        override fun onAccuracyChanged(sensor: Sensor, accuracy: Int) {}
    }

    // Rotación efectiva = toggle manual del panel admin XOR estado detectado
    // por el sensor. El sensor cubre el caso común (alguien voltea la
    // tablet); el manual queda como override para montajes donde el sensor
    // no aplica. Rota todo el contenido de pantalla, no solo video/imagen,
    // así queda correcto sin importar qué se esté mostrando.
    private fun applyRotation() {
        val flipped = prefs.getRotated180() xor sensorFlipped180
        binding.root.rotation = if (flipped) 180f else 0f
    }

    // ────────────────────────────────────────────────────────────────────────

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityPlayerBinding.inflate(layoutInflater)
        setContentView(binding.root)

        prefs = DevicePrefs(this)
        playlistRepo = PlaylistRepository(this)
        metricRepo = MetricRepository(this)
        sensorManager = getSystemService(Context.SENSOR_SERVICE) as SensorManager
        gravitySensor = sensorManager.getDefaultSensor(Sensor.TYPE_GRAVITY)
            ?: sensorManager.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)

        KioskManager.applyPolicies(this)
        KioskManager.enterPlaying(this)
        PowerController.start(this)
        maybePromptDeviceAdmin()
        maybeRequestCallScreeningRole()
        setupWindow()
        setupShowWhenLocked()
        applyRotation()
        setupExoPlayer()
        showOnboardingStatus("Conectando con el servidor...")
        // Registro + sync + upload de métricas inmediatos, sin esperar WorkManager
        lifecycleScope.launch {
            registerNow()
            syncNow()
        }
        // Ciclo periódico — 30 s normal, 10 s en modo test (para que los
        // force-sync se apliquen más rápido durante las pruebas).
        lifecycleScope.launch {
            while (true) {
                delay(if (prefs.getTestMode()) 10_000L else 30_000L)
                Log.d(TAG, "ciclo periódico")
                if (prefs.getToken() == null) registerNow()  // retry si el registro falló al arrancar
                syncNow()
            }
        }
        // Subida de métricas con cadencia propia de 2 min. Antes iba pegada a
        // cada sync (cada 10 s en modo test); con un timeout de red de por medio
        // las subidas se solapaban y el server insertaba el mismo lote varias
        // veces -> filas multiplicadas.
        lifecycleScope.launch {
            delay(20_000L)
            uploadMetricsNow()
            while (true) {
                delay(120_000L)
                uploadMetricsNow()
            }
        }
        SyncWorker.schedule(this)
        startLocationService()
        requestPhonePermissionsIfNeeded()
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
        ContextCompat.registerReceiver(
            this,
            rotationChangedReceiver,
            IntentFilter(SyncWorker.ACTION_ROTATION_CHANGED),
            ContextCompat.RECEIVER_NOT_EXPORTED,
        )
        ContextCompat.registerReceiver(
            this,
            closeAppReceiver,
            IntentFilter(PowerController.ACTION_CLOSE_APP),
            ContextCompat.RECEIVER_NOT_EXPORTED,
        )
        gravitySensor?.let { sensorManager.registerListener(gravityListener, it, SensorManager.SENSOR_DELAY_NORMAL) }
        try {
            (getSystemService(Context.TELEPHONY_SERVICE) as TelephonyManager)
                .listen(phoneStateListener, PhoneStateListener.LISTEN_CALL_STATE)
        } catch (e: Exception) {
            Log.w(TAG, "No se pudo escuchar el estado de llamada: ${e.message}")
        }
    }

    override fun onStop() {
        super.onStop()
        unregisterReceiver(playlistUpdatedReceiver)
        unregisterReceiver(rotationChangedReceiver)
        unregisterReceiver(closeAppReceiver)
        sensorManager.unregisterListener(gravityListener)
        adaptiveBrightness.pause()
        try {
            (getSystemService(Context.TELEPHONY_SERVICE) as TelephonyManager)
                .listen(phoneStateListener, PhoneStateListener.LISTEN_NONE)
        } catch (_: Exception) {}
    }

    override fun onNewIntent(intent: Intent?) {
        super.onNewIntent(intent)
        setIntent(intent)
        // El PowerController nos trajo al frente (llegó corriente / hubo
        // movimiento). Salir del modo dormido y reanudar la reproducción.
        exitDormant()
    }

    override fun onResume() {
        super.onResume()
        hideSystemUI()
        KioskManager.muteAllStreams(this)
        if (!dormant && !blockedByPanel && ads.isNotEmpty()) exoPlayer.play()
        if (!dormant && prefs.getBrightnessPolicy() == "auto") adaptiveBrightness.resume(window)
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
        adaptiveBrightness.release()
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) hideSystemUI()
    }

    // Kiosco: bloquear botón back
    @Deprecated("Deprecated in Java")
    override fun onBackPressed() { /* bloqueado en modo kiosco */ }

    // Kiosco: consumir HOME y RECENTS para evitar salida accidental.
    // En modo test se dejan pasar, para poder salir a Ajustes.
    private fun isVolumeKey(keyCode: Int) =
        keyCode == KeyEvent.KEYCODE_VOLUME_UP ||
            keyCode == KeyEvent.KEYCODE_VOLUME_DOWN ||
            keyCode == KeyEvent.KEYCODE_VOLUME_MUTE

    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
        // Los botones de volumen se consumen SIEMPRE (incluso en modo test): la
        // tablet nunca sube el volumen. Se re-mutea por las dudas.
        if (isVolumeKey(keyCode)) {
            KioskManager.muteAllStreams(this)
            return true
        }
        if (prefs.getTestMode()) return super.onKeyDown(keyCode, event)
        return when (keyCode) {
            KeyEvent.KEYCODE_HOME, KeyEvent.KEYCODE_APP_SWITCH, KeyEvent.KEYCODE_MENU -> true
            else -> super.onKeyDown(keyCode, event)
        }
    }

    override fun onKeyUp(keyCode: Int, event: KeyEvent?): Boolean {
        if (isVolumeKey(keyCode)) return true
        return super.onKeyUp(keyCode, event)
    }

    // ── Configuración ────────────────────────────────────────────────────────

    // Entra en lock task (kiosco real) salvo que esté el modo test, donde se
    // libera para poder configurar la tablet (WiFi, datos, etc.).
    private fun applyKioskState() {
        if (prefs.getTestMode()) {
            try { stopLockTask() } catch (_: Exception) {}
            KioskManager.setKioskLock(this, false)
        } else {
            try { startLockTask() } catch (e: Exception) { Log.w(TAG, "Lock task no disponible") }
            KioskManager.setKioskLock(this, true)
        }
    }

    private fun setupWindow() {
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        applyKioskState()
        KioskManager.enforceSilence(this)
        adaptiveBrightness.applySchedule(prefs.getBrightnessSchedule())
        applyBrightness(prefs.getBrightnessPolicy())
    }

    // Aplica la política de brillo. "auto" = brillo automático manejado por la
    // app (sensor de luz → window.screenBrightness). Un número = brillo fijo
    // vía DevicePolicyManager (modo manual del sistema).
    private fun applyBrightness(policy: String) {
        if (policy == "auto") {
            adaptiveBrightness.enable(window)
        } else {
            adaptiveBrightness.release()
            KioskManager.applyBrightnessPolicy(this, policy)
        }
    }

    // Mostrar el player por encima del bloqueo y encender la pantalla cuando
    // el PowerController lo trae al frente (llega la corriente del taxi).
    // Se usan LOS DOS mecanismos: las APIs nuevas (setShowWhenLocked/
    // setTurnScreenOn) y los flags de ventana clásicos — en ROMs de OEM
    // (Unisoc/Chuwi acá) los flags suelen ser más confiables para encender la
    // pantalla desde segundo plano, y sostienen el KEEP_SCREEN_ON cuando el
    // wake lock del PowerController se suelta.
    private fun setupShowWhenLocked() {
        @Suppress("DEPRECATION")
        window.addFlags(
            WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
                WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON or
                WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD or
                WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
        )
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
            (getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager)
                .requestDismissKeyguard(this, null)
        }
    }

    // Se ofrece activar el Device Admin una sola vez. Sin él (y sin Device
    // Owner) no se puede apagar la pantalla al sacar el cargador y la tablet
    // consume batería mostrando el player oscuro.
    private fun maybePromptDeviceAdmin() {
        if (KioskManager.isDeviceOwner(this) || KioskManager.isAdminActive(this)) return
        if (prefs.getDeviceAdminAsked()) return
        prefs.setDeviceAdminAsked(true)
        KioskManager.ensureDeviceAdmin(this)
    }

    // Pide (una vez) el rol de filtrado de llamadas. Con él, CallBlockerService
    // rechaza las llamadas entrantes antes de que suene el tono. Un solo toque
    // en el diálogo del sistema por tablet.
    private fun maybeRequestCallScreeningRole() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return
        val rm = getSystemService(RoleManager::class.java) ?: return
        if (!rm.isRoleAvailable(RoleManager.ROLE_CALL_SCREENING)) return
        if (rm.isRoleHeld(RoleManager.ROLE_CALL_SCREENING)) return
        if (prefs.getCallRoleAsked()) return
        prefs.setCallRoleAsked(true)
        try {
            startActivityForResult(
                rm.createRequestRoleIntent(RoleManager.ROLE_CALL_SCREENING),
                CALL_ROLE_REQ,
            )
        } catch (e: Exception) {
            Log.w(TAG, "createRequestRoleIntent: ${e.message}")
        }
    }

    private fun enterDormant() {
        if (dormant) return
        dormant = true
        Log.i(TAG, "Modo dormido: frenando reproducción y apagando pantalla")
        exoPlayer.stop()
        imageHandler.removeCallbacksAndMessages(null)
        @Suppress("DEPRECATION")
        window.clearFlags(
            WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON or
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
                WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON or
                WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD
        )
        adaptiveBrightness.pause()  // sin adaptar mientras está dormida
        window.attributes = window.attributes.apply { screenBrightness = 0.004f }
        // Dejar de mostrarse por encima del bloqueo: si alguien enciende la
        // pantalla con la tablet estacionada, tiene que aparecer el PIN, no el
        // player. (En Device Owner además KioskManager.lockDown apaga y bloquea.)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(false)
            setTurnScreenOn(false)
        }
        try { stopLockTask() } catch (_: Exception) {}
    }

    private fun exitDormant() {
        if (!dormant) {
            // Igual reafirmamos foco/pantalla por si venimos de una llamada.
            setupShowWhenLocked()
            return
        }
        dormant = false
        Log.i(TAG, "Saliendo de modo dormido: reanudando reproducción")
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        if (prefs.getBrightnessPolicy() == "auto") {
            adaptiveBrightness.resume(window)
        } else {
            window.attributes = window.attributes.apply {
                screenBrightness = WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_NONE
            }
        }
        setupShowWhenLocked()
        KioskManager.enterPlaying(this)
        applyKioskState()
        loadAndPlay()  // exoPlayer.stop() en enterDormant liberó el media item
    }

    private fun enterBlocked() {
        if (blockedByPanel) return
        blockedByPanel = true
        Log.i(TAG, "Bloqueada desde el panel: frenando reproducción")
        exoPlayer.pause()
        imageHandler.removeCallbacksAndMessages(null)
        // Pantalla neutra: ocultar el anuncio congelado y dejar el fondo negro
        // con el cartel arriba, para que se vea claro que NO está pasando nada.
        binding.playerView.visibility = View.GONE
        binding.imageView.visibility = View.GONE
        binding.messageOverlay.visibility = View.VISIBLE
        binding.messageText.text = "⏸ Tablet bloqueada desde el panel"
    }

    private fun exitBlocked() {
        if (!blockedByPanel) return
        blockedByPanel = false
        Log.i(TAG, "Desbloqueada desde el panel: reanudando reproducción")
        binding.messageOverlay.visibility = View.GONE
        if (!dormant) loadAndPlay()
    }

    @SuppressLint("MissingPermission")
    private fun endCallIfPossible() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P) return
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.ANSWER_PHONE_CALLS)
            != PackageManager.PERMISSION_GRANTED
        ) return
        try {
            (getSystemService(Context.TELECOM_SERVICE) as TelecomManager).endCall()
        } catch (e: Exception) {
            Log.w(TAG, "endCall falló: ${e.message}")
        }
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
            it.setVideoScalingMode(androidx.media3.common.C.VIDEO_SCALING_MODE_SCALE_TO_FIT)
            it.volume = 0f  // la tablet nunca hace ruido
        }
        exoPlayer.addListener(object : Player.Listener {
            override fun onRenderedFirstFrame() {
                // Un frame de video efectivamente se dibujó -> el player está OK.
                lastFrameRenderedMs = System.currentTimeMillis()
                errorStreak = 0
            }
            override fun onPlaybackStateChanged(state: Int) {
                if (state == Player.STATE_ENDED) {
                    errorStreak = 0
                    recordMetric(completed = true)
                    playNext()
                }
            }
            override fun onPlayerError(error: PlaybackException) {
                Log.e(TAG, "ExoPlayer error (ad ${ads.getOrNull(currentIndex)?.id}): ${error.message}")
                // Hide video immediately to avoid black screen
                binding.playerView.visibility = View.GONE
                recordMetric(completed = false, error = true)
                errorStreak++
                failCount++
                // Backoff: sin esto, varios anuncios corruptos seguidos hacen
                // error -> playNext -> error... a toda velocidad.
                when {
                    failCount < ads.size -> imageHandler.postDelayed({ playNext() }, 1500L)
                    ads.all { it.campaignId < 0 } -> scheduleRetry()
                    else -> imageHandler.postDelayed({ activateFallback() }, 5000L)
                }
            }
        })
    }

    // ── Carga de playlist ────────────────────────────────────────────────────

    private fun loadAndPlay() {
        if (blockedByPanel) { Log.i(TAG, "loadAndPlay ignorado: tablet bloqueada"); return }
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
        if (blockedByPanel) return
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
        if (blockedByPanel) return
        // A playlist reload can land an empty list while a video/image callback
        // is already in flight (e.g. campaign expired mid-playback) — guard
        // against a modulo-by-zero crash.
        if (ads.isEmpty()) return
        currentIndex = (currentIndex + 1) % ads.size
        playAd(ads[currentIndex])
    }

    private fun playAd(ad: Ad) {
        if (blockedByPanel) { Log.i(TAG, "playAd ignorado: tablet bloqueada"); return }
        adStartTime = System.currentTimeMillis()
        lastAdRenderedMs = adStartTime
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
            listener(
                onSuccess = { _, _ -> lastFrameRenderedMs = System.currentTimeMillis(); errorStreak = 0 },
                onError = { _, _ -> errorStreak++ },
            )
        }
        imageHandler.postDelayed({
            recordMetric(completed = true)
            playNext()
        }, ad.durationS * 1000L)
    }

    // ── Métricas ─────────────────────────────────────────────────────────────

    // Tope duro: si el player entra en un loop de reintentos (p. ej. varios
    // videos corruptos -> error -> playNext -> error...), esto evita que se
    // graben miles de métricas por minuto. El ritmo real es ~8/min por tablet;
    // 40/min deja margen de sobra y corta cualquier runaway.
    private val recordTimes = ArrayDeque<Long>()
    private val MAX_RECORDS_PER_MIN = 40

    private fun recordMetric(completed: Boolean, error: Boolean = false) {
        val ad = ads.getOrNull(currentIndex) ?: return
        if (ad.campaignId < 0) return

        val now = System.currentTimeMillis()
        while (recordTimes.isNotEmpty() && now - recordTimes.first() > 60_000L) recordTimes.removeFirst()
        if (recordTimes.size >= MAX_RECORDS_PER_MIN) {
            Log.w(TAG, "recordMetric: tope de $MAX_RECORDS_PER_MIN/min alcanzado — descartando (¿loop del player?)")
            return
        }
        recordTimes.addLast(now)

        val playedAt = adStartTime
        val duration = ((now - adStartTime) / 1000).toInt()
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

    // Brillo 0-100 (%) y si está en modo automático. El valor 0-255 de
    // SCREEN_BRIGHTNESS es el nivel base; en auto no es el que se ve pero
    // sirve de referencia. Lo que importa para el monitoreo es el modo.
    private fun getBrightnessPct(): Int? = try {
        val raw = android.provider.Settings.System.getInt(
            contentResolver, android.provider.Settings.System.SCREEN_BRIGHTNESS, -1,
        )
        if (raw < 0) null else (raw * 100 / 255)
    } catch (e: Exception) { null }

    private fun isBrightnessAuto(): Boolean? = try {
        android.provider.Settings.System.getInt(
            contentResolver, android.provider.Settings.System.SCREEN_BRIGHTNESS_MODE, 0,
        ) == android.provider.Settings.System.SCREEN_BRIGHTNESS_MODE_AUTOMATIC
    } catch (e: Exception) { null }

    // "El player está mostrando publicidad de verdad": tiene anuncios, no está
    // en un loop de errores, y O BIEN dibujó un frame hace poco O el video está
    // efectivamente reproduciendo (READY + playing).
    private fun playerOk(): Boolean {
        if (ads.isEmpty()) return false
        if (errorStreak >= maxOf(3, ads.size)) return false
        val now = System.currentTimeMillis()
        val recentFrame = lastFrameRenderedMs > 0L && now - lastFrameRenderedMs < 180_000L
        val videoPlaying = try {
            exoPlayer.isPlaying && exoPlayer.playbackState == Player.STATE_READY
        } catch (_: Exception) { false }
        return recentFrame || videoPlaying
    }

    // Segundos desde el último frame real en pantalla (o desde playAd si nunca
    // hubo frame). Lo que el panel muestra como "hace X min sin publicidad".
    private fun lastAdAgoS(): Int? {
        val ref = maxOf(lastFrameRenderedMs, lastAdRenderedMs)
        return if (ref > 0L) ((System.currentTimeMillis() - ref) / 1000).toInt() else null
    }

    // true = la tablet está mostrando SOLO el video institucional de respaldo
    // (no pudo cargar su playlist real). Los ads institucionales tienen
    // campaignId < 0.
    private fun onFallback(): Boolean =
        ads.isNotEmpty() && ads.all { it.campaignId < 0 }

    // Captura la ventana del player (incluye el video, vía PixelCopy) y la sube.
    // Enciende la pantalla si está apagada. Usa su propio scope/handler — NO
    // imageHandler, que se limpia en cada cambio de anuncio.
    private fun captureAndUploadScreenshot(token: String) {
        lifecycleScope.launch(Dispatchers.Main) {
            try {
                val pm = getSystemService(Context.POWER_SERVICE) as android.os.PowerManager
                val wasOff = !pm.isInteractive
                if (wasOff) {
                    @Suppress("DEPRECATION")
                    pm.newWakeLock(
                        android.os.PowerManager.SCREEN_BRIGHT_WAKE_LOCK or
                            android.os.PowerManager.ACQUIRE_CAUSES_WAKEUP or
                            android.os.PowerManager.ON_AFTER_RELEASE,
                        "iconads:shot",
                    ).apply { acquire(8_000L) }
                }
                // Traer el player al frente y encender la pantalla (esta ROM no
                // despierta sólo con el wake lock). Es a sí misma (singleTask).
                startActivity(
                    Intent(this@PlayerActivity, PlayerActivity::class.java).addFlags(
                        Intent.FLAG_ACTIVITY_NEW_TASK or
                            Intent.FLAG_ACTIVITY_REORDER_TO_FRONT or
                            Intent.FLAG_ACTIVITY_SINGLE_TOP,
                    ),
                )
                delay(if (wasOff) 2800 else 500)
                if (!doCapture(token)) { delay(2000); doCapture(token) }
            } catch (e: Exception) {
                Log.w(TAG, "captureAndUploadScreenshot: ${e.message}")
            }
        }
    }

    private fun doCapture(token: String): Boolean {
        return try {
            val src = binding.root
            if (src.width == 0 || src.height == 0) return false
            val full = android.graphics.Bitmap.createBitmap(src.width, src.height, android.graphics.Bitmap.Config.ARGB_8888)
            android.view.PixelCopy.request(window, full, { result ->
                try {
                    if (result != android.view.PixelCopy.SUCCESS) {
                        Log.w(TAG, "PixelCopy: $result"); return@request
                    }
                    val targetW = 640
                    val scale = targetW.toFloat() / full.width
                    val scaled = android.graphics.Bitmap.createScaledBitmap(
                        full, targetW, (full.height * scale).toInt(), true,
                    )
                    val bos = java.io.ByteArrayOutputStream()
                    scaled.compress(android.graphics.Bitmap.CompressFormat.JPEG, 55, bos)
                    val b64 = android.util.Base64.encodeToString(bos.toByteArray(), android.util.Base64.NO_WRAP)
                    lifecycleScope.launch(Dispatchers.IO) {
                        try {
                            NetworkModule.provideDeviceApi(token).uploadScreenshot(
                                com.iconads.player.data.model.ScreenshotUpload("data:image/jpeg;base64,$b64"),
                            )
                            Log.i(TAG, "screenshot subido (${bos.size()} bytes)")
                        } catch (e: Exception) {
                            Log.w(TAG, "uploadScreenshot: ${e.message}")
                        }
                    }
                } catch (e: Exception) {
                    Log.w(TAG, "captura post-PixelCopy: ${e.message}")
                }
            }, android.os.Handler(android.os.Looper.getMainLooper()))
            true
        } catch (e: Exception) {
            Log.w(TAG, "doCapture: ${e.message}"); false
        }
    }

    private fun getSerial(): String? = try {
        @Suppress("HardwareIds", "MissingPermission")
        val s = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) Build.getSerial() else @Suppress("DEPRECATION") Build.SERIAL
        if (s.isNullOrBlank() || s.equals("unknown", true)) null else s
    } catch (e: Exception) { null }

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
            val autoBrightness = prefs.getBrightnessPolicy() == "auto"
            val syncResp = withContext(Dispatchers.IO) {
                api.sync(
                    prefs.getPlaylistVersion(), battery, temp, BuildConfig.VERSION_NAME,
                    brightness = if (autoBrightness) (adaptiveBrightness.currentFraction * 100).toInt() else getBrightnessPct(),
                    brightnessAuto = if (autoBrightness) true else isBrightnessAuto(),
                    serial = getSerial(),
                    playerOk = playerOk(),
                    lastAdAgoS = lastAdAgoS(),
                    onFallback = onFallback(),
                    lux = if (autoBrightness) adaptiveBrightness.lastLux else null,
                    lightSensor = if (autoBrightness) adaptiveBrightness.hasSensor else null,
                    installedPlaylistId = playlistRepo.installedPlaylistId(),
                )
            }
            Log.i(TAG, "syncNow: needsUpdate=${syncResp.needsUpdate} v${syncResp.version} msg=${syncResp.message}")
            if (prefs.getTestMode() != syncResp.testMode) {
                Log.i(TAG, "syncNow: modo test → ${syncResp.testMode}")
                prefs.setTestMode(syncResp.testMode)
                withContext(Dispatchers.Main) { applyKioskState() }  // soltar/re-armar kiosco al instante
            }
            syncResp.brightnessSchedule?.let { sched ->
                if (sched != prefs.getBrightnessSchedule()) {
                    Log.i(TAG, "syncNow: tabla de brillo actualizada")
                    prefs.setBrightnessSchedule(sched)
                    withContext(Dispatchers.Main) { adaptiveBrightness.applySchedule(sched) }
                }
            }
            syncResp.brightnessPolicy?.let { pol ->
                if (pol != prefs.getBrightnessPolicy()) {
                    Log.i(TAG, "syncNow: brillo → $pol")
                    prefs.setBrightnessPolicy(pol)
                    withContext(Dispatchers.Main) { applyBrightness(pol) }
                }
            }
            if (syncResp.blocked != blockedByPanel) {
                withContext(Dispatchers.Main) { if (syncResp.blocked) enterBlocked() else exitBlocked() }
            }
            if (syncResp.screenshotRequested) {
                Log.i(TAG, "syncNow: el panel pidió captura de pantalla")
                withContext(Dispatchers.Main) { captureAndUploadScreenshot(token) }
            }
            if (syncResp.forceApkCheck) {
                Log.i(TAG, "syncNow: panel forzó chequeo de APK — encolando SyncWorker")
                SyncWorker.scheduleImmediate(this@PlayerActivity)
            }
            if (!syncResp.needsUpdate) return

            // La descarga del paquete (puede ser >100 MB, minutos con señal débil)
            // va en su PROPIA corrutina — si se hiciera acá, bloquearía el loop de
            // heartbeat y la tablet se caería del monitor mientras baja.
            val packageUrl = syncResp.packageUrl ?: "api/device/package/${syncResp.version}"
            if (!packageDownloadInProgress) {
                packageDownloadInProgress = true
                lifecycleScope.launch(Dispatchers.IO) {
                    try { downloadAndInstallPackage(token, syncResp.version, packageUrl) }
                    catch (e: Exception) { Log.e(TAG, "descarga de paquete falló: ${e.message}") }
                    finally { packageDownloadInProgress = false }
                }
            }
        } catch (e: retrofit2.HttpException) {
            if (e.code() == 401) {
                // Token rechazado — probablemente revocado desde el panel admin.
                // Limpiamos el token local para que el ciclo periódico se re-registre.
                Log.w(TAG, "syncNow: token rechazado (401) — limpiando para re-registrar")
                prefs.clearToken()
            } else {
                Log.e(TAG, "syncNow: HTTP ${e.code()} — ${e.message()}")
            }
        } catch (e: Exception) {
            Log.e(TAG, "syncNow: FALLÓ ${e.javaClass.simpleName}: ${e.message}", e)
        }
    }

    private suspend fun downloadAndInstallPackage(token: String, version: Int, packageUrl: String) {
        val api = NetworkModule.provideDeviceApi(token)
        Log.i(TAG, "descargando paquete v$version: $packageUrl")
        val dlResp = api.downloadPackage(packageUrl)
        if (!dlResp.isSuccessful) {
            Log.e(TAG, "HTTP ${dlResp.code()} descargando paquete v$version — se reintenta en el próximo sync")
            return
        }
        val body = dlResp.body() ?: run { Log.e(TAG, "body vacío descargando paquete"); return }
        val hash = dlResp.headers()["X-Playlist-Hash"] ?: ""
        Log.i(TAG, "instalando paquete v$version hash=${hash.take(8)}")
        playlistRepo.installPackage(body, version, hash)
        prefs.setPlaylistVersion(version)
        Log.i(TAG, "paquete v$version instalado — difundiendo actualización")
        withContext(Dispatchers.Main) {
            sendBroadcast(Intent(SyncWorker.ACTION_PLAYLIST_UPDATED).apply { setPackage(packageName) })
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

    // En Device Owner estos permisos ya vienen autoconcedidos (ver KioskManager).
    // Este pedido cubre el caso sin Device Owner: alguien tiene que tocar el
    // diálogo una vez para que el silenciado/colgado de llamadas funcione.
    private fun requestPhonePermissionsIfNeeded() {
        if (prefs.getPhonePermsAsked()) return
        val needed = arrayOf(
            Manifest.permission.READ_PHONE_STATE,
            Manifest.permission.ANSWER_PHONE_CALLS,
        ).filter { ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED }
        if (needed.isNotEmpty()) {
            ActivityCompat.requestPermissions(this, needed.toTypedArray(), PHONE_PERM_REQ)
        }
        prefs.setPhonePermsAsked(true)
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
                        serial = getSerial(),
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
        private const val PHONE_PERM_REQ = 102
        private const val CALL_ROLE_REQ = 103
        // Coseno del ángulo entre la gravedad actual y la de referencia.
        // 0.85 ≈ tolera hasta ~32° de inclinación antes de considerar la
        // lectura ambigua.
        private const val FLIP_COS_THRESHOLD = 0.85f
        // Lecturas consecutivas consistentes requeridas antes de aplicar un
        // cambio de estado — evita que baches/curvas del vehículo disparen
        // el giro por una lectura puntual.
        private const val STABLE_READINGS_REQUIRED = 8
    }
}
