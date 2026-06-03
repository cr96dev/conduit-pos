package com.juliabakery.kpbridge

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat

/**
 * Foreground service que aloja BridgeHttpServer. Foreground porque queremos
 * que el bridge sobreviva al backgrounding del sistema y a low-memory kills.
 *
 * Notificacion visible permanentemente en la PAX: "Julia POS Bridge activo
 * en :8081". Tap -> abre MainActivity con el status + config.
 */
class BridgeService : Service() {

    private var server: BridgeHttpServer? = null

    override fun onCreate() {
        super.onCreate()
        crearChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val noti = construirNotificacion()
        startForeground(NOTI_ID, noti)

        if (server == null) {
            try {
                server = BridgeHttpServer(applicationContext, BuildConfig.BRIDGE_PORT).apply {
                    // SOCKET_READ_TIMEOUT 0 = sin timeout (mantiene conexiones largas si hace falta)
                    start(0, false)
                }
                Log.i(TAG, "BridgeHttpServer iniciado en puerto ${BuildConfig.BRIDGE_PORT}")
            } catch (e: Exception) {
                Log.e(TAG, "Fallo arrancando BridgeHttpServer", e)
            }
        }
        return START_STICKY
    }

    override fun onDestroy() {
        try {
            server?.stop()
            server = null
            Log.i(TAG, "BridgeHttpServer detenido")
        } catch (e: Exception) {
            Log.w(TAG, "Error parando server: ${e.message}")
        }
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    // ---------------- notificacion ----------------

    private fun crearChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val ch = NotificationChannel(
                CHANNEL_ID,
                "Julia POS Bridge",
                NotificationManager.IMPORTANCE_LOW,
            ).apply {
                description = "Mantiene el HTTP server activo para recibir cobros del POS"
            }
            getSystemService(NotificationManager::class.java).createNotificationChannel(ch)
        }
    }

    private fun construirNotificacion(): Notification {
        val pending = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Julia POS Bridge")
            .setContentText("Activo en :${BuildConfig.BRIDGE_PORT}")
            .setSmallIcon(android.R.drawable.ic_menu_send)
            .setOngoing(true)
            .setContentIntent(pending)
            .build()
    }

    companion object {
        private const val TAG = "BridgeService"
        private const val CHANNEL_ID = "julia_kpbridge"
        private const val NOTI_ID = 1
    }
}
