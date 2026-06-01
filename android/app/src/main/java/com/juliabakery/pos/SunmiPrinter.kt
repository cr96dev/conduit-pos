package com.juliabakery.pos

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.os.IBinder
import android.os.RemoteException
import android.util.Log
import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.qrcode.QRCodeWriter
import com.google.zxing.qrcode.decoder.ErrorCorrectionLevel
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
    @Volatile private var logoBitmap: Bitmap? = null

    fun isConnected(): Boolean = service != null

    fun bind(context: Context, onConnect: ((Boolean) -> Unit)? = null) {
        if (service != null) { onConnect?.invoke(true); return }
        if (binding) return
        binding = true
        // Cargar logo una vez (lo usamos en cada printTicket)
        try {
            logoBitmap = BitmapFactory.decodeResource(context.resources, R.drawable.logo_julia)
            Log.d(TAG, "logo cargado: ${logoBitmap?.width}x${logoBitmap?.height}")
        } catch (e: Exception) {
            Log.w(TAG, "no pude cargar logo: ${e.message}")
        }
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
            // Usamos sendRAWData (no printText + exitPrinterBuffer) para
            // evitar el auto-kick implicito del firmware Sunmi InnerPrinter.

            // 1. Logo bitmap arriba (no para cierre de turno ni comanda — son operativos)
            if (!payload.esCierreTurno && !payload.esComanda) {
                logoBitmap?.let { bmp ->
                    try {
                        svc.setAlignment(1, noopCb)
                        svc.printBitmap(bmp, noopCb)
                        svc.lineWrap(1, noopCb)
                        svc.setAlignment(0, noopCb)
                    } catch (e: Exception) {
                        Log.w(TAG, "printBitmap fallo, sigo sin logo: ${e.message}")
                    }
                }
            }

            // 2. Cuerpo del ticket (texto ESC/POS, sin cut al final)
            val texto = when {
                payload.esComanda -> construirTextoComanda(payload)
                payload.esCierreTurno -> construirTextoCierreTurno(payload)
                else -> construirTextoPlano(payload)
            }
            val bytes = wrapEscPosSinCut(texto)
            Log.d(TAG, "printTicket bytes=${bytes.size} esCierreTurno=${payload.esCierreTurno} esComanda=${payload.esComanda}")
            svc.sendRAWData(bytes, loggingCb)

            // 3. QR de verificacion SAT — solo en facturas FEL (no en cierre ni comanda).
            //    El cliente lo escanea y SAT le muestra su factura digital.
            //    URL felpub.c.sat.gob.gt con UUID + NIT emisor + NIT receptor + monto
            //    (Reglas FEL pag. 137). Logo de Julia superpuesto en el centro.
            if (!payload.esCierreTurno && !payload.esComanda && !payload.uuidSat.isNullOrBlank()) {
                try {
                    val url = construirUrlSat(payload)
                    val qrBmp = generarQRConLogo(url, logoBitmap)
                    svc.setAlignment(1, noopCb)              // center
                    svc.printBitmap(qrBmp, noopCb)
                    svc.lineWrap(1, noopCb)
                    // Caption explicativo + 2 lineas de feed antes del cut
                    val caption = "Escanea para ver tu factura en SAT\n\n"
                    svc.sendRAWData(caption.toByteArray(Charsets.ISO_8859_1), noopCb)
                    svc.setAlignment(0, noopCb)              // back to left
                } catch (e: Exception) {
                    Log.w(TAG, "QR fallo (sigue ticket sin QR): ${e.message}")
                }
            }

            // 4. Feed + cut parcial
            svc.sendRAWData(byteArrayOf(
                0x0A, 0x0A,                                   // 2 lineas feed extra
                0x1D, 0x56, 0x42, 0x00                        // GS V B 0 = partial cut
            ), noopCb)

            // 5. Cashbox: solo en venta-nueva-en-efectivo (NO en comanda — no es cobro).
            val debeAbrirCaja = !payload.esReimpresion
                && !payload.esCierreTurno
                && !payload.esComanda
                && payload.metodoPago?.trim()?.lowercase() == "efectivo"
            if (debeAbrirCaja) {
                kickCashDrawer(svc)
            } else {
                Log.d(TAG, "cashbox: no aplica (esReimpresion=${payload.esReimpresion} esCierreTurno=${payload.esCierreTurno} metodoPago=${payload.metodoPago})")
            }
            true
        } catch (e: RemoteException) {
            Log.e(TAG, "RemoteException printTicket", e)
            false
        } catch (e: Exception) {
            Log.e(TAG, "Error printTicket", e)
            false
        }
    }

    /**
     * Construye la URL pública de SAT para verificar el DTE (Reglas FEL 5.6
     * pag. 137). El cliente escanea el QR -> SAT le muestra su factura.
     *
     * Formato:
     *   https://felpub.c.sat.gob.gt/verificador-web/publico/vistas/verificacionDte.jsf
     *   ?tipo=autorizacion
     *   &numero=<UUID>
     *   &emisor=<NIT emisor>
     *   &receptor=<NIT receptor o "CF">
     *   &monto=<gran total con 2 decimales>
     *
     * Aprobado para certificadores privados (Infile) como opcional pero
     * recomendado. SAT no requiere acceso/login para esa URL.
     */
    private fun construirUrlSat(p: TicketPayload): String {
        val uuid = p.uuidSat ?: ""
        val emisor = p.nitEmisor ?: ""
        val receptor = (p.receptorNit.ifBlank { "CF" }).trim().uppercase()
        val monto = "%.2f".format(p.total)
        return "https://felpub.c.sat.gob.gt/verificador-web/publico/vistas/verificacionDte.jsf" +
            "?tipo=autorizacion" +
            "&numero=$uuid" +
            "&emisor=$emisor" +
            "&receptor=$receptor" +
            "&monto=$monto"
    }

    /**
     * Genera un QR con el logo de Julia superpuesto en el centro.
     *
     * Detalles tecnicos:
     *  - Error correction H (~30%) para que el QR aguante el logo central
     *    sin perder legibilidad.
     *  - El logo ocupa ~20% del lado del QR (square central con padding blanco).
     *  - Tamaño total 320x320 px — suficiente para la impresora 58mm Sunmi
     *    (que pierde resolucion impresa a 384px de ancho de papel).
     *  - Renderizado en RGB_565 (suficiente; ahorra memoria vs ARGB_8888).
     *  - Si el logo es null, se genera el QR sin overlay.
     */
    private fun generarQRConLogo(url: String, logo: Bitmap?, sizePx: Int = 320): Bitmap {
        val hints = mapOf(
            EncodeHintType.ERROR_CORRECTION to ErrorCorrectionLevel.H,
            EncodeHintType.MARGIN to 1,
            EncodeHintType.CHARACTER_SET to "UTF-8"
        )
        val matrix = QRCodeWriter().encode(url, BarcodeFormat.QR_CODE, sizePx, sizePx, hints)
        val w = matrix.width
        val h = matrix.height
        val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.RGB_565)
        for (x in 0 until w) {
            for (y in 0 until h) {
                bmp.setPixel(x, y, if (matrix[x, y]) Color.BLACK else Color.WHITE)
            }
        }

        if (logo != null) {
            val canvas = Canvas(bmp)
            // Logo del 20% del QR + padding blanco del 10% del logo
            val logoSize = (sizePx * 0.20).toInt()
            val padding = (logoSize * 0.12).toInt()
            val box = logoSize + padding * 2
            val left = (sizePx - box) / 2f
            val top = (sizePx - box) / 2f

            // Cuadrado blanco de fondo (evita que los modulos negros toquen el logo)
            val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.WHITE }
            canvas.drawRect(left, top, left + box, top + box, paint)

            // Logo escalado al centro
            try {
                val scaled = Bitmap.createScaledBitmap(logo, logoSize, logoSize, true)
                canvas.drawBitmap(scaled, left + padding, top + padding, null)
            } catch (e: Exception) {
                Log.w(TAG, "no pude superponer logo en QR: ${e.message}")
            }
        }
        return bmp
    }

    /**
     * Encapsula el texto plano del ticket en bytes ESC/POS con:
     * - ESC @ (init)
     * - ESC R 18 (charset Latin-9 para tildes/eñe)
     * - El texto en si en Latin-1
     *
     * NO incluye el cut — eso se manda separado al final de printTicket
     * porque entre el texto y el cut va el QR de verificacion SAT.
     */
    private fun wrapEscPosSinCut(texto: String): ByteArray {
        val out = ByteArrayOutputStream()
        out.write(byteArrayOf(0x1B, 0x40))                       // ESC @ = init
        out.write(byteArrayOf(0x1B, 0x52, 0x12))                 // ESC R 18 = Latin-9
        out.write(texto.toByteArray(Charsets.ISO_8859_1))
        out.write("\n".toByteArray())                            // 1 linea separadora
        return out.toByteArray()
    }

    // Construye el ticket como texto plano de 32 columnas siguiendo el
    // mismo orden de bloques que la factura real de Loyverse:
    //   1. Header del emisor (razon social, direccion, NIT)
    //   2. Documento Tributario Electronico / FEL
    //   3. Datos del DTE (Serie, No. DTE, Correlativo)
    //   4. Datos del Comprador (Fecha, NIT, Nombre)
    //   5. Detalle de Factura con headers CANT DETALLE PRECIO TOTAL
    //   6. Subtotal + IVA + TOTAL
    //   7. Datos del Certificador (Autorizacion, NIT, Nombre, Fecha)
    //   8. Footer regulatorio ("Sujeto a pago directo ISR")
    //   9. Espacio para corte
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
        fun wrap(s: String): List<String> {
            // Parte el string en lineas de max W chars en limites de palabras
            if (s.length <= W) return listOf(s)
            val out = mutableListOf<String>()
            var resto = s
            while (resto.length > W) {
                var corte = resto.lastIndexOf(' ', W).coerceAtLeast(W / 2)
                if (corte <= 0) corte = W
                out.add(resto.substring(0, corte).trim())
                resto = resto.substring(corte).trim()
            }
            if (resto.isNotEmpty()) out.add(resto)
            return out
        }
        val sep = "=".repeat(W)
        val sub = "-".repeat(W)

        val sb = StringBuilder()

        // ===== 0. BANNER REIMPRESION (solo si aplica) =====
        // SAT exige que las copias fisicas de una factura ya emitida lleven
        // marca visible que las distinga del original. Lo ponemos arriba de
        // todo, con bordes para resaltar.
        if (p.esReimpresion) {
            val num = p.reimpresionNum ?: 1
            sb.append(sep).append('\n')
            sb.append(cen("*** REIMPRESION N°$num ***")).append('\n')
            sb.append(cen("DUPLICADO DE FACTURA ORIGINAL")).append('\n')
            sb.append(sep).append('\n')
            sb.append('\n')
        }

        // ===== 1. HEADER EMISOR (logo bitmap ya impreso aparte) =====
        // El logo bitmap ya trae 'JULIA BAKERY' visualmente, no repetirlo.
        p.razonSocial?.let {
            for (line in wrap(it)) sb.append(cen(line)).append('\n')
        }
        p.nitEmisor?.let { sb.append(cen("NIT: $it")).append('\n') }
        p.direccion?.let {
            for (line in wrap(it)) sb.append(cen(line)).append('\n')
        }
        sb.append('\n')

        // ===== 2. TIPO DOCUMENTO =====
        sb.append(cen("Documento Tributario Electronico")).append('\n')
        sb.append(cen("FEL - Factura Electronica")).append('\n')
        sb.append(sep).append('\n')

        // ===== 3. DATOS DE LA FACTURA =====
        p.serieSat?.let  { sb.append(cols("Serie:", it)).append('\n') }
        p.uuidSat?.let   { sb.append("No. de DTE:").append('\n').append(it).append('\n') }
        p.numeroSat?.let { sb.append(cols("Correlativo:", it)).append('\n') }
        sb.append(sub).append('\n')

        // ===== 4. DATOS DEL COMPRADOR =====
        sb.append(cen("DATOS DEL COMPRADOR")).append('\n')
        sb.append('\n')
        sb.append(cols("FECHA:", p.fecha)).append('\n')
        sb.append(cols("NIT:", p.receptorNit)).append('\n')
        sb.append("NOMBRE: ${p.receptorNombre}").append('\n')
        p.cajeroNombre?.let { sb.append(cols("CAJERO:", it)).append('\n') }
        p.metodoPago?.let   { sb.append(cols("PAGO:", it.uppercase())).append('\n') }
        sb.append(sub).append('\n')

        // ===== 5. DETALLE DE FACTURA =====
        sb.append(cen("DETALLE DE FACTURA")).append('\n')
        sb.append('\n')
        // Headers de la tabla — paridad exacta con Loyverse
        sb.append(String.format("%-4s%-18s%10s", "CANT", "DETALLE", "TOTAL")).append('\n')
        sb.append(sub).append('\n')
        for (item in p.items) {
            // Linea 1: cant + descripcion + total alineado a derecha
            val cantStr = item.cantidad.take(4)
            val descStr = item.descripcion.take(18)
            val subStr  = String.format("Q %.2f", item.subtotal)
            sb.append(String.format("%-4s%-18s%10s", cantStr, descStr, subStr)).append('\n')
            // Linea 2 (opcional): precio unitario indented si cantidad > 1
            if (item.cantidad != "1" && item.cantidad != "1.0") {
                sb.append(String.format("    Q %.2f c/u", item.precioUnitario)).append('\n')
            }
        }
        sb.append(sub).append('\n')

        // ===== 6. TOTALES =====
        sb.append(cols("Sub total:", String.format("Q %.2f", p.totalGravado))).append('\n')
        sb.append(cols("IVA (12%):", String.format("Q %.2f", p.iva))).append('\n')
        sb.append(cols("TOTAL:", String.format("Q %.2f", p.total))).append('\n')
        sb.append('\n')

        // ===== 7. DATOS DEL CERTIFICADOR =====
        sb.append(sep).append('\n')
        sb.append(cen("DATOS DEL CERTIFICADOR")).append('\n')
        sb.append('\n')
        p.uuidSat?.let {
            sb.append("Numero de Autorizacion:").append('\n')
            sb.append(it).append('\n')
        }
        p.certificadorNit?.let    { sb.append(cols("NIT:", it)).append('\n') }
        p.certificadorNombre?.let { sb.append("Nombre: $it").append('\n') }
        p.fechaCertificacion?.let { sb.append("Fecha cert: $it").append('\n') }
        sb.append(sep).append('\n')

        // ===== 8. FOOTER REGULATORIO =====
        sb.append('\n')
        p.textoFooter?.let { sb.append(cen(it)).append('\n') }

        sb.append('\n').append(cen("Gracias por su compra")).append('\n')
        // Los saltos para alimentar el papel + corte se mandan separados desde
        // printTicket() — entre el texto y el cut va el QR de verificacion SAT.

        return sb.toString()
    }

    /**
     * Layout dedicado para tickets de CIERRE DE TURNO.
     *
     * Diferencias vs construirTextoPlano (factura FEL):
     *   - SIN logo (es operativo, no comprobante fiscal)
     *   - SIN datos certificador SAT (no es FEL)
     *   - Titulo grande "CIERRE DE TURNO"
     *   - Items[] vienen pre-armados desde JS como lineas del desglose
     *     (apertura, ventas por metodo, esperado, contado, diferencia).
     *     Cada item.descripcion + item.subtotal se imprime como key-value.
     *
     * El payload trae:
     *   - razonSocial = "CIERRE DE TURNO"
     *   - receptorNombre = nombre del cajero
     *   - fecha = fecha cierre
     *   - fechaApertura = inicio del turno
     *   - items = lineas del desglose ya formateadas
     *   - total = ventas total
     *   - textoFooter = "Turno #xxx · Cerrado yyy"
     */
    /**
     * Texto plano de COMANDA. No es comprobante fiscal — es solo lista
     * de items para el staff (mostrador, barista) sin precios ni IVA.
     * Header grande para diferenciar visualmente del ticket de venta.
     */
    private fun construirTextoComanda(p: TicketPayload): String {
        val W = 32
        fun cen(s: String): String {
            val pad = ((W - s.length) / 2).coerceAtLeast(0)
            return " ".repeat(pad) + s
        }
        val sep = "=".repeat(W)
        val sub = "-".repeat(W)

        val sb = StringBuilder()

        // ===== Header grande para que se distinga del ticket =====
        sb.append(sep).append('\n')
        sb.append(cen("*** COMANDA ***")).append('\n')
        p.numeroComanda?.let { sb.append(cen("Ref: $it")).append('\n') }
        sb.append(sep).append('\n')
        sb.append('\n')

        // ===== Cabecera operacional =====
        sb.append("Hora: ${p.fecha}").append('\n')
        p.cajeroNombre?.let { sb.append("Cajero: $it").append('\n') }
        // Receptor solo si NO es CF — ayuda a identificar pedidos para llevar
        if (p.receptorNit != "CF" && p.receptorNombre.isNotBlank()
            && p.receptorNombre != "CONSUMIDOR FINAL") {
            sb.append("Cliente: ${p.receptorNombre}").append('\n')
        }
        sb.append(sub).append('\n')

        // ===== Items (cantidad x descripcion, sin precios) =====
        for (item in p.items) {
            // cantidad va a la izquierda en formato "Nx" para que se vea claro
            val cantTxt = "${item.cantidad}x"
            val maxDescLen = W - cantTxt.length - 1
            // Si la descripcion es muy larga, partir en multiples lineas
            val desc = item.descripcion.trim()
            if (desc.length <= maxDescLen) {
                sb.append("$cantTxt ${desc}").append('\n')
            } else {
                // Primer linea con cantidad
                sb.append("$cantTxt ${desc.substring(0, maxDescLen)}").append('\n')
                // Continuacion(es) con sangria
                var idx = maxDescLen
                val indent = " ".repeat(cantTxt.length + 1)
                val contMax = W - indent.length
                while (idx < desc.length) {
                    val end = (idx + contMax).coerceAtMost(desc.length)
                    sb.append(indent).append(desc.substring(idx, end)).append('\n')
                    idx = end
                }
            }
        }
        sb.append(sub).append('\n')

        // ===== Total items (no monetario) =====
        val totalUnidades = p.items.sumOf { it.cantidad.toDoubleOrNull() ?: 0.0 }
        sb.append(cen("Total items: ${totalUnidades.toInt()}")).append('\n')
        sb.append('\n')
        sb.append(cen("--- ARMAR Y ENTREGAR ---")).append('\n')

        return sb.toString()
    }

    private fun construirTextoCierreTurno(p: TicketPayload): String {
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

        // ===== Header =====
        sb.append(sep).append('\n')
        sb.append(cen("CIERRE DE TURNO")).append('\n')
        sb.append(cen(p.merchantName)).append('\n')
        sb.append(sep).append('\n')
        sb.append('\n')

        // ===== Identificacion =====
        sb.append("Cajero: ${p.receptorNombre}").append('\n')
        p.fechaApertura?.let { sb.append("Apertura: $it").append('\n') }
        sb.append("Cierre:   ${p.fecha}").append('\n')
        sb.append(sub).append('\n')

        // ===== Desglose (items[] ya viene armado desde JS) =====
        sb.append(cen("DESGLOSE DEL TURNO")).append('\n')
        sb.append('\n')
        for (item in p.items) {
            val monto = String.format("Q %.2f", item.subtotal)
            // Si descripcion empieza con "—" es una subcategoria (sangria)
            val esSubcategoria = item.descripcion.startsWith("—")
            if (esSubcategoria) {
                sb.append(cols("  " + item.descripcion.substring(1).trim(), monto)).append('\n')
            } else {
                sb.append(cols(item.descripcion, monto)).append('\n')
            }
        }
        sb.append(sub).append('\n')

        // ===== Total grande =====
        sb.append(cols("TOTAL VENTAS:", String.format("Q %.2f", p.total))).append('\n')
        sb.append(sep).append('\n')
        sb.append('\n')

        // ===== Footer =====
        p.textoFooter?.let {
            for (line in it.chunked(W)) sb.append(cen(line)).append('\n')
        }
        sb.append('\n')
        sb.append(cen("--- FIN CIERRE ---")).append('\n')
        // Padding para corte se manda separado desde printTicket()

        return sb.toString()
    }

    // ---------- ESC/POS builder ----------

    private fun construirEscPos(p: TicketPayload): ByteArray {
        val out = ByteArrayOutputStream()
        // Init
        out.write(byteArrayOf(0x1B, 0x40))                            // ESC @ = init
        out.write(byteArrayOf(0x1B, 0x52, 0x12))                      // ESC R 18 = Latin-9 (con tildes/eñe basico)

        // ----- Banner REIMPRESION (si aplica), arriba de todo -----
        if (p.esReimpresion) {
            val num = p.reimpresionNum ?: 1
            out.write(byteArrayOf(0x1B, 0x61, 0x01))                  // ESC a 1 = center
            out.write(byteArrayOf(0x1D, 0x21, 0x11.toByte()))         // doble ancho/alto
            out.write("REIMPRESION N°$num\n".toByteArray(Charsets.ISO_8859_1))
            out.write(byteArrayOf(0x1D, 0x21, 0x00))                  // normal
            out.write("DUPLICADO DE FACTURA ORIGINAL\n".toByteArray(Charsets.ISO_8859_1))
            out.write("================================\n\n".toByteArray())
        }

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

    /**
     * Abre la gaveta de efectivo conectada a la Sunmi via el comando ESC/POS
     * estandar "ESC p" (0x1B 0x70). La Sunmi enruta sendRAWData con esta
     * secuencia al pin de la gaveta.
     *
     * Bytes: ESC p m t1 t2
     *   - m  = 0x00 -> pin 2 (default en cajones estandar)
     *   - t1 = 0x19 (25 ms) -> tiempo de pulso ON
     *   - t2 = 0xFA (250 ms) -> tiempo de pulso OFF
     *
     * Si el cajon no esta conectado o esta apagado, el comando se descarta
     * silenciosamente — no falla la impresion del ticket.
     *
     * IMPORTANTE: para que esto sea la UNICA fuente de aperturas, el setting
     * "auto-open drawer on print" del sistema operativo Sunmi tiene que estar
     * APAGADO. Si esta prendido, la gaveta se abrira en TODO print (incluyendo
     * tarjeta y reimpresion), arruinando la regla.
     */
    private fun kickCashDrawer(svc: IWoyouService) {
        try {
            val cmd = byteArrayOf(0x1B, 0x70, 0x00, 0x19.toByte(), 0xFA.toByte())
            svc.sendRAWData(cmd, noopCb)
            Log.d(TAG, "cashbox: kick enviado")
        } catch (e: Exception) {
            Log.w(TAG, "cashbox kick fallo (no critico): ${e.message}")
        }
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
    // Emisor
    val merchantName: String,                       // nombre comercial (ej. "Julia Bakery")
    val razonSocial: String? = null,                // ej. "WEIRD DOUGH, SOCIEDAD ANONIMA"
    val direccion: String? = null,
    val nitEmisor: String? = null,
    // Receptor
    val receptorNit: String,
    val receptorNombre: String,
    val fecha: String,
    val cajeroNombre: String? = null,
    val metodoPago: String? = null,
    // Items + totales
    val items: List<TicketItem>,
    val totalGravado: Double,
    val iva: Double,
    val total: Double,
    // Certificador (Infile)
    val uuidSat: String? = null,
    val serieSat: String? = null,
    val numeroSat: String? = null,
    val certificadorNombre: String? = null,         // ej. "INFILE, S.A."
    val certificadorNit: String? = null,            // ej. "12521329"
    val fechaCertificacion: String? = null,
    // Footer regulatorio (ej. "Sujeto a pago directo ISR")
    val textoFooter: String? = null,

    // Marca de reimpresion. Si esReimpresion=true se imprime un banner
    // grande "*** REIMPRESION N°X ***" arriba del ticket, y el certificador
    // SAT se reusa del original (no se recertifica). reimpresionNum es el
    // contador de copias emitidas (1 = primera copia despues del original).
    val esReimpresion: Boolean = false,
    val reimpresionNum: Int? = null,

    // Marca de cierre de turno. Si esCierreTurno=true, se usa un layout
    // operativo dedicado (sin logo, sin certificador SAT, con titulo
    // "CIERRE DE TURNO" y items[] como desglose por metodo de pago).
    val esCierreTurno: Boolean = false,
    val fechaApertura: String? = null,
    val tipo: String? = null,             // 'cierre_turno' u otros marcadores futuros

    // Marca de comanda interna (NO es comprobante fiscal). Si esComanda=true:
    // - Sin logo
    // - Sin QR SAT
    // - Sin precios ni IVA (solo lista de items con cantidad)
    // - Header grande "*** COMANDA ***" para diferenciarla del ticket
    // - Sin cashbox (no es cobro)
    // Util para que el mostrador / barista vea que armar.
    val esComanda: Boolean = false,
    val numeroComanda: String? = null,    // referencia corta (ej. ultimos 4 del UUID)

    // Compatibilidad con payloads antiguos (no se usan)
    val merchantSubtitle: String? = null,
    val merchantAddress: String? = null,
    val merchantNit: String? = null,
    val certificador: String? = null,
)

@Serializable
data class TicketItem(
    val descripcion: String,
    val cantidad: String,
    val precioUnitario: Double,
    val subtotal: Double,
)
