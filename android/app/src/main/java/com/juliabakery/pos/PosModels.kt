package com.juliabakery.pos

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * Shape de la respuesta de /api/neonet/pos-credentials.
 * El wrapper la usa para armar los extras del Intent del NeoPOS App.
 */
@Serializable
data class PosCredentialsResponse(
    val ok: Boolean,
    val token: String,
    val tokenExpiresAt: String? = null,
    @SerialName("ttl_seconds") val ttlSeconds: Int? = null,
    val merchant: Merchant,
    val terminal: Terminal,
)

@Serializable
data class Merchant(val user: String, val passwd: String)

@Serializable
data class Terminal(val id: String, @SerialName("cardAcqId") val cardAcqId: String)

/**
 * Payload que la WebView pasa al bridge en startSale().
 *   { idsale: "abc123", amount_cents: 1500 }
 *
 * `amount_cents` lo recibimos en centavos (entero). El Intent del NeoPOS App
 * acepta el monto en formato string con 2 decimales (segun manual v1.1.0).
 * La conversion la hace JuliaPOSBridge.
 */
@Serializable
data class StartSalePayload(
    val idsale: String,
    @SerialName("amount_cents") val amountCents: Long,
    /** Para autocompletar receptor si la tarjeta tiene NIT asociado. Opcional. */
    @SerialName("client_name") val clientName: String? = null,
)

/**
 * Shape que la WebView espera de vuelta — espejo del mock-sale endpoint.
 * Si el Intent del NeoPOS App devuelve campos diferentes los renombramos
 * en JuliaPOSBridge.parseIntentResult() para mantener el contrato.
 */
@Serializable
data class RespuestaLector(
    @SerialName("response_code") val responseCode: String,
    @SerialName("retrieval_no") val retrievalNo: String = "",
    @SerialName("authorization_code") val authorizationCode: String = "",
    @SerialName("response_message") val responseMessage: String = "",
    val approved: String = "false",
    @SerialName("suggested_nit") val suggestedNit: String = "",
    @SerialName("voucher_code") val voucherCode: String = "",
    val panPci: String = "",
    val cardHolderName: String = "",
    val posEntryMode: String = "",
    val terminalId: String = "",
    val cardAcqId: String = "",
    val systemsTraceNo: String = "",
)

@Serializable
data class StartSaleResult(
    val ok: Boolean,
    @SerialName("respuesta_lector") val respuestaLector: RespuestaLector? = null,
    @SerialName("error_message") val errorMessage: String? = null,
)
