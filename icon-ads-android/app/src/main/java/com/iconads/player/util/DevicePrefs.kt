package com.iconads.player.util

import android.content.Context
import android.provider.Settings

class DevicePrefs(context: Context) {

    private val prefs = context.getSharedPreferences("iconads_prefs", Context.MODE_PRIVATE)

    fun getToken(): String? = prefs.getString(KEY_TOKEN, null)
    fun setToken(token: String) = prefs.edit().putString(KEY_TOKEN, token).apply()
    fun clearToken() = prefs.edit().remove(KEY_TOKEN).apply()

    fun getPlaylistVersion(): Int = prefs.getInt(KEY_VERSION, 0)
    fun setPlaylistVersion(v: Int) = prefs.edit().putInt(KEY_VERSION, v).apply()

    fun getTabletId(): Int = prefs.getInt(KEY_TABLET_ID, -1)
    fun setTabletId(id: Int) = prefs.edit().putInt(KEY_TABLET_ID, id).apply()

    // Latest FCM token seen locally (from FirebaseMessaging or onNewToken) vs.
    // the last one successfully confirmed sent to the backend — SyncWorker
    // resends whenever these two differ.
    fun getFcmToken(): String? = prefs.getString(KEY_FCM_TOKEN, null)
    fun setFcmToken(token: String) = prefs.edit().putString(KEY_FCM_TOKEN, token).apply()
    fun getFcmTokenSent(): String? = prefs.getString(KEY_FCM_TOKEN_SENT, null)
    fun setFcmTokenSent(token: String) = prefs.edit().putString(KEY_FCM_TOKEN_SENT, token).apply()

    // Manual 180° screen flip, set per-tablet from the admin panel — fixes
    // playback appearing upside down when the mount puts the charger
    // connector on the opposite side from what the OS considers "landscape".
    // Combined with the sensor-based auto-detection (see gravity reference
    // below) via XOR: this stays as an override for mounts the sensor gets
    // wrong, while the sensor handles the common case of someone physically
    // flipping the tablet.
    fun getRotated180(): Boolean = prefs.getBoolean(KEY_ROTATED_180, false)
    fun setRotated180(value: Boolean) = prefs.edit().putBoolean(KEY_ROTATED_180, value).apply()

    // Gravity vector captured on the tablet's first-ever boot, used as the
    // "this is how it was mounted correctly" baseline. Auto-rotation later
    // compares live gravity readings against this reference — set once and
    // never overwritten, so a later physical 180° flip is what gets detected
    // (see PlayerActivity's gravity listener).
    fun hasGravityReference(): Boolean = prefs.contains(KEY_GRAVITY_REF_X)
    fun getGravityReference(): FloatArray = floatArrayOf(
        prefs.getFloat(KEY_GRAVITY_REF_X, 0f),
        prefs.getFloat(KEY_GRAVITY_REF_Y, 0f),
        prefs.getFloat(KEY_GRAVITY_REF_Z, 0f),
    )
    fun setGravityReference(x: Float, y: Float, z: Float) = prefs.edit()
        .putFloat(KEY_GRAVITY_REF_X, x)
        .putFloat(KEY_GRAVITY_REF_Y, y)
        .putFloat(KEY_GRAVITY_REF_Z, z)
        .apply()

    // Last APK versionCode we already downloaded + prompted to install — avoids
    // re-downloading and re-showing the install dialog every sync cycle for a
    // version the tablet already offered (the person may just not have walked
    // by yet to tap "Install").
    fun getPromptedApkVersion(): Int = prefs.getInt(KEY_PROMPTED_APK_VERSION, 0)
    fun setPromptedApkVersion(v: Int) = prefs.edit().putInt(KEY_PROMPTED_APK_VERSION, v).apply()

    companion object {
        private const val KEY_TOKEN = "device_token"
        private const val KEY_VERSION = "playlist_version"
        private const val KEY_TABLET_ID = "tablet_id"
        private const val KEY_FCM_TOKEN = "fcm_token"
        private const val KEY_FCM_TOKEN_SENT = "fcm_token_sent"
        private const val KEY_ROTATED_180 = "rotated_180"
        private const val KEY_GRAVITY_REF_X = "gravity_ref_x"
        private const val KEY_GRAVITY_REF_Y = "gravity_ref_y"
        private const val KEY_GRAVITY_REF_Z = "gravity_ref_z"
        private const val KEY_PROMPTED_APK_VERSION = "prompted_apk_version"

        fun getDeviceId(context: Context): String =
            Settings.Secure.getString(context.contentResolver, Settings.Secure.ANDROID_ID)
                ?: "unknown-${System.currentTimeMillis()}"
    }
}
