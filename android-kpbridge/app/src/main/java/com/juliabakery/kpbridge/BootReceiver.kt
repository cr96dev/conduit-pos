package com.juliabakery.kpbridge

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Arranca BridgeService al boot del device para que el HTTP server este
 * disponible siempre, sin que un humano tenga que abrir la app.
 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        if (intent?.action == Intent.ACTION_BOOT_COMPLETED) {
            val svc = Intent(context, BridgeService::class.java)
            if (android.os.Build.VERSION.SDK_INT >= 26) {
                context.startForegroundService(svc)
            } else {
                context.startService(svc)
            }
        }
    }
}
