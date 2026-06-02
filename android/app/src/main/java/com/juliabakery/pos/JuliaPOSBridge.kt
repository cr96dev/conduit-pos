package com.juliabakery.pos

import android.content.Intent
import android.util.Log
import android.webkit.JavascriptInterface
import android.webkit.WebView
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

/**
 * Puente entre la WebView (Julia Bakery POS) y el Intent del NeoPOS App.
 *
 * El JS de Julia llama:
 *
 *   window.JuliaPOS.startSale({ idsale, amount_cents })
 *
 * Eso se mapea a:
 *
 *   window.__JuliaPOSNative.startSale(payloadJson, callbackId)
 *
 * que es lo que Android expone via @JavascriptInterface.
 *
 * Cuando el NeoPOS App devuelve por onActivityResult, llamamos:
 *
 *   webView.evaluateJavascript("window.__JuliaPOSResolve('<id>', <jsonResult>)", ...)
 *
 * y la promesa del lado JS resuelve.
 *
 * IMPORTANTE: las callbacks viven en memoria del lado JS y del lado Kotlin.
 * Si la WebView se recarga (rotacion, pull-to-refresh, redirect), se perderan.
 * Por eso fijamos screenOrientation=portrait y disableamos pull-to-refresh
 * en MainActivity.
 */
class JuliaPOSBridge(
    private val webView: WebView,
    private val scope: CoroutineScope,
    private val onLaunchIntent: (Intent, String) -> Unit,
    private val sunmiPrinter: SunmiPrinter? = null,
) {
    /** Map callbackId -> nada; usamos solo para distinguir "viva" de "huerfana". */
    private val pendingCallbacks = mutableMapOf<String, Long>()

    /**
     * Llamado desde JS: window.__JuliaPOSNative.startSale(payloadJson, callbackId).
     * El payload incluye `creds` (token + merchant + terminal) que el JS ya
     * fetcho contra /api/neonet/pos-credentials con su access_token de admin.
     * Aqui solo armamos el Intent y lo lanzamos.
     */
    @JavascriptInterface
    fun startSale(payloadJson: String, callbackId: String) {
        Log.d(TAG, "startSale($callbackId)")
        pendingCallbacks[callbackId] = System.currentTimeMillis()
        scope.launch {
            try {
                val payload = json.decodeFromString<StartSalePayload>(payloadJson)
                val intent = buildNeoPosIntent(payload, payload.creds)
                onLaunchIntent(intent, callbackId)
            } catch (e: Exception) {
                Log.e(TAG, "startSale failed", e)
                resolveJs(callbackId, StartSaleResult(ok = false, errorMessage = e.message ?: "unknown"))
            }
        }
    }

    /**
     * Llamado desde MainActivity tras onActivityResult del Intent NeoPOS.
     * Convierte los extras del Intent a un RespuestaLector y reinjecta al JS.
     */
    fun deliverIntentResult(callbackId: String, resultIntent: Intent?) {
        Log.d(TAG, "deliverIntentResult($callbackId) hasIntent=${resultIntent != null}")
        if (!pendingCallbacks.containsKey(callbackId)) {
            Log.w(TAG, "callbackId no esta en pending — ignorando resultado")
            return
        }
        val result = parseIntentResult(resultIntent)
        resolveJs(callbackId, result)
    }

    /** Cancela un callback (ej: NeoPOS App no instalada) y notifica al JS. */
    fun rejectCallback(callbackId: String, message: String) {
        resolveJs(callbackId, StartSaleResult(ok = false, errorMessage = message))
    }

    /**
     * Llamado desde JS: window.__JuliaPOSNative.openCashDrawer(callbackId)
     *
     * Abre el cajon monedero ad-hoc (sin imprimir). Usado por
     * /admin/diagnostico para probar el cable + cajon sin cobrar una venta.
     */
    @JavascriptInterface
    fun openCashDrawer(callbackId: String) {
        Log.d(TAG, "openCashDrawer($callbackId)")
        scope.launch {
            val printer = sunmiPrinter
            if (printer == null || !printer.isConnected()) {
                resolveJsPrint(callbackId, PrintTicketResult(ok = false,
                    errorMessage = if (printer == null) "wrapper_sin_printer" else "no_sunmi_printer"))
                return@launch
            }
            val ok = printer.openCashDrawerStandalone()
            resolveJsPrint(callbackId, PrintTicketResult(ok = ok,
                errorMessage = if (ok) null else "drawer_kick_fallo"))
        }
    }

    /**
     * Llamado desde JS: window.__JuliaPOSNative.printTicket(payloadJson, callbackId)
     *
     * Imprime un ticket de venta en la impresora termica integrada del Sunmi
     * via el InnerPrinter service (woyou.aidlservice.jiuiv5).
     *
     * Si el device no es Sunmi (servicio no bindeado), devuelve { ok: false,
     * errorMessage: "no_sunmi_printer" } pero no crashea la app.
     */
    @JavascriptInterface
    fun printTicket(payloadJson: String, callbackId: String) {
        Log.d(TAG, "printTicket($callbackId) len=${payloadJson.length}")
        scope.launch {
            val printer = sunmiPrinter
            if (printer == null) {
                resolveJsPrint(callbackId, PrintTicketResult(ok = false, errorMessage = "wrapper_sin_printer"))
                return@launch
            }
            if (!printer.isConnected()) {
                resolveJsPrint(callbackId, PrintTicketResult(ok = false, errorMessage = "no_sunmi_printer"))
                return@launch
            }
            try {
                val payload = json.decodeFromString<TicketPayload>(payloadJson)
                val ok = printer.printTicket(payload)
                resolveJsPrint(callbackId, PrintTicketResult(ok = ok,
                    errorMessage = if (ok) null else "print_failed"))
            } catch (e: Exception) {
                Log.e(TAG, "printTicket parse/print failed", e)
                resolveJsPrint(callbackId, PrintTicketResult(ok = false, errorMessage = e.message ?: "unknown"))
            }
        }
    }

    private fun resolveJsPrint(callbackId: String, result: PrintTicketResult) {
        val resultJson = json.encodeToString(result)
        val safeId = callbackId.replace("'", "")
        val expr = "window.__JuliaPOSResolve && window.__JuliaPOSResolve('$safeId', $resultJson);"
        webView.post { webView.evaluateJavascript(expr, null) }
    }

    // ---------- privados ----------

    /**
     * Arma el Intent del NeoPOS App segun manual v1.1.0.
     * Action: com.visanet.pos.START_ACTIVITY
     * Extras: token, merchantUser, merchantPasswd, amount, idsale,
     *         terminalId, cardAcqId, printVoucher.
     */
    private fun buildNeoPosIntent(payload: StartSalePayload, creds: PosCredentialsResponse): Intent {
        val amountStr = formatAmount(payload.amountCents)
        return Intent("com.visanet.pos.START_ACTIVITY").apply {
            putExtra("token", creds.token)
            putExtra("merchantUser", creds.merchant.user)
            putExtra("merchantPasswd", creds.merchant.passwd)
            putExtra("amount", amountStr)
            putExtra("idsale", payload.idsale)
            putExtra("terminalId", creds.terminal.id)
            putExtra("cardAcqId", creds.terminal.cardAcqId)
            putExtra("printVoucher", "true")
            payload.clientName?.let { putExtra("clientName", it) }
        }
    }

    /** "1500" -> "15.00" (centavos a string con 2 decimales). */
    private fun formatAmount(cents: Long): String {
        val whole = cents / 100
        val frac = (cents % 100).toString().padStart(2, '0')
        return "$whole.$frac"
    }

    /**
     * Parsea el Intent que devuelve NeoPOS App tras onActivityResult.
     * El manual v1.1.0 documenta extras: response_code, retrieval_no,
     * authorization_code, response_message, approved, suggested_nit,
     * voucher_code, panPci, cardHolderName, posEntryMode, terminalId,
     * cardAcqId, systemsTraceNo (no todos siempre presentes).
     */
    private fun parseIntentResult(intent: Intent?): StartSaleResult {
        if (intent == null) {
            return StartSaleResult(ok = false, errorMessage = "NeoPOS App cancelo el cobro")
        }
        val ext = intent.extras
        if (ext == null || ext.isEmpty) {
            return StartSaleResult(ok = false, errorMessage = "NeoPOS App devolvio sin extras")
        }
        fun s(k: String) = ext.getString(k) ?: ""
        val rl = RespuestaLector(
            responseCode      = s("response_code"),
            retrievalNo       = s("retrieval_no"),
            authorizationCode = s("authorization_code"),
            responseMessage   = s("response_message"),
            approved          = s("approved").ifBlank { if (s("response_code") == "00") "true" else "false" },
            suggestedNit      = s("suggested_nit"),
            voucherCode       = s("voucher_code"),
            panPci            = s("panPci"),
            cardHolderName    = s("cardHolderName"),
            posEntryMode      = s("posEntryMode"),
            terminalId        = s("terminalId"),
            cardAcqId         = s("cardAcqId"),
            systemsTraceNo    = s("systemsTraceNo"),
        )
        return StartSaleResult(ok = true, respuestaLector = rl)
    }

    /** Inyecta window.__JuliaPOSResolve(callbackId, resultJson) en la WebView. */
    private fun resolveJs(callbackId: String, result: StartSaleResult) {
        pendingCallbacks.remove(callbackId)
        val resultJson = json.encodeToString(result)
        // jsString-escape: callbackId es alfanumerico generado por JS, igual lo cuidamos.
        val safeId = callbackId.replace("'", "")
        val expr = "window.__JuliaPOSResolve && window.__JuliaPOSResolve('$safeId', $resultJson);"
        webView.post { webView.evaluateJavascript(expr, null) }
    }

    companion object {
        private const val TAG = "JuliaPOSBridge"
        val json = Json {
            ignoreUnknownKeys = true
            explicitNulls = false
            encodeDefaults = true
        }
    }
}
