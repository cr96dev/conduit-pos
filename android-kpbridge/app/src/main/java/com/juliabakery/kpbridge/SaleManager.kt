package com.juliabakery.kpbridge

import org.json.JSONObject
import java.util.concurrent.ConcurrentHashMap

/**
 * Estado de las ventas en curso. Singleton thread-safe.
 *
 * Flujo de una venta:
 *   1. POST /sale -> SaleManager.crearPendiente(idsale, params)
 *      -> devuelve immediately al cliente HTTP {idsale, status:'pending'}
 *   2. BridgeService manda Intent a KpSaleActivity con el idsale.
 *   3. KpSaleActivity llama KP_Invocador.KP_Sale(...).
 *   4. SmartPOS interactua con el lector, lee tarjeta, autoriza.
 *   5. onActivityResult de KpSaleActivity recibe Trans_Results.
 *   6. KpSaleActivity llama SaleManager.completar(idsale, results).
 *   7. Cliente hace polling GET /sale/{idsale}/status hasta status != pending.
 *
 * Cada venta vive en memoria mientras el proceso esta vivo. Si el proceso
 * muere a media venta, queda perdida — pero el cliente tiene timeout de
 * 120s en el polling, asi que despues de eso considera "error".
 */
object SaleManager {

    sealed class Estado {
        object Pendiente : Estado()
        data class Resuelta(val respuestaLector: JSONObject, val approved: Boolean) : Estado()
        data class Error(val mensaje: String) : Estado()
    }

    private data class Venta(
        val idsale: String,
        val amountCents: Long,
        val taxCents: Long,
        val tipCents: Long,
        val email: String,
        val cellphone: String,
        @Volatile var estado: Estado,
        val creadoAt: Long = System.currentTimeMillis(),
    )

    // idsale -> Venta. Se limpia automaticamente despues de 10 min.
    private val ventas = ConcurrentHashMap<String, Venta>()

    /** Crea una venta en estado Pendiente. Si ya existia con el mismo idsale, error. */
    fun crearPendiente(
        idsale: String,
        amountCents: Long,
        taxCents: Long,
        tipCents: Long,
        email: String,
        cellphone: String,
    ): Boolean {
        purgarViejas()
        val nueva = Venta(idsale, amountCents, taxCents, tipCents, email, cellphone, Estado.Pendiente)
        return ventas.putIfAbsent(idsale, nueva) == null
    }

    fun obtenerEstado(idsale: String): Estado? = ventas[idsale]?.estado

    fun obtenerParams(idsale: String): Triple<Long, Long, Long>? {
        val v = ventas[idsale] ?: return null
        return Triple(v.amountCents, v.taxCents, v.tipCents)
    }

    fun obtenerExtras(idsale: String): Pair<String, String>? {
        val v = ventas[idsale] ?: return null
        return Pair(v.email, v.cellphone)
    }

    fun completarConResultado(idsale: String, respuestaLector: JSONObject, approved: Boolean) {
        ventas[idsale]?.let { it.estado = Estado.Resuelta(respuestaLector, approved) }
    }

    fun marcarError(idsale: String, mensaje: String) {
        ventas[idsale]?.let { it.estado = Estado.Error(mensaje) }
    }

    /** Elimina ventas mas viejas que 10 minutos. */
    private fun purgarViejas() {
        val limite = System.currentTimeMillis() - 10 * 60 * 1000
        val it = ventas.entries.iterator()
        while (it.hasNext()) {
            if (it.next().value.creadoAt < limite) it.remove()
        }
    }
}
