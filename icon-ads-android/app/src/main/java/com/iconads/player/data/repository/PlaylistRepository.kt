package com.iconads.player.data.repository

import android.content.Context
import android.util.Log
import com.google.gson.Gson
import com.iconads.player.data.db.AppDatabase
import com.iconads.player.data.db.entity.AdEntity
import com.iconads.player.data.model.PlaylistJson
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.ResponseBody
import java.io.File
import java.io.FileOutputStream
import java.util.zip.ZipInputStream

class PlaylistRepository(private val context: Context) {

    private val db = AppDatabase.get(context)
    private val currentDir get() = File(context.filesDir, "playlists/current")
    private val backupDir get() = File(context.filesDir, "playlists/backup")

    // ── Fallback 3 niveles ──────────────────────────────────────────────────

    suspend fun loadAds(): List<AdEntity> {
        val current = db.adDao().getByLevel(LEVEL_CURRENT)
        if (current.isNotEmpty() && current.allFilesExist()) {
            Log.d(TAG, "Usando playlist actual (${current.size} ads)")
            return current
        }

        val backup = db.adDao().getByLevel(LEVEL_BACKUP)
        if (backup.isNotEmpty() && backup.allFilesExist()) {
            Log.w(TAG, "Fallback → playlist backup (${backup.size} ads)")
            return backup
        }

        Log.w(TAG, "Fallback → contenido institucional")
        return institutionalAds()
    }

    private fun List<AdEntity>.allFilesExist() = all { File(it.localPath).exists() }

    private fun institutionalAds(): List<AdEntity> {
        // Retorna un anuncio institucional desde res/raw/institutional
        val uri = "android.resource://${context.packageName}/raw/institutional"
        return listOf(
            AdEntity(
                id = -1,
                name = "Institucional",
                type = "video",
                filename = "institutional",
                localPath = uri,
                durationS = 30,
                sortOrder = 0,
                campaignId = -1,
                playlistVersion = 0,
                level = LEVEL_INSTITUTIONAL,
            )
        )
    }

    // ── Descarga e instalación del paquete ZIP ──────────────────────────────

    suspend fun installPackage(body: ResponseBody, version: Int, expectedHash: String) =
        withContext(Dispatchers.IO) {
            val tempZip = File(context.cacheDir, "playlist_v$version.zip")

            // 1. Descargar ZIP
            body.byteStream().use { input ->
                FileOutputStream(tempZip).use { output -> input.copyTo(output) }
            }

            try {
                // 2. Rotar: current → backup
                if (currentDir.exists()) {
                    backupDir.deleteRecursively()
                    currentDir.copyRecursively(backupDir, overwrite = true)
                }

                // 3. Extraer ZIP en current/
                currentDir.deleteRecursively()
                currentDir.mkdirs()
                extractZip(tempZip, currentDir)

                // 4. Parsear y validar playlist.json
                val playlistFile = File(currentDir, "playlist.json")
                val playlistJson = Gson().fromJson(playlistFile.readText(), PlaylistJson::class.java)

                if (expectedHash.isNotBlank() && expectedHash != playlistJson.hash) {
                    throw SecurityException("Hash inválido: esperado $expectedHash, recibido ${playlistJson.hash}")
                }

                // 5. Actualizar Room — nivel current
                val mediaDir = File(currentDir, "media")
                val entities = playlistJson.ads.map { ad ->
                    AdEntity(
                        id = ad.id,
                        name = ad.name,
                        type = ad.type,
                        filename = ad.filename,
                        localPath = File(mediaDir, ad.filename).absolutePath,
                        durationS = ad.durationS,
                        sortOrder = ad.order,
                        campaignId = ad.campaignId,
                        playlistVersion = version,
                        level = LEVEL_CURRENT,
                    )
                }
                db.adDao().replaceLevel(LEVEL_CURRENT, entities)

                // 6. Actualizar backup en Room con los anteriores
                val backupMediaDir = File(backupDir, "media")
                if (backupMediaDir.exists()) {
                    val backupFile = File(backupDir, "playlist.json")
                    if (backupFile.exists()) {
                        val bJson = Gson().fromJson(backupFile.readText(), PlaylistJson::class.java)
                        val backupEntities = bJson.ads.map { ad ->
                            AdEntity(
                                id = ad.id,
                                name = ad.name,
                                type = ad.type,
                                filename = ad.filename,
                                localPath = File(backupMediaDir, ad.filename).absolutePath,
                                durationS = ad.durationS,
                                sortOrder = ad.order,
                                campaignId = ad.campaignId,
                                playlistVersion = bJson.version,
                                level = LEVEL_BACKUP,
                            )
                        }
                        db.adDao().replaceLevel(LEVEL_BACKUP, backupEntities)
                    }
                }

                Log.i(TAG, "Playlist v$version instalada (${entities.size} ads)")
            } finally {
                tempZip.delete()
            }
        }

    private fun extractZip(zip: File, destDir: File) {
        ZipInputStream(zip.inputStream().buffered()).use { zis ->
            var entry = zis.nextEntry
            while (entry != null) {
                val dest = File(destDir, entry.name)
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
