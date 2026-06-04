package com.juliabakery.kpbridge

import android.content.Context
import android.content.Intent
import android.util.Log
import fi.iki.elonen.NanoHTTPD
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.util.UUID

/**
 * Mini HTTP server que expone el bridge en el puerto BuildConfig.BRIDGE_PORT.
 * Corre dentro de BridgeService como foreground.
 *
 * Endpoints (todos JSON, todos con CORS abierto):
 *
 *   GET  /status
 *     -> { ok, mpos_url, config_valida, port }
 *
 *   POST /sale
 *     body: { idsale?, amount_cents, tax_cents?, tip_cents?, email?, cellphone? }
 *     -> { ok, idsale, status: 'pending' }
 *     - El idsale es opcional; si no viene generamos uno.
 *     - amount_cents es REQUERIDO (long, en centavos: 1500 = Q15.00).
 *     - Lanza KpSaleActivity en background. Cliente debe polear /sale/{id}/status.
 *
 *   GET  /sale/{idsale}/status
 *     -> { idsale, status: 'pending'|'approved'|'rejected'|'error',
 *          respuesta_lector?, error? }
 *
 *   OPTIONS *
 *     -> 204 con CORS headers (preflight)
 */
class BridgeHttpServer(
    private val context: Context,
    port: Int,
) : NanoHTTPD(port) {

    override fun serve(session: IHTTPSession): Response {
        try {
            val method = session.method
            val uri = session.uri

            // CORS preflight
            if (method == Method.OPTIONS) {
                return corsify(newFixedLengthResponse(Response.Status.NO_CONTENT, MIME_PLAIN, ""))
            }

            return when {
                method == Method.GET && uri == "/status" -> handleStatus()
                method == Method.POST && uri == "/sale"  -> handleSale(session)
                method == Method.GET && uri.matches(Regex("^/sale/[^/]+/status$")) -> {
                    val idsale = uri.removePrefix("/sale/").removeSuffix("/status")
                    handleSaleStatus(idsale)
                }
                else -> json404("Endpoint no existe: $method $uri")
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error en serve()", e)
            return corsify(jsonError(Response.Status.INTERNAL_ERROR, e.message ?: "unknown"))
        }
    }

    // ---------------- handlers ----------------

    private fun handleStatus(): Response {
        val cfg = Config(context)
        val body = JSONObject().apply {
            put("ok", true)
            put("mpos_url", cfg.mposUrl)
            put("config_valida", cfg.esValida())
            put("port", BuildConfig.BRIDGE_PORT)
        }
        return jsonOk(body)
    }

    private fun handleSale(session: IHTTPSession): Response {
        val body = leerBody(session) ?: return jsonError(Response.Status.BAD_REQUEST, "Body invalido")
        val json = try { JSONObject(body) } catch (e: Exception) {
            return jsonError(Response.Status.BAD_REQUEST, "JSON invalido: ${e.message}")
        }

        val idsale = json.optString("idsale").ifBlank { generarIdsale() }
        val amount = json.optLong("amount_cents", -1)
        if (amount <= 0) return jsonError(Response.Status.BAD_REQUEST, "amount_cents requerido (long > 0)")
        val tax = json.optLong("tax_cents", 0)
        val tip = json.optLong("tip_cents", 0)
        val email = json.optString("email", "")
        val cellphone = json.optString("cellphone", "")

        val creada = SaleManager.crearPendiente(idsale, amount, tax, tip, email, cellphone)
        if (!creada) {
            return jsonError(Response.Status.CONFLICT, "Ya existe una venta con ese idsale")
        }

        // Disparar KpSaleActivity. Necesita FLAG_ACTIVITY_NEW_TASK porque
        // estamos en un Service.
        val intent = Intent(context, KpSaleActivity::class.java).apply {
            putExtra(KpSaleActivity.EXTRA_IDSALE, idsale)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        try {
            context.startActivity(intent)
        } catch (e: Exception) {
            SaleManager.marcarError(idsale, "No pude lanzar Activity: ${e.message}")
            return jsonError(Response.Status.INTERNAL_ERROR, "No pude lanzar Activity: ${e.message}")
        }

        val resp = JSONObject().apply {
            put("ok", true)
            put("idsale", idsale)
            put("status", "pending")
            put("poll_url", "/sale/$idsale/status")
        }
        return jsonOk(resp, Response.Status.ACCEPTED)
    }

    private fun handleSaleStatus(idsale: String): Response {
        val estado = SaleManager.obtenerEstado(idsale)
            ?: return json404("Venta no existe (o ya purgada por timeout)")

        val resp = JSONObject().apply {
            put("idsale", idsale)
            when (estado) {
                is SaleManager.Estado.Pendiente -> put("status", "pending")
                is SaleManager.Estado.Resuelta -> {
                    put("status", if (estado.approved) "approved" else "rejected")
                    put("respuesta_lector", estado.respuestaLector)
                }
                is SaleManager.Estado.Error -> {
                    put("status", "error")
                    put("error", estado.mensaje)
                }
            }
        }
        return jsonOk(resp)
    }

    // ---------------- helpers ----------------

    private fun leerBody(session: IHTTPSession): String? {
        return try {
            val cl = session.headers["content-length"]?.toIntOrNull() ?: 0
            if (cl <= 0) return ""
            val buf = ByteArray(cl)
            val read = session.inputStream.read(buf, 0, cl)
            String(buf, 0, read)
        } catch (e: Exception) {
            Log.w(TAG, "leerBody fallo: ${e.message}")
            null
        }
    }

    private fun generarIdsale(): String =
        "KP_${System.currentTimeMillis()}_${UUID.randomUUID().toString().take(6)}"

    // Wrappers para responder con headers CORS abiertos. Necesario porque
    // /pos webview corre en julia-bakery.vercel.app y los browsers exigen CORS
    // para llamar a 192.168.0.46:8081.
    private fun corsify(r: Response): Response {
        r.addHeader("Access-Control-Allow-Origin", "*")
        r.addHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        r.addHeader("Access-Control-Allow-Headers", "Content-Type, Authorization")
        r.addHeader("Access-Control-Max-Age", "86400")
        return r
    }

    private fun jsonOk(obj: JSONObject, status: Response.Status = Response.Status.OK): Response =
        corsify(newFixedLengthResponse(status, MIME_JSON, obj.toString()))

    private fun json404(msg: String): Response {
        val body = JSONObject().put("ok", false).put("error", msg)
        return corsify(newFixedLengthResponse(Response.Status.NOT_FOUND, MIME_JSON, body.toString()))
    }

    private fun jsonError(status: Response.Status, msg: String): Response {
        val body = JSONObject().put("ok", false).put("error", msg)
        return corsify(newFixedLengthResponse(status, MIME_JSON, body.toString()))
    }

    companion object {
        private const val TAG = "BridgeHttpServer"
        private const val MIME_JSON = "application/json; charset=utf-8"
        private const val MIME_PLAIN = "text/plain; charset=utf-8"
    }
}
