package com.juliabakery.kpbridge

import android.content.Intent
import android.net.wifi.WifiManager
import android.os.Build
import android.os.Bundle
import android.text.Editable
import android.text.TextWatcher
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import com.juliabakery.kpbridge.databinding.ActivityMainBinding
import java.net.InetAddress
import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * UI minimalista del bridge:
 *  - Muestra IP+puerto actual (lo que el /pos va a apuntar)
 *  - Botones Start/Stop del BridgeService
 *  - Form para mposURL / user / password / deviceID
 *  - Boton "Probar conexion" que hace ping a SmartPOS via Intent
 *
 * Pensada para que el operador configure una sola vez tras instalar el APK
 * y nunca mas la abra (el service queda corriendo solo).
 */
class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding
    private lateinit var cfg: Config

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        cfg = Config(this)
        renderIp()
        cargarConfigEnForm()
        wireListeners()
    }

    override fun onResume() {
        super.onResume()
        renderIp()
    }

    private fun renderIp() {
        val ip = ipLocal() ?: "?"
        binding.txtIp.text = getString(R.string.bridge_url_fmt, ip, BuildConfig.BRIDGE_PORT)
    }

    private fun cargarConfigEnForm() {
        binding.edMposUrl.setText(cfg.mposUrl)
        binding.edUser.setText(cfg.user)
        binding.edPass.setText(cfg.password)
        binding.edDevice.setText(cfg.deviceId)
        binding.edEmail.setText(cfg.defaultEmail)
    }

    private fun wireListeners() {
        binding.btnStart.setOnClickListener {
            guardarConfig()
            val svc = Intent(this, BridgeService::class.java)
            if (Build.VERSION.SDK_INT >= 26) startForegroundService(svc) else startService(svc)
            toast("Bridge corriendo en :${BuildConfig.BRIDGE_PORT}")
        }
        binding.btnStop.setOnClickListener {
            stopService(Intent(this, BridgeService::class.java))
            toast("Bridge detenido")
        }
        binding.btnGuardar.setOnClickListener {
            guardarConfig()
            toast("Config guardada")
        }
        binding.btnTest.setOnClickListener {
            guardarConfig()
            probarConexion()
        }
        // Auto-save mientras editan (debounce simple)
        val watcher = object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {}
            override fun afterTextChanged(s: Editable?) {}
        }
        listOf(binding.edMposUrl, binding.edUser, binding.edPass, binding.edDevice, binding.edEmail)
            .forEach { it.addTextChangedListener(watcher) }
    }

    private fun guardarConfig() {
        cfg.mposUrl = binding.edMposUrl.text.toString().ifBlank { BuildConfig.MPOS_URL }
        cfg.user = binding.edUser.text.toString()
        cfg.password = binding.edPass.text.toString()
        cfg.deviceId = binding.edDevice.text.toString()
        cfg.defaultEmail = binding.edEmail.text.toString()
    }

    /**
     * "Probar conexion" = chequear si el package del SmartPOS (cfg.mposUrl)
     * esta instalado y se puede invocar.
     */
    private fun probarConexion() {
        try {
            packageManager.getPackageInfo(cfg.mposUrl, 0)
            toast("OK: ${cfg.mposUrl} esta instalado")
        } catch (e: Exception) {
            toast("NO: ${cfg.mposUrl} no se encuentra. ¿Es el package correcto?")
        }
    }

    private fun toast(msg: String) {
        Toast.makeText(this, msg, Toast.LENGTH_SHORT).show()
    }

    /** Devuelve la IP de la WiFi actual del device. */
    private fun ipLocal(): String? {
        return try {
            val wifi = applicationContext.getSystemService(WIFI_SERVICE) as WifiManager
            val ipInt = wifi.connectionInfo.ipAddress
            if (ipInt == 0) return null
            // Reordenar bytes (little-endian -> network byte order)
            val bytes = ByteBuffer.allocate(4).order(ByteOrder.LITTLE_ENDIAN).putInt(ipInt).array()
            InetAddress.getByAddress(bytes).hostAddress
        } catch (e: Exception) {
            null
        }
    }
}
