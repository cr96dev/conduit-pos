package com.juliabakery.pos

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.os.IBinder
import android.os.RemoteException
import android.util.Log
import kotlinx.serialization.Serializable
import woyou.aidlservice.jiuiv5.ICallback
import woyou.aidlservice.jiuiv5.IWoyouService

/**
 * Wrapper sobre el InnerPrinter de Sunmi (servicio AIDL en el firmware).
 *
 * Solo aplica en dispositivos Sunmi (D3 Mini, V1s, V2, P1, P2, S2, T2, etc.).
 * En otros devices el bind falla y todas las llamadas devuelven false.
 *
 * Uso:
 *   sunmiPrinter.bind(context) { connected -> ... }
 *   sunmiPrinter.printTicket(payload) { ok -> ... }
 *   sunmiPrinter.unbind(context)
 *
 * Modelo de impresion:
 *   - Cada operacion usa enterPrinterBuffer/exitPrinterBuffer para que todo
 *     el ticket salga atomico (no bloquea ni interrumpe a otra app).
 *   - Los ICallback se ignoran salvo para detectar exception en el servicio.
 *
 * Conservador sobre fonts: usamos la default (Sunmi viene con una sans serif).
 * Sizes: 24 = normal, 32 = grande, 16 = chico.
 */
class SunmiPrinter {

    @Volatile private var service: IWoyouService? = null
    @Volatile private var binding = false

    fun isConnected(): Boolean = service != null

    fun bind(context: Context, onConnect: ((Boolean) -> Unit)? = null) {
        if (service != null) { onConnect?.invoke(true); return }
        if (binding) return
        binding = true
        val intent = Intent().apply {
            setPackage(SUNMI_SERVICE_PACKAGE)
            action = SUNMI_SERVICE_ACTION
        }
        val conn = object : ServiceConnection {
            override fun onServiceConnected(name: ComponentName?, binder: IBinder?) {
                service = IWoyouService.Stub.asInterface(binder)
                binding = false
                Log.d(TAG, "Sunmi InnerPrinter conectado")
                onConnect?.invoke(true)
            }
            override fun onServiceDisconnected(name: ComponentName?) {
                service = null
                Log.w(TAG, "Sunmi InnerPrinter desconectado")
            }
        }
        connectionHolder = conn
        try {
            val ok = context.applicationContext.bindService(intent, conn, Context.BIND_AUTO_CREATE)
            if (!ok) {
                binding = false
                Log.w(TAG, "bindService devolvio false — no es Sunmi o servicio caido")
                onConnect?.invoke(false)
            }
        } catch (e: Exception) {
            binding = false
            Log.e(TAG, "bindService threw", e)
            onConnect?.invoke(false)
        }
    }

    fun unbind(context: Context) {
        connectionHolder?.let {
            try { context.applicationContext.unbindService(it) } catch (_: Exception) {}
        }
        connectionHolder = null
        service = null
    }

    /**
     * Imprime un ticket de venta con layout estandar:
     *   - Header (logo texto, sucursal)
     *   - Datos receptor (NIT, nombre)
     *   - Tabla de items
     *   - Subtotales + total
     *   - Footer SAT (UUID, serie, numero)
     *   - QR del UUID
     *   - Mensaje gracias
     *
     * Devuelve true si todo el batch se mando al buffer y se hizo commit OK.
     * Si el servicio no esta bindeado, devuelve false y no hace nada.
     */
    fun printTicket(payload: TicketPayload): Boolean {
        val svc = service ?: run {
            Log.w(TAG, "printTicket llamado sin servicio bindeado")
            return false
        }
        return try {
            svc.enterPrinterBuffer(true)

            // Header
            svc.setAlignment(ALIGN_CENTER, noopCb)
            svc.setFontSize(32f, noopCb)
            svc.printText("${payload.merchantName}\n", noopCb)

            svc.setFontSize(20f, noopCb)
            payload.merchantSubtitle?.let { svc.printText("$it\n", noopCb) }
            payload.merchantAddress?.let { svc.printText("$it\n", noopCb) }
            payload.merchantNit?.let { svc.printText("NIT: $it\n", noopCb) }
            svc.lineWrap(1, noopCb)

            svc.printText("${"=".repeat(32)}\n", noopCb)

            // Receptor
            svc.setAlignment(ALIGN_LEFT, noopCb)
            svc.printText("NIT receptor: ${payload.receptorNit}\n", noopCb)
            svc.printText("Nombre: ${payload.receptorNombre}\n", noopCb)
            svc.printText("Fecha: ${payload.fecha}\n", noopCb)
            payload.cajeroNombre?.let { svc.printText("Cajero: $it\n", noopCb) }
            payload.metodoPago?.let { svc.printText("Pago: ${it.uppercase()}\n", noopCb) }
            svc.printText("${"-".repeat(32)}\n", noopCb)

            // Items: 3 columnas — cantidad, descripcion, total
            for (item in payload.items) {
                val cant = item.cantidad
                val desc = item.descripcion.take(28)
                val sub = "Q %.2f".format(item.subtotal)

                // Linea 1: cantidad + descripcion (max 28 chars)
                svc.printText("%-4s%s\n".format(cant, desc), noopCb)
                // Linea 2: precio_unitario x cantidad ............. subtotal
                val precioLinea = "  Q %.2f x %s".format(item.precioUnitario, item.cantidad)
                val padding = 32 - precioLinea.length - sub.length
                val gap = if (padding > 0) " ".repeat(padding) else " "
                svc.printText("$precioLinea$gap$sub\n", noopCb)
            }
            svc.printText("${"-".repeat(32)}\n", noopCb)

            // Totales
            svc.setFontSize(24f, noopCb)
            val subtotalLine = "Subtotal:".padEnd(20) + "Q %.2f".format(payload.totalGravado).padStart(12)
            svc.printText("$subtotalLine\n", noopCb)
            val ivaLine = "IVA 12%:".padEnd(20) + "Q %.2f".format(payload.iva).padStart(12)
            svc.printText("$ivaLine\n", noopCb)

            svc.setFontSize(32f, noopCb)
            val totalLine = "TOTAL:".padEnd(15) + "Q %.2f".format(payload.total).padStart(15)
            svc.printText("$totalLine\n", noopCb)
            svc.lineWrap(1, noopCb)

            // Footer SAT
            svc.setAlignment(ALIGN_CENTER, noopCb)
            svc.setFontSize(20f, noopCb)
            svc.printText("Factura Electronica DTE\n", noopCb)
            payload.uuidSat?.let {
                svc.printText("Autorizacion SAT:\n", noopCb)
                svc.setFontSize(18f, noopCb)
                svc.printText("$it\n", noopCb)
                svc.setFontSize(20f, noopCb)
            }
            payload.serieSat?.let { svc.printText("Serie: $it\n", noopCb) }
            payload.numeroSat?.let { svc.printText("Numero: $it\n", noopCb) }
            payload.certificador?.let { svc.printText("Certificador: $it\n", noopCb) }

            // QR si tenemos UUID
            payload.uuidSat?.let {
                svc.lineWrap(1, noopCb)
                svc.printQRCode(it, 6, 3, noopCb)
            }

            svc.lineWrap(1, noopCb)
            svc.printText("Gracias por su compra\n", noopCb)
            svc.lineWrap(4, noopCb)

            svc.exitPrinterBuffer(true)
            true
        } catch (e: RemoteException) {
            Log.e(TAG, "RemoteException imprimiendo", e)
            try { svc.exitPrinterBuffer(false) } catch (_: Exception) {}
            false
        } catch (e: Exception) {
            Log.e(TAG, "Error imprimiendo", e)
            try { svc.exitPrinterBuffer(false) } catch (_: Exception) {}
            false
        }
    }

    private val noopCb = object : ICallback.Stub() {
        override fun onRunResult(isSuccess: Boolean) {}
        override fun onReturnString(result: String?) {}
        override fun onRaiseException(code: Int, msg: String?) {
            Log.w(TAG, "printer exception code=$code msg=$msg")
        }
        override fun onPrintResult(code: Int, msg: String?) {}
    }

    private var connectionHolder: ServiceConnection? = null

    companion object {
        private const val TAG = "SunmiPrinter"
        private const val SUNMI_SERVICE_PACKAGE = "woyou.aidlservice.jiuiv5"
        private const val SUNMI_SERVICE_ACTION = "woyou.aidlservice.jiuiv5.IWoyouService"
        const val ALIGN_LEFT = 0
        const val ALIGN_CENTER = 1
        const val ALIGN_RIGHT = 2
    }
}

@Serializable
data class TicketPayload(
    val merchantName: String,
    val merchantSubtitle: String? = null,
    val merchantAddress: String? = null,
    val merchantNit: String? = null,
    val receptorNit: String,
    val receptorNombre: String,
    val fecha: String,
    val cajeroNombre: String? = null,
    val metodoPago: String? = null,
    val items: List<TicketItem>,
    val totalGravado: Double,
    val iva: Double,
    val total: Double,
    val uuidSat: String? = null,
    val serieSat: String? = null,
    val numeroSat: String? = null,
    val certificador: String? = null,
)

@Serializable
data class TicketItem(
    val descripcion: String,
    val cantidad: String,
    val precioUnitario: Double,
    val subtotal: Double,
)
