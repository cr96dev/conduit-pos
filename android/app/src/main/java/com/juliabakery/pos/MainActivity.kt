package com.juliabakery.pos

import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.util.Log
import android.view.View
import android.webkit.CookieManager
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import androidx.appcompat.app.AlertDialog
import com.juliabakery.pos.databinding.ActivityMainBinding

/**
 * Unica Activity del wrapper. Contiene:
 *  - WebView que carga ${JULIA_BASE_URL}${JULIA_POS_PATH} (default: prod)
 *  - JuliaPOSBridge registrado como window.__JuliaPOSNative
 *  - ActivityResultLauncher para el Intent del NeoPOS App
 *  - Bootstrap JS que envuelve __JuliaPOSNative en window.JuliaPOS.startSale
 *    (returnando Promises desde el lado JS)
 */
class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding
    private lateinit var bridge: JuliaPOSBridge
    private val sunmiPrinter = SunmiPrinter()

    /** Mantenemos el ultimo callbackId al lanzar el Intent. ActivityResult
     *  no nos deja pasar metadata custom; al volver, la asociamos. */
    private var pendingCallbackId: String? = null

    private lateinit var neoPosLauncher: ActivityResultLauncher<Intent>

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // ===== ANTI-TAMPERING =====
        // Verificar que el APK fue firmado con el keystore oficial Julia Bakery.
        // Si fue re-firmado (decompile + repack), bloquear y mostrar mensaje.
        // En DEBUG no aplica (SignatureGuard.verify devuelve true).
        if (!SignatureGuard.verify(this)) {
            Log.e("MainActivity", "Firma del APK no coincide. Bloqueando.")
            AlertDialog.Builder(this)
                .setTitle("Aplicación no oficial")
                .setMessage("Esta versión de Julia Bakery POS fue alterada o no proviene del repositorio oficial. " +
                    "Por seguridad la aplicación se cerrará. Contactá al administrador.")
                .setCancelable(false)
                .setPositiveButton("Cerrar") { _, _ ->
                    finishAffinity()
                    android.os.Process.killProcess(android.os.Process.myPid())
                }
                .show()
            return  // No inicializar nada mas
        }

        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        // Habilitar inspeccion remota chrome://inspect en debug.
        if (BuildConfig.WEBVIEW_DEBUG) {
            WebView.setWebContentsDebuggingEnabled(true)
        }

        // Permitir cookies (Supabase auth las usa).
        CookieManager.getInstance().setAcceptCookie(true)
        CookieManager.getInstance().setAcceptThirdPartyCookies(binding.webview, true)

        setupWebView()
        setupNeoPosLauncher()

        // Bind al InnerPrinter Sunmi (best-effort). Si falla (device no Sunmi),
        // SunmiPrinter queda con isConnected()=false y JuliaPOS.printTicket
        // devuelve { ok: false, errorMessage: "no_sunmi_printer" } sin crashear.
        sunmiPrinter.bind(this) { ok ->
            Log.i("MainActivity", "Sunmi printer bind: $ok")
        }
    }

    override fun onDestroy() {
        try { sunmiPrinter.unbind(this) } catch (_: Exception) {}
        super.onDestroy()
    }

    private fun setupWebView() {
        binding.webview.apply {
            settings.apply {
                javaScriptEnabled = true
                domStorageEnabled = true
                databaseEnabled = true
                cacheMode = android.webkit.WebSettings.LOAD_DEFAULT
                userAgentString = "$userAgentString JuliaBakeryPOS/${BuildConfig.VERSION_NAME}"
                // Mismo viewport que un Chrome mobile estandar.
                useWideViewPort = true
                loadWithOverviewMode = true
                // No cargar archivos locales (security).
                allowFileAccess = false
                allowContentAccess = false
            }

            webChromeClient = object : WebChromeClient() {
                override fun onConsoleMessage(msg: android.webkit.ConsoleMessage): Boolean {
                    Log.d("JuliaWebView", "[${msg.messageLevel()}] ${msg.message()} @${msg.sourceId()}:${msg.lineNumber()}")
                    return true
                }
            }

            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(view: WebView, req: WebResourceRequest): Boolean {
                    val host = req.url.host ?: return false
                    // 1. Restringir a dominios de Julia.
                    val allowed = host.endsWith("vercel.app") || host == "julia-bakery.vercel.app"
                    if (!allowed) {
                        Toast.makeText(this@MainActivity, "Dominio bloqueado: $host", Toast.LENGTH_SHORT).show()
                        return true
                    }
                    // 2. Modo kiosko: solo permitimos rutas del scope cajero.
                    //    Cualquier modulo admin (inventario, planillas, dashboard,
                    //    configuracion, etc) queda bloqueado para que el cajero
                    //    no se distraiga / no rompa cosas.
                    //
                    //    Rutas permitidas para el cajero:
                    //      /                 login admin (back-door para soporte)
                    //      /pos              punto de venta
                    //      /cajero-login     login por PIN (kiosko default)
                    //      /abrir-caja       apertura de turno
                    //      /cerrar-caja      cierre de turno (con ticket impreso)
                    //      /mis-turnos       historial del cajero
                    //      /_next, /api, /auth, /static  assets / endpoints
                    val path = req.url.path ?: "/"
                    val rutasPermitidas = setOf(
                        "/", "/pos",
                        "/cajero-login", "/abrir-caja", "/cerrar-caja", "/mis-turnos",
                    )
                    val esPermitida = path in rutasPermitidas
                        || path.startsWith("/_next/")
                        || path.startsWith("/api/")
                        || path.startsWith("/auth/")
                        || path.startsWith("/static/")
                    if (!esPermitida) {
                        Log.w("MainActivity", "Ruta bloqueada en kiosko: $path")
                        Toast.makeText(this@MainActivity, "Esta seccion no esta disponible en el cajero", Toast.LENGTH_SHORT).show()
                        // Forzar vuelta al POS.
                        view.loadUrl(BuildConfig.JULIA_BASE_URL + BuildConfig.JULIA_POS_PATH)
                        return true
                    }
                    return false
                }

                override fun onPageStarted(view: WebView?, url: String?, favicon: android.graphics.Bitmap?) {
                    super.onPageStarted(view, url, favicon)
                    binding.spinner.visibility = View.VISIBLE
                }

                override fun onPageFinished(view: WebView, url: String?) {
                    super.onPageFinished(view, url)
                    binding.spinner.visibility = View.GONE
                    // Inyectar el bootstrap del bridge cada vez (por si la pagina cambia).
                    view.evaluateJavascript(JS_BOOTSTRAP, null)
                }
            }
        }

        // Crear bridge (lo necesitamos antes de cargar la pagina).
        bridge = JuliaPOSBridge(
            webView = binding.webview,
            scope = lifecycleScope,
            onLaunchIntent = ::launchNeoPosIntent,
            sunmiPrinter = sunmiPrinter,
        )
        binding.webview.addJavascriptInterface(bridge, "__JuliaPOSNative")

        val url = initialUrl()
        Log.i("MainActivity", "Loading URL: $url")
        binding.webview.loadUrl(url)
    }

    /**
     * Construye la URL inicial. Si el build incluye JULIA_BYPASS_TOKEN
     * (preview de Vercel con Deployment Protection), agrega los query
     * params para setear el cookie de bypass y persistirlo. Despues de la
     * primera navegacion, las requests subsecuentes (incluyendo el fetch
     * de /api/neonet/pos-credentials) van con el cookie automaticamente.
     */
    private fun initialUrl(): String {
        val base = BuildConfig.JULIA_BASE_URL + BuildConfig.JULIA_POS_PATH
        val token = BuildConfig.JULIA_BYPASS_TOKEN
        return if (token.isBlank()) base
        else "$base?x-vercel-protection-bypass=$token&x-vercel-set-bypass-cookie=true"
    }

    private fun setupNeoPosLauncher() {
        neoPosLauncher = registerForActivityResult(
            ActivityResultContracts.StartActivityForResult()
        ) { activityResult ->
            val cbId = pendingCallbackId
            pendingCallbackId = null
            if (cbId == null) {
                Log.w("MainActivity", "Recibido result sin callback pendiente")
                return@registerForActivityResult
            }
            // activityResult.data puede traer extras incluso con RESULT_CANCELED
            // si el NeoPOS App es generoso. Pasamos lo que haya.
            bridge.deliverIntentResult(cbId, activityResult.data)
        }
    }

    private fun launchNeoPosIntent(intent: Intent, callbackId: String) {
        // Validar que haya un app capaz de manejarlo (NeoPOS App).
        val pm = packageManager
        val resolveInfo = pm.resolveActivity(intent, PackageManager.MATCH_DEFAULT_ONLY)
        if (resolveInfo == null) {
            Log.e("MainActivity", "Ninguna app maneja com.visanet.pos.START_ACTIVITY")
            bridge.rejectCallback(callbackId, getString(R.string.error_neopos_missing))
            return
        }
        pendingCallbackId = callbackId
        try {
            neoPosLauncher.launch(intent)
        } catch (e: Exception) {
            pendingCallbackId = null
            Log.e("MainActivity", "Fallo lanzando Intent NeoPOS", e)
            bridge.rejectCallback(callbackId, "Fallo lanzando NeoPOS: ${e.message}")
        }
    }

    override fun onBackPressed() {
        // Si la WebView puede ir atras, dejarla. Si no, salir de la app.
        if (binding.webview.canGoBack()) binding.webview.goBack()
        else super.onBackPressed()
    }

    companion object {
        /**
         * Bootstrap JS inyectado al onPageFinished. Expone window.JuliaPOS con
         * startSale() como Promise. El raw bridge (__JuliaPOSNative) es
         * fire-and-forget; la promesa se resuelve cuando Kotlin llama a
         * __JuliaPOSResolve.
         */
        private val JS_BOOTSTRAP = """
            (function(){
              if (window.JuliaPOS && window.JuliaPOS.__installed) return;
              var pending = {};
              window.__JuliaPOSResolve = function(id, result){
                var p = pending[id];
                if (!p) { console.warn('JuliaPOS: callback', id, 'no pending'); return; }
                delete pending[id];
                try { p.resolve(result); } catch(e){ p.reject(e); }
              };
              function uid(){
                return 's_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2,8);
              }
              window.JuliaPOS = {
                __installed: true,
                __version: '0.2.0',
                startSale: function(payload){
                  return new Promise(function(resolve, reject){
                    var id = uid();
                    pending[id] = { resolve: resolve, reject: reject };
                    try {
                      window.__JuliaPOSNative.startSale(JSON.stringify(payload), id);
                    } catch(e){
                      delete pending[id];
                      reject(e);
                    }
                    // Timeout defensivo: si el NeoPOS App nunca devuelve.
                    setTimeout(function(){
                      if (pending[id]) {
                        delete pending[id];
                        reject(new Error('Timeout esperando respuesta del NeoPOS App (90s)'));
                      }
                    }, 90000);
                  });
                },
                /**
                 * Imprime un ticket de venta en la termica del Sunmi.
                 * payload: {
                 *   merchantName, merchantSubtitle?, merchantAddress?, merchantNit?,
                 *   receptorNit, receptorNombre, fecha, cajeroNombre?, metodoPago?,
                 *   items: [{ descripcion, cantidad, precioUnitario, subtotal }, ...],
                 *   totalGravado, iva, total,
                 *   uuidSat?, serieSat?, numeroSat?, certificador?
                 * }
                 * Returns: Promise<{ ok: boolean, error_message?: string }>
                 */
                printTicket: function(payload){
                  return new Promise(function(resolve, reject){
                    var id = uid();
                    pending[id] = { resolve: resolve, reject: reject };
                    try {
                      window.__JuliaPOSNative.printTicket(JSON.stringify(payload), id);
                    } catch(e){
                      delete pending[id];
                      reject(e);
                    }
                    setTimeout(function(){
                      if (pending[id]) {
                        delete pending[id];
                        reject(new Error('Timeout esperando impresion (15s)'));
                      }
                    }, 15000);
                  });
                }
              };
              console.log('[JuliaPOS] bridge instalado v0.2.0');
            })();
        """.trimIndent()
    }
}
