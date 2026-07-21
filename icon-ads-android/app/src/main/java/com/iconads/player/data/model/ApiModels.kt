package com.iconads.player.data.model

data class RegisterRequest(
    val deviceId: String,
    val name: String,
    val zone: String? = null,
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
