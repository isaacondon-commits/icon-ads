package com.iconads.player.data.repository

import android.content.Context
import android.util.Log
import com.google.gson.Gson
import com.iconads.player.data.model.Ad
import com.iconads.player.data.model.PlaylistJson
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.ResponseBody
import java.io.File
import java.io.FileOutputStream
import java.util.zip.ZipInputStream

class PlaylistRepository(private val context: Context) {

    private val currentDir get() = File(context.filesDir, "playlists/current")
    private val backupDir  get() = File(context.filesDir, "playlists/backup")
    private val gson = Gson()

    // ── Fallback 3 niveles ───────────────────────────────────────────────────

    suspend fun loadAds(): List<Ad> = withContext(Dispatchers.IO) {
        loadFromDir(currentDir, LEVEL_CURRENT).takeIf { it.isNotEmpty() }
            ?: run {
                Log.w(TAG, "Current vacío → usando backup")
                loadFromDir(backupDir, LEVEL_BACKUP)
            }.takeIf { it.isNotEmpty() }
            ?: run {
                Log.w(TAG, "Backup vacío → usando institucional")
                institutionalAds()
            }
    }

    private fun loadFromDir(dir: File, level: Int): List<Ad> {
        val playlistFile = File(dir, "playlist.json")
        Log.d(TAG, "loadFromDir nivel=$level dir=$dir existe=${dir.exists()} playlist.json=${playlistFile.exists()}")
        if (!playlistFile.exists()) return emptyList()
        return try {
            val json = gson.fromJson(playlistFile.readText(), PlaylistJson::class.java)
            val mediaDir = File(dir, "media")
            Log.d(TAG, "loadFromDir v${json.version} ads=${json.ads.size} mediaDir=$mediaDir")
            val ads = json.ads
                .map { ad ->
                    val localPath = File(mediaDir, ad.filename).absolutePath
                    val exists = File(localPath).exists()
                    if (!exists) Log.w(TAG, "media no encontrado: $localPath")
                    Ad(
                        id = ad.id,
                        name = ad.name,
                        type = ad.type,
                        filename = ad.filename,
                        localPath = localPath,
                        durationS = ad.durationS,
                        sortOrder = ad.order,
                        campaignId = ad.campaignId,
                        playlistVersion = json.version,
                        level = level,
                    )
                }
                .filter { File(it.localPath).exists() }
                .sortedBy { it.sortOrder }
            Log.i(TAG, "loadFromDir nivel=$level → ${ads.size}/${json.ads.size} ads con media")
            ads
        } catch (e: Exception) {
            Log.e(TAG, "Error leyendo playlist de $dir", e)
            emptyList()
        }
    }

    private fun institutionalAds() = listOf(
        Ad(
            id = -1,
            name = "Institucional",
            type = "video",
            filename = "institutional",
            localPath = "android.resource://${context.packageName}/raw/institutional",
            durationS = 30,
            sortOrder = 0,
            campaignId = -1,
            playlistVersion = 0,
            level = LEVEL_INSTITUTIONAL,
        )
    )

    // ── Descarga e instalación del ZIP ───────────────────────────────────────

    suspend fun installPackage(body: ResponseBody, version: Int, expectedHash: String) =
        withContext(Dispatchers.IO) {
            val tempZip = File(context.cacheDir, "playlist_v$version.zip")
            body.byteStream().use { input ->
                FileOutputStream(tempZip).use { out -> input.copyTo(out) }
            }
            try {
                // Rotar: current → backup
                if (currentDir.exists()) {
                    backupDir.deleteRecursively()
                    currentDir.copyRecursively(backupDir, overwrite = true)
                }
                // Extraer ZIP en current/
                currentDir.deleteRecursively()
                currentDir.mkdirs()
                extractZip(tempZip, currentDir)

                // Validar hash
                val playlistFile = File(currentDir, "playlist.json")
                val playlistJson = gson.fromJson(playlistFile.readText(), PlaylistJson::class.java)
                if (expectedHash.isNotBlank() && expectedHash != playlistJson.hash) {
                    throw SecurityException("Hash inválido: esperado=$expectedHash recibido=${playlistJson.hash}")
                }
                Log.i(TAG, "Playlist v$version instalada (${playlistJson.ads.size} ads)")
            } catch (e: Exception) {
                // Restore backup so the player keeps working
                Log.w(TAG, "Error instalando v$version — restaurando backup", e)
                try {
                    if (backupDir.exists()) {
                        currentDir.deleteRecursively()
                        backupDir.copyRecursively(currentDir, overwrite = true)
                        Log.i(TAG, "Backup restaurado exitosamente")
                    }
                } catch (restoreEx: Exception) {
                    Log.e(TAG, "Error restaurando backup", restoreEx)
                }
                throw e
            } finally {
                tempZip.delete()
            }
        }

    private fun extractZip(zip: File, destDir: File) {
        val destCanonicalPath = destDir.canonicalPath
        ZipInputStream(zip.inputStream().buffered()).use { zis ->
            var entry = zis.nextEntry
            while (entry != null) {
                val dest = File(destDir, entry.name)
                // Zip Slip guard: reject entries that would escape destDir via ../ traversal.
                if (!dest.canonicalPath.startsWith(destCanonicalPath + File.separator)) {
                    throw SecurityException("Entrada de ZIP fuera de destino: ${entry.name}")
                }
                if (entry.isDirectory) {
                    dest.mkdirs()
                } else {
                    dest.parentFile?.mkdirs()
                    FileOutputStream(dest).use { out -> zis.copyTo(out) }
                }
                zis.closeEntry()
                entry = zis.nextEntry
            }
        }
    }

    companion object {
        private const val TAG = "PlaylistRepo"
        const val LEVEL_CURRENT = 1
        const val LEVEL_BACKUP = 2
        const val LEVEL_INSTITUTIONAL = 3
    }
}
