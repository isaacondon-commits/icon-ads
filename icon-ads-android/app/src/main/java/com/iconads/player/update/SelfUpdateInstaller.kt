package com.iconads.player.update

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.os.Build
import android.util.Log
import java.io.File

/**
 * Instala una APK nueva sobre la app actual usando [PackageInstaller].
 *
 *  - **Device Owner**: instalación 100% silenciosa. Se aplica sola, la app se
 *    reinicia en la versión nueva y [com.iconads.player.receiver.BootReceiver]
 *    (acción `MY_PACKAGE_REPLACED`) vuelve a levantar el player.
 *  - **Sin Device Owner, API 31+**: se pide `USER_ACTION_NOT_REQUIRED`. El
 *    sistema puede exigir UNA confirmación la primera vez, hasta que esta app
 *    quede registrada como "installer of record"; a partir de ahí, silenciosa.
 *  - **Sin Device Owner, API < 31**: siempre aparece el instalador del sistema
 *    (alguien toca "Instalar") — ver [UpdateInstallReceiver].
 *
 * Para una flota grande: provisionar las tablets como Device Owner (QR /
 * zero-touch), así todas las actualizaciones futuras son automáticas.
 */
object SelfUpdateInstaller {
    private const val TAG = "SelfUpdateInstaller"
    const val ACTION_INSTALL_RESULT = "com.iconads.player.INSTALL_RESULT"

    /** @return true si la sesión se creó y se hizo commit sin error sincrónico. */
    fun install(context: Context, apkFile: File): Boolean {
        if (!apkFile.exists() || apkFile.length() == 0L) {
            Log.e(TAG, "APK inexistente o vacía: ${apkFile.absolutePath}")
            return false
        }
        val installer = context.packageManager.packageInstaller
        val params = PackageInstaller.SessionParams(
            PackageInstaller.SessionParams.MODE_FULL_INSTALL
        ).apply {
            setAppPackageName(context.packageName)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED)
            }
        }

        var sessionId = -1
        return try {
            sessionId = installer.createSession(params)
            installer.openSession(sessionId).use { session ->
                session.openWrite("iconads_update", 0, apkFile.length()).use { out ->
                    apkFile.inputStream().use { it.copyTo(out) }
                    session.fsync(out)
                }
                val intent = Intent(ACTION_INSTALL_RESULT).setPackage(context.packageName)
                val piFlags = PendingIntent.FLAG_UPDATE_CURRENT or
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S)
                        PendingIntent.FLAG_MUTABLE else 0
                val pi = PendingIntent.getBroadcast(context, sessionId, intent, piFlags)
                session.commit(pi.intentSender)
            }
            Log.i(TAG, "Sesión $sessionId enviada — esperando resultado del sistema")
            true
        } catch (e: Exception) {
            Log.e(TAG, "Falló la instalación (sesión $sessionId): ${e.message}", e)
            if (sessionId != -1) try { installer.abandonSession(sessionId) } catch (_: Exception) {}
            false
        }
    }
}
