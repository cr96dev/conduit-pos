package com.juliabakery.kpbridge

import android.content.Context
import android.content.SharedPreferences

/**
 * Config persistida en SharedPreferences. Ediable desde la UI del bridge.
 *
 * Los valores los usa KpSaleActivity para construir la llamada a KP_Sale:
 *   KP_Invocador(mposURL, ctx).KP_Sale(user, password, deviceID, amount, ...)
 *
 * mposURL es el package name del app SmartPOS instalado en la PAX. El AAR
 * default usa "com.kinpos.BASEA920" pero el CREKPS (BAC) podria tener otro.
 * Lo detectamos al primer launch corriendo pm list packages.
 */
class Config(ctx: Context) {

    private val prefs: SharedPreferences =
        ctx.applicationContext.getSharedPreferences("kpbridge", Context.MODE_PRIVATE)

    var mposUrl: String
        get() = prefs.getString(K_MPOS_URL, BuildConfig.MPOS_URL) ?: BuildConfig.MPOS_URL
        set(v) = prefs.edit().putString(K_MPOS_URL, v).apply()

    var user: String
        get() = prefs.getString(K_USER, "") ?: ""
        set(v) = prefs.edit().putString(K_USER, v.trim()).apply()

    var password: String
        get() = prefs.getString(K_PASS, "") ?: ""
        set(v) = prefs.edit().putString(K_PASS, v).apply()

    var deviceId: String
        get() = prefs.getString(K_DEVICE, "") ?: ""
        set(v) = prefs.edit().putString(K_DEVICE, v.trim()).apply()

    /** Email default para los recibos. El cliente puede override en cada venta. */
    var defaultEmail: String
        get() = prefs.getString(K_EMAIL, "") ?: ""
        set(v) = prefs.edit().putString(K_EMAIL, v.trim()).apply()

    /** Habilita logs verbose (no recomendado en produccion: leak de PII). */
    var debugLog: Boolean
        get() = prefs.getBoolean(K_DEBUG, BuildConfig.DEBUG_LOG)
        set(v) = prefs.edit().putBoolean(K_DEBUG, v).apply()

    /** Returns true si las credenciales minimas estan presentes. */
    fun esValida(): Boolean = user.isNotBlank() && password.isNotBlank() && deviceId.isNotBlank()

    companion object {
        private const val K_MPOS_URL = "mpos_url"
        private const val K_USER     = "user"
        private const val K_PASS     = "password"
        private const val K_DEVICE   = "device_id"
        private const val K_EMAIL    = "default_email"
        private const val K_DEBUG    = "debug_log"
    }
}
