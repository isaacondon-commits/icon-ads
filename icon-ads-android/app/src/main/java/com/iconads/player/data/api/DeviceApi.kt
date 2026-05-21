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
    ): SyncResponse

    @Streaming
    @GET
    suspend fun downloadPackage(@Url url: String): Response<ResponseBody>

    @POST("api/device/metrics")
    suspend fun uploadMetrics(@Body metrics: List<MetricUpload>): Map<String, Int>

    @GET("api/device/messages")
    suspend fun getMessages(): List<AdminMessage>

    @POST("api/device/error")
    suspend fun reportError(@Body error: ErrorReport)

    @GET("api/device/survey")
    suspend fun getSurvey(): retrofit2.Response<SurveyQuestion>

    @POST("api/device/survey-answer")
    suspend fun submitSurveyAnswer(@Body body: SurveyAnswerRequest)
}
