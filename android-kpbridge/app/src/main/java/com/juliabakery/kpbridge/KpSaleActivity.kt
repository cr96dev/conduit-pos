package com.juliabakery.kpbridge

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.util.Log
import org.json.JSONObject

// AAR Kinpos
import com.kinpos.kpinvocacion.KP_Codes
import com.kinpos.kpinvocacion.KP_Invocador
import com.kinpos.kpinvocacion.Trans_Results

/**
 * Activity transparente que dispara KP_Sale (via el AAR de Kinpos) y captura
 * el resultado en onActivityResult. Es invisible — solo existe para satisfacer
 * el patron startActivityForResult que requiere el AAR.
 *
 * Flujo:
 *   1. BridgeHttpServer recibe POST /sale y llama a SaleManager.crearPendiente.
 *   2. BridgeHttpServer lanza Intent a esta Activity con el idsale.
 *   3. onCreate llama KP_Invocador.KP_Sale(...) — eso despacha al SmartPOS.
 *   4. SmartPOS interactua con el cliente (chip/banda/NFC + PIN).
 *   5. SmartPOS devuelve via onActivityResult con Trans_Results en Intent.
 *   6. Convertimos Trans_Results -> JSON respuesta_lector.
 *   7. SaleManager.completarConResultado.
 *   8. finish() — Activity se cierra, cliente HTTP polling se entera por GET /status.
 */
class KpSaleActivity : Activity() {

    private lateinit var idsale: String

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        idsale = intent.getStringExtra(EXTRA_IDSALE) ?: run {
            Log.e(TAG, "Sin idsale en extras, no puedo continuar")
            finish()
            return
        }

        val cfg = Config(this)
        if (!cfg.esValida()) {
            SaleManager.marcarError(idsale, "Bridge sin credenciales configuradas (user/password/deviceId)")
            finish()
            return
        }

        val params = SaleManager.obtenerParams(idsale) ?: run {
            SaleManager.marcarError(idsale, "idsale no esta en SaleManager")
            finish()
            return
        }
        val (amountCents, taxCents, tipCents) = params
        val (email, cellphone) = SaleManager.obtenerExtras(idsale) ?: Pair(cfg.defaultEmail, "")

        Log.d(TAG, "Dispatching KP_Sale idsale=$idsale amount=$amountCents tax=$taxCents tip=$tipCents")

        try {
            val invocador = KP_Invocador(cfg.mposUrl, this)
            invocador.KP_Sale(
                cfg.user,
                cfg.password,
                cfg.deviceId,
                amountCents,
                taxCents,
                tipCents,
                email.ifBlank { cfg.defaultEmail },
                cellphone,
            )
            // KP_Sale dispara un startActivityForResult internamente
            // — esperamos el callback en onActivityResult.
        } catch (e: Exception) {
            Log.e(TAG, "Error invocando KP_Sale", e)
            SaleManager.marcarError(idsale, "Excepcion al invocar SmartPOS: ${e.message}")
            finish()
        }
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        Log.d(TAG, "onActivityResult req=$requestCode result=$resultCode data=${data != null}")

        try {
            if (data == null) {
                SaleManager.marcarError(idsale, "SmartPOS devolvio sin Intent (cancelado?)")
                finish()
                return
            }

            val tr = Trans_Results(data.extras)
            val respuestaLector = mapearTransResults(tr)
            val approved = (tr.responseCode == "00")
            SaleManager.completarConResultado(idsale, respuestaLector, approved)
            Log.d(TAG, "Venta $idsale completada: approved=$approved rc=${tr.responseCode}")
        } catch (e: Exception) {
            Log.e(TAG, "Error parseando Trans_Results", e)
            SaleManager.marcarError(idsale, "Error parseando resultado: ${e.message}")
        } finally {
            finish()
        }
    }

    /**
     * Mapea Trans_Results del AAR al shape `respuesta_lector` que el frontend
     * /pos ya consume (mismo contrato que /api/neonet/mock-sale).
     *
     * Nota: los nombres de los campos en Trans_Results son los que documenta
     * el SDK de Kinpos. Si difieren en tu version del AAR, ajustar aqui.
     */
    private fun mapearTransResults(tr: Trans_Results): JSONObject {
        val o = JSONObject()
        try { o.put("response_code", tr.responseCode ?: "") } catch (_: Exception) {}
        try { o.put("authorization_code", tr.authCode ?: "") } catch (_: Exception) {}
        try { o.put("retrieval_no", tr.referenceNumber ?: "") } catch (_: Exception) {}
        try { o.put("response_message", tr.responseMessage ?: "") } catch (_: Exception) {}
        try { o.put("approved", if (tr.responseCode == "00") "true" else "false") } catch (_: Exception) {}
        try { o.put("voucher_code", tr.receipt ?: "") } catch (_: Exception) {}
        try { o.put("suggested_nit", tr.taxId ?: "") } catch (_: Exception) {}
        try { o.put("cardHolderName", tr.cardHolder ?: "") } catch (_: Exception) {}
        try { o.put("panPci", tr.maskedPan ?: "") } catch (_: Exception) {}
        try { o.put("systemsTraceNo", tr.stan ?: "") } catch (_: Exception) {}
        try { o.put("terminalId", tr.terminalId ?: "") } catch (_: Exception) {}
        return o
    }

    companion object {
        const val EXTRA_IDSALE = "idsale"
        private const val TAG = "KpSaleActivity"
    }
}
