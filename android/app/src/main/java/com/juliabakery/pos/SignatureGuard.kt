package com.juliabakery.pos

import android.content.Context
import android.content.pm.PackageManager
import android.content.pm.Signature
import android.os.Build
import android.util.Log
import java.security.MessageDigest

/**
 * Anti-tampering: verifica al arrancar que el APK fue firmado con el keystore
 * oficial Julia Bakery. Si fue re-firmado (decompile + repack + sign con otra
 * llave) el SHA-256 cambia y la app se cierra.
 *
 * Solo se ejecuta en builds RELEASE. En DEBUG siempre pasa (para no obstruir
 * el ciclo de desarrollo).
 *
 * El hash esperado esta hardcoded a proposito — un atacante que decompile
 * podria intentar cambiarlo, pero con R8 obfuscation (minify=true en release)
 * navegar el smali para encontrar y modificar este string es mucho mas dificil.
 *
 * El cert SHA-256 esta documentado en android/README.md y se genero con:
 *   keytool -list -keystore ~/.juliabakery/julia-release.jks -storepass <pass>
 */
object SignatureGuard {

    // SHA-256 del cert del keystore Julia Bakery release. Documentado en android/README.md.
    private const val EXPECTED_SHA256 =
        "b3b6af73996b522d1fc94bf688cea55559c74ab65ecd4e47e7e594a52f96f9a2"

    /**
     * Devuelve true si la firma del APK coincide con la esperada.
     * En DEBUG siempre devuelve true (no obstruye desarrollo).
     */
    fun verify(context: Context): Boolean {
        if (BuildConfig.DEBUG) {
            Log.d(TAG, "DEBUG build — skip signature verification")
            return true
        }
        return try {
            val signatures = obtenerFirmas(context)
            if (signatures.isEmpty()) {
                Log.e(TAG, "No se encontraron firmas en el APK — fail safe")
                return false
            }
            val esperado = EXPECTED_SHA256.lowercase()
            val coincide = signatures.any { sig ->
                val hash = sha256(sig.toByteArray()).lowercase()
                Log.d(TAG, "Firma encontrada SHA-256: $hash")
                hash == esperado
            }
            if (!coincide) {
                Log.e(TAG, "Firma NO coincide con la oficial. APK alterado o re-firmado.")
            } else {
                Log.d(TAG, "Firma verificada OK")
            }
            coincide
        } catch (e: Exception) {
            Log.e(TAG, "Error verificando firma", e)
            // Fail-safe: ante error, asumimos compromiso y bloqueamos
            false
        }
    }

    private fun obtenerFirmas(context: Context): Array<Signature> {
        val pm = context.packageManager
        val pkg = context.packageName
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            val pi = pm.getPackageInfo(pkg, PackageManager.GET_SIGNING_CERTIFICATES)
            val info = pi.signingInfo
            when {
                info == null -> emptyArray()
                info.hasMultipleSigners() -> info.apkContentsSigners
                else -> info.signingCertificateHistory ?: emptyArray()
            }
        } else {
            @Suppress("DEPRECATION")
            val pi = pm.getPackageInfo(pkg, PackageManager.GET_SIGNATURES)
            @Suppress("DEPRECATION")
            pi.signatures ?: emptyArray()
        }
    }

    private fun sha256(bytes: ByteArray): String {
        val md = MessageDigest.getInstance("SHA-256")
        val digest = md.digest(bytes)
        return digest.joinToString("") { "%02x".format(it) }
    }

    private const val TAG = "SignatureGuard"
}
