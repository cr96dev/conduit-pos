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
import java.io.ByteArrayOutputStream

/**
 * Wrapper sobre el InnerPrinter de Sunmi (servicio AIDL del firmware).
 *
 * Solo aplica en dispositivos Sunmi (D3 Mini, V1s, V2, P1, P2, etc.).
 * En otros devices el bind falla y todas las llamadas devuelven false.
 *
 * Estrategia: usamos UN SOLO metodo del servicio AIDL — sendRAWData(byte[]) —
 * con comandos ESC/POS crudos. Esto evita el problema de TX_CODE-mismatch:
 * el firmware puede haber cambiado el orden de los metodos individuales
 * (setFontSize, setAlignment, printQRCode) entre versiones, pero sendRAWData
 * siempre cumple su contrato. Comprobado: code=-5 "Illegal parameter" cuando
 * llamabamos setAlignment/setFontSize individualmente.
 *
 * Layout del ticket en columnas de 32 caracteres (ancho estandar 58mm Sunmi).
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
                Log.w(TAG, "bindService devolvio false")
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

    fun printTicket(payload: TicketPayload): Boolean {
        val svc = service ?: return false
        return try {
            val texto = construirTextoPlano(payload)
            Log.d(TAG, "printTicket bytes=${texto.length} via printText")
            svc.printText(texto, loggingCb)
            true
        } catch (e: RemoteException) {
            Log.e(TAG, "RemoteException printText", e)
            false
        } catch (e: Exception) {
            Log.e(TAG, "Error printTicket", e)
            false
        }
    }

    // Construye el ticket como texto plano de 32 columnas. Sin ESC/POS,
    // sin setFontSize, sin alignment via comando — solo printText.
    private fun construirTextoPlano(p: TicketPayload): String {
        val W = 32
        fun cen(s: String): String {
            val pad = ((W - s.length) / 2).coerceAtLeast(0)
            return " ".repeat(pad) + s
        }
        fun cols(left: String, right: String): String {
            val pad = (W - left.length - right.length).coerceAtLeast(1)
            return left + " ".repeat(pad) + right
        }
        val sep = "=".repeat(W)
        val sub = "-".repeat(W)

        val sb = StringBuilder()
        sb.append(cen(p.merchantName)).append('\n')
        p.merchantSubtitle?.let { sb.append(cen(it)).append('\n') }
        p.merchantAddress?.let  { sb.append(cen(it)).append('\n') }
        p.merchantNit?.let      { sb.append(cen("NIT: $it")).append('\n') }
        sb.append('\n').append(sep).append('\n')

        sb.append("NIT receptor: ${p.receptorNit}").append('\n')
        sb.append("Nombre: ${p.receptorNombre}").append('\n')
        sb.append("Fecha: ${p.fecha}").append('\n')
        p.cajeroNombre?.let { sb.append("Cajero: $it").append('\n') }
        p.metodoPago?.let   { sb.append("Pago: ${it.uppercase()}").append('\n') }
        sb.append(sub).append('\n')

        for (item in p.items) {
            sb.append(String.format("%-4s%s", item.cantidad, item.descripcion.take(26))).append('\n')
            val precioLinea = String.format("  Q %.2f x %s", item.precioUnitario, item.cantidad)
            val subStr = String.format("Q %.2f", item.subtotal)
            sb.append(cols(precioLinea, subStr)).append('\n')
        }
        sb.append(sub).append('\n')

        sb.append(cols("Subtotal:", String.format("Q %.2f", p.totalGravado))).append('\n')
        sb.append(cols("IVA 12%:", String.format("Q %.2f", p.iva))).append('\n')
        sb.append(cols("TOTAL:", String.format("Q %.2f", p.total))).append('\n')
        sb.append('\n')

        sb.append(cen("Factura Electronica DTE")).append('\n')
        p.uuidSat?.let {
            sb.append(cen("Autorizacion SAT:")).append('\n')
            sb.append(cen(it)).append('\n')
        }
        p.serieSat?.let     { sb.append(cen("Serie: $it")).append('\n') }
        p.numeroSat?.let    { sb.append(cen("Numero: $it")).append('\n') }
        p.certificador?.let { sb.append(cen("Certificador: $it")).append('\n') }

        sb.append('\n').append(cen("Gracias por su compra")).append('\n')
        sb.append("\n\n\n\n\n")  // alimentar papel para corte manual

        return sb.toString()
    }

    // ---------- ESC/POS builder ----------

    private fun construirEscPos(p: TicketPayload): ByteArray {
        val out = ByteArrayOutputStream()
        // Init
        out.write(byteArrayOf(0x1B, 0x40))                            // ESC @ = init
        out.write(byteArrayOf(0x1B, 0x52, 0x12))                      // ESC R 18 = Latin-9 (con tildes/eñe basico)

        // ----- Header centrado, doble alto -----
        out.write(byteArrayOf(0x1B, 0x61, 0x01))                      // ESC a 1 = center
        out.write(byteArrayOf(0x1D, 0x21, 0x11.toByte()))             // GS ! 0x11 = 2x ancho/alto
        out.write((p.merchantName + "\n").toByteArray(Charsets.ISO_8859_1))
        out.write(byteArrayOf(0x1D, 0x21, 0x00))                      // GS ! 0 = normal
        p.merchantSubtitle?.let { out.write((it + "\n").toByteArray(Charsets.ISO_8859_1)) }
        p.merchantAddress?.let  { out.write((it + "\n").toByteArray(Charsets.ISO_8859_1)) }
        p.merchantNit?.let      { out.write(("NIT: $it\n").toByteArray(Charsets.ISO_8859_1)) }
        out.write("\n".toByteArray())

        out.write("================================\n".toByteArray())

        // ----- Receptor (izquierda) -----
        out.write(byteArrayOf(0x1B, 0x61, 0x00))                      // ESC a 0 = left
        out.write(("NIT receptor: ${p.receptorNit}\n").toByteArray(Charsets.ISO_8859_1))
        out.write(("Nombre: ${p.receptorNombre}\n").toByteArray(Charsets.ISO_8859_1))
        out.write(("Fecha: ${p.fecha}\n").toByteArray(Charsets.ISO_8859_1))
        p.cajeroNombre?.let { out.write(("Cajero: $it\n").toByteArray(Charsets.ISO_8859_1)) }
        p.metodoPago?.let   { out.write(("Pago: ${it.uppercase()}\n").toByteArray(Charsets.ISO_8859_1)) }
        out.write("--------------------------------\n".toByteArray())

        // ----- Items -----
        for (item in p.items) {
            val desc = item.descripcion.take(26)
            val cant = item.cantidad
            val subStr = "Q %.2f".format(item.subtotal)
            // linea 1: cant + descripcion
            val l1 = "%-4s%s".format(cant, desc)
            out.write((l1 + "\n").toByteArray(Charsets.ISO_8859_1))
            // linea 2: precio unit ............. subtotal (justificado)
            val precioLinea = "  Q %.2f x %s".format(item.precioUnitario, item.cantidad)
            val padding = 32 - precioLinea.length - subStr.length
            val gap = if (padding > 0) " ".repeat(padding) else " "
            out.write((precioLinea + gap + subStr + "\n").toByteArray(Charsets.ISO_8859_1))
        }
        out.write("--------------------------------\n".toByteArray())

        // ----- Totales -----
        val subtotalLine = "Subtotal:".padEnd(20) + "Q %.2f".format(p.totalGravado).padStart(12)
        val ivaLine      = "IVA 12%:".padEnd(20)  + "Q %.2f".format(p.iva).padStart(12)
        out.write((subtotalLine + "\n").toByteArray(Charsets.ISO_8859_1))
        out.write((ivaLine + "\n").toByteArray(Charsets.ISO_8859_1))

        // TOTAL en doble alto
        out.write(byteArrayOf(0x1D, 0x21, 0x11.toByte()))
        val totalStr = "Q %.2f".format(p.total)
        // En doble ancho usamos 16 chars por linea visualmente
        val totalLine = "TOTAL: ".padEnd(16 - totalStr.length) + totalStr
        out.write((totalLine + "\n").toByteArray(Charsets.ISO_8859_1))
        out.write(byteArrayOf(0x1D, 0x21, 0x00))
        out.write("\n".toByteArray())

        // ----- Footer SAT centrado -----
        out.write(byteArrayOf(0x1B, 0x61, 0x01))                      // center
        out.write("Factura Electronica DTE\n".toByteArray())
        p.uuidSat?.let {
            out.write("Autorizacion SAT:\n".toByteArray())
            out.write((it + "\n").toByteArray(Charsets.ISO_8859_1))
        }
        p.serieSat?.let  { out.write(("Serie: $it\n").toByteArray(Charsets.ISO_8859_1)) }
        p.numeroSat?.let { out.write(("Numero: $it\n").toByteArray(Charsets.ISO_8859_1)) }
        p.certificador?.let { out.write(("Certificador: $it\n").toByteArray(Charsets.ISO_8859_1)) }

        // ----- QR del UUID (ESC/POS estandar) -----
        p.uuidSat?.let { qrData ->
            // GS ( k pL pH cn fn n1 n2 — config QR
            // Model 2
            out.write(byteArrayOf(0x1D, 0x28, 0x6B, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00))
            // Tamaño modulo 6
            out.write(byteArrayOf(0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x43, 0x06))
            // Error correction L
            out.write(byteArrayOf(0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x45, 0x30))
            // Store data: GS ( k pL pH cn fn m data
            val qrBytes = qrData.toByteArray(Charsets.ISO_8859_1)
            val len = qrBytes.size + 3
            val pL = (len and 0xFF).toByte()
            val pH = ((len shr 8) and 0xFF).toByte()
            out.write(byteArrayOf(0x1D, 0x28, 0x6B, pL, pH, 0x31, 0x50, 0x30))
            out.write(qrBytes)
            // Print
            out.write(byteArrayOf(0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x51, 0x30))
        }

        out.write("\n".toByteArray())
        out.write("Gracias por su compra\n".toByteArray())
        out.write("\n\n\n\n".toByteArray())                            // alimentar papel

        // Cut paper (parcial)
        out.write(byteArrayOf(0x1D, 0x56, 0x42, 0x00))                // GS V B 0 = partial cut

        return out.toByteArray()
    }

    private val noopCb = object : ICallback.Stub() {
        override fun onRunResult(isSuccess: Boolean) {
            Log.d(TAG, "noopCb.onRunResult: $isSuccess")
        }
        override fun onReturnString(result: String?) {
            Log.d(TAG, "noopCb.onReturnString: $result")
        }
        override fun onRaiseException(code: Int, msg: String?) {
            Log.w(TAG, "noopCb.onRaiseException code=$code msg=$msg")
        }
        override fun onPrintResult(code: Int, msg: String?) {
            Log.d(TAG, "noopCb.onPrintResult code=$code msg=$msg")
        }
    }

    // Mas verbose para diagnostico
    private val loggingCb = object : ICallback.Stub() {
        override fun onRunResult(isSuccess: Boolean) {
            Log.i(TAG, ">>> printText.onRunResult success=$isSuccess")
        }
        override fun onReturnString(result: String?) {
            Log.i(TAG, ">>> printText.onReturnString: $result")
        }
        override fun onRaiseException(code: Int, msg: String?) {
            Log.e(TAG, ">>> printText.onRaiseException code=$code msg=$msg")
        }
        override fun onPrintResult(code: Int, msg: String?) {
            Log.i(TAG, ">>> printText.onPrintResult code=$code msg=$msg")
        }
    }

    private var connectionHolder: ServiceConnection? = null

    companion object {
        private const val TAG = "SunmiPrinter"
        private const val SUNMI_SERVICE_PACKAGE = "woyou.aidlservice.jiuiv5"
        private const val SUNMI_SERVICE_ACTION = "woyou.aidlservice.jiuiv5.IWoyouService"
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
