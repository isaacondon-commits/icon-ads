package com.iconads.player.data.model

data class RegisterRequest(
    val deviceId: String,
    val name: String,
    val zone: String? = null,
    val serial: String? = null,
)

data class RegisterResponse(
    val token: String,
    val tabletId: Int,
)

data class SyncResponse(
    val needsUpdate: Boolean,
    val version: Int,
    val packageUrl: String? = null,
    val message: String? = null,
    val rotated180: Boolean = false,
    // El admin tocó "Forzar actualización" en el panel: encolar SyncWorker ya
    // (que corre checkApkUpdate), sin esperar el push FCM ni el ciclo horario.
    val forceApkCheck: Boolean = false,
    // Modo test: la tablet ignora el desenchufe y el cierre por 10 min de
    // inactividad (kiosco siempre prendido, botón de encendido = on/off).
    val testMode: Boolean = false,
    // Política de brillo: "auto" o un número 0-255 (brillo fijo).
    val brightnessPolicy: String? = null,
)

data class HeartbeatInfo(
    val battery: Int?,
    val temp: Float?,
    val appVersion: String,
)

data class MetricUpload(
    val adId: Int,
    val campaignId: Int,
    val playedAt: String,   // ISO-8601
    val durationPlayedS: Int,
    val completed: Boolean,
    val error: Boolean,
)

data class ErrorReport(
    val errorType: String,
    val message: String,
    val occurredAt: String,
)

data class AdminMessage(
    val id: Int,
    val message: String,
    val createdAt: String,
)

data class SurveyQuestion(
    val id: Int,
    val question: String,
    val options: List<String>,
)

data class SurveyAnswerRequest(
    val surveyId: Int,
    val optionIndex: Int,
)

data class LocationUpload(
    val lat: Double,
    val lng: Double,
    val accuracy: Float?,
    val timestamp: String,
)

data class FcmTokenRequest(
    val token: String,
)

data class ApkVersionResponse(
    val versionCode: Int?,
    val versionName: String?,
    val url: String?,
    // El admin forzó re-chequeo desde el panel: ignorar el guard local de
    // "esta versión ya la intenté" (promptedApkVersion).
    val force: Boolean = false,
)
