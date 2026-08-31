package com.iconads.player

import android.os.Build
import android.telecom.Call
import android.telecom.CallScreeningService
import android.util.Log

/**
 * Kiosco: la tablet no tiene que sonar ni mostrar llamadas. Este servicio
 * rechaza toda llamada entrante ANTES de que suene el tono.
 *
 * Sólo recibe callbacks si la app tiene el rol `ROLE_CALL_SCREENING`
 * (Android 10+), que se pide una vez desde PlayerActivity. Sin el rol, queda
 * como fallback el PhoneStateListener (recupera el foco + intenta colgar).
 */
class CallBlockerService : CallScreeningService() {

    override fun onScreenCall(callDetails: Call.Details) {
        val builder = CallResponse.Builder()

        val incoming = Build.VERSION.SDK_INT < Build.VERSION_CODES.Q ||
            callDetails.callDirection == Call.Details.DIRECTION_INCOMING

        if (incoming) {
            builder.setDisallowCall(true)
                .setRejectCall(true)
                .setSkipCallLog(false)
                .setSkipNotification(true)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                builder.setSilenceCall(true)
            }
            Log.i(TAG, "Llamada entrante rechazada (kiosco)")
        }

        respondToCall(callDetails, builder.build())
    }

    companion object {
        private const val TAG = "CallBlockerService"
    }
}
