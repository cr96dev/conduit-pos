# Julia POS Bridge — Kinpos SmartPOS sobre HTTP

App Android que vive en la **PAX A920** (terminal POS de BAC con `192.168.0.46`)
y expone un mini HTTP server en el puerto **8081**. Hace de puente entre
nuestro `/pos` webview (que corre en la Sunmi) y la app SmartPOS de Kinpos
(que vive en la misma PAX y solo se invoca por Android Intent).

## Arquitectura

```
Sunmi (cajero)                       PAX A920 (lector card)
   /pos webview                         ┌────────────────────────────┐
   fetch('http://192.168.0.46:8081/sale')  │  JuliaPOSBridge (esta APK) │
                          ───────────►   │  └─> NanoHTTPD :8081        │
                                          │     POST /sale              │
                                          │     ↓ (Android Intent)      │
                                          │  KP_Invocador.KP_Sale(...)  │
                                          │     ↓                       │
                                          │  SmartPOS (CREKPS)          │
                                          │     ↓ (TCP+TLS)             │
                                          │  BAC servidor central       │
                                          └────────────────────────────┘
```

## Endpoints

- `GET /status` — health check + estado de la config
- `POST /sale` — `{idsale?, amount_cents, tax_cents?, tip_cents?, email?, cellphone?}` → dispatches sale, returns `{ok, idsale, status:'pending', poll_url}`
- `GET /sale/{idsale}/status` — `{idsale, status:'pending'|'approved'|'rejected'|'error', respuesta_lector?, error?}`

CORS abierto (`Access-Control-Allow-Origin: *`) para que `/pos` pueda llamar desde el browser.

## Build + sideload a la PAX

### 1. Copiar el AAR

```bash
cp ~/Downloads/Integracion\ PAX\ A920/kpinvocacion-release\ 1225.aar \
   android-kpbridge/app/libs/kpinvocacion.aar
```

### 2. Build

```bash
cd android-kpbridge
ANDROID_HOME=~/Library/Android/sdk \
JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home" \
./gradlew assembleRelease
```

(Si no tenés gradle wrapper todavía: `gradle wrapper --gradle-version 8.7` desde un Android Studio una vez.)

### 3. Conectar adb a la PAX A920

La PAX está en `192.168.0.46`. Para adb sobre WiFi suele necesitar habilitar
"Developer mode" + "USB debugging" desde la PAX:

```bash
adb connect 192.168.0.46:5555
adb devices    # debería listar la PAX
```

### 4. Install

```bash
adb -s 192.168.0.46:5555 install -r app/build/outputs/apk/release/app-release.apk
adb -s 192.168.0.46:5555 shell am start -n com.juliabakery.kpbridge/.MainActivity
```

### 5. Configurar credenciales (en la pantalla de la PAX)

- **Package name SmartPOS**: por defecto `com.kinpos.BASEA920`. Si el CREKPS
  tiene otro package (probable), correr:
  ```bash
  adb -s 192.168.0.46:5555 shell pm list packages | grep -iE "kinpos|crek"
  ```
  Y poner el que aparezca.
- **Usuario / Contraseña Kinpos**: las da Kinpos al alta del comercio.
- **Device ID**: probable que sea `P3865890` (el Terminal ID que sale en el
  recibo "TELECARGA PARAMETROS" del POS).
- **Email default**: para recibos digitales (opcional).

Tap **Iniciar bridge**.

### 6. Verificar desde la Sunmi (o tu Mac en la misma WiFi)

```bash
curl http://192.168.0.46:8081/status
# {"ok":true, "mpos_url":"com.kinpos.BASEA920", "config_valida":true, "port":8081}

curl -X POST http://192.168.0.46:8081/sale \
  -H 'Content-Type: application/json' \
  -d '{"amount_cents": 100, "idsale": "TEST_001"}'
# {"ok":true,"idsale":"TEST_001","status":"pending","poll_url":"/sale/TEST_001/status"}

# Pasar tarjeta en la PAX, ingresar PIN...

curl http://192.168.0.46:8081/sale/TEST_001/status
# {"idsale":"TEST_001","status":"approved","respuesta_lector":{...}}
```

### 7. Auto-start al boot

Ya está en `AndroidManifest.xml` (`BootReceiver` con `BOOT_COMPLETED`).
Si la PAX se reinicia, el bridge arranca solo.

## Integración con /pos

En `pages/pos.js`, reemplazar la llamada actual a `/api/pos/cobrar-tarjeta`
(que usa Vercel + WebAPI Neonet) por un fetch directo al bridge:

```js
async function cobrarTarjetaBacBridge({ idsale, amountCents }) {
  const r = await fetch('http://192.168.0.46:8081/sale', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idsale, amount_cents: amountCents }),
  })
  const json = await r.json()
  if (!json.ok) throw new Error(json.error || 'bridge rechazó')

  // Polling cada 1.5s hasta status != pending
  for (let i = 0; i < 80; i++) {  // 80 * 1.5s = 120s max
    await new Promise(r => setTimeout(r, 1500))
    const st = await fetch(`http://192.168.0.46:8081/sale/${idsale}/status`).then(r => r.json())
    if (st.status !== 'pending') return st
  }
  return { idsale, status: 'timeout' }
}
```

## Limitaciones conocidas

- **Sin TLS**: el bridge habla HTTP plano. Lo dejamos así porque es LAN
  privado del local; un sniff requiere entrar a la WiFi del comercio. Si
  querés hardening, se puede agregar self-signed cert + pinning.
- **Sin auth**: cualquier dispositivo en la misma WiFi puede invocar `/sale`.
  Para producción real considerar token Bearer simple en SharedPreferences
  + verificar header.
- **Una venta a la vez**: KP_Invocador serializa via startActivityForResult,
  no soporta paralelismo. El SaleManager guarda multiple pendientes en
  memoria pero solo una pasa por SmartPOS a la vez.
