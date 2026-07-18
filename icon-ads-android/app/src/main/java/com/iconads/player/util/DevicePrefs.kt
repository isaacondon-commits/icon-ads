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

    companion object {
        private const val KEY_TOKEN = "device_token"
        private const val KEY_VERSION = "playlist_version"
        private const val KEY_TABLET_ID = "tablet_id"

        fun getDeviceId(context: Context): String =
            Settings.Secure.getString(context.contentResolver, Settings.Secure.ANDROID_ID)
                ?: "unknown-${System.currentTimeMillis()}"
    }
}
