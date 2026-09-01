package com.iconads.player.data.api

import com.iconads.player.data.model.*
import okhttp3.ResponseBody
import retrofit2.Response
import retrofit2.http.*

interface DeviceApi {

    @POST("api/device/register")
    suspend fun register(@Body body: RegisterRequest): RegisterResponse

    @GET("api/device/sync")
    suspend fun sync(
        @Query("version") version: Int,
        @Query("battery") battery: Int? = null,
        @Query("temp") temp: Float? = null,
        @Query("appVersion") appVersion: String? = null,
        @Query("osVersion") osVersion: String? = null,
        @Query("deviceModel") deviceModel: String? = null,
        @Query("brightness") brightness: Int? = null,
        @Query("brightnessAuto") brightnessAuto: Boolean? = null,
        @Query("serial") serial: String? = null,
        @Query("playerOk") playerOk: Boolean? = null,
        @Query("lastAdAgoS") lastAdAgoS: Int? = null,
    ): SyncResponse

    @POST("api/device/screenshot")
    suspend fun uploadScreenshot(@Body body: ScreenshotUpload)

    @Streaming
    @GET
    suspend fun downloadPackage(@Url url: String): Response<ResponseBody>

    @POST("api/device/metrics")
    suspend fun uploadMetrics(@Body metrics: List<MetricUpload>): Map<String, Int>

    @GET("api/device/messages")
    suspend fun getMessages(): List<AdminMessage>

    @POST("api/device/error")
    suspend fun reportError(@Body error: ErrorReport)

    @POST("api/device/location")
    suspend fun uploadLocation(@Body body: LocationUpload)

    @GET("api/device/survey")
    suspend fun getSurvey(): retrofit2.Response<SurveyQuestion>

    @POST("api/device/survey-answer")
    suspend fun submitSurveyAnswer(@Body body: SurveyAnswerRequest)

    @POST("api/device/fcm-token")
    suspend fun updateFcmToken(@Body body: FcmTokenRequest)

    @GET("api/device/apk-version")
    suspend fun getApkVersion(): ApkVersionResponse
}
