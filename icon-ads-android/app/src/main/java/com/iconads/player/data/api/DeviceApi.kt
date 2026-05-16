package com.iconads.player.data.api

import com.iconads.player.data.model.*
import okhttp3.ResponseBody
import retrofit2.Response
import retrofit2.http.*

interface DeviceApi {

    @POST("api/device/register")
    suspend fun register(@Body body: RegisterRequest): RegisterResponse

    @GET("api/device/sync")
    suspend fun sync(@Query("version") version: Int): SyncResponse

    @Streaming
    @GET
    suspend fun downloadPackage(@Url url: String): Response<ResponseBody>

    @POST("api/device/metrics")
    suspend fun uploadMetrics(@Body metrics: List<MetricUpload>): Map<String, Int>

    @POST("api/device/error")
    suspend fun reportError(@Body error: ErrorReport)
}
