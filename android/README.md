# Julia Bakery POS — Wrapper Android (Sunmi D3 Mini)

Wrapper minimo de WebView para correr el POS de Julia Bakery dentro del
Sunmi D3 Mini y poder disparar el Intent `com.visanet.pos.START_ACTIVITY`
del **NeoPOS App** de Neonet/Visanet.

La app NO contiene logica de negocio — solo:

1. Carga `https://julia-bakery.vercel.app/pos` (o lo que digas en
   `JULIA_BASE_URL`) dentro de una WebView.
2. Expone `window.JuliaPOS.startSale({ idsale, amount_cents })` al JS de
   Julia. La promesa resuelve con `{ respuesta_lector: {...} }`.
3. Cuando el JS llama startSale, el wrapper:
   1. Pide credenciales al backend (`/api/neonet/pos-credentials`).
   2. Arma el Intent del NeoPOS App con los extras correctos.
   3. Espera el resultado y lo reinjecta a la WebView.

## Estructura

```
android/
├── build.gradle / settings.gradle / gradle.properties
├── gradle/wrapper/gradle-wrapper.properties
└── app/
    ├── build.gradle
    ├── proguard-rules.pro
    └── src/main/
        ├── AndroidManifest.xml
        ├── java/com/juliabakery/pos/
        │   ├── MainActivity.kt       # WebView + Intent wiring
        │   ├── JuliaPOSBridge.kt     # @JavascriptInterface + Intent build
        │   └── PosModels.kt          # Serializable DTOs
        └── res/
            ├── layout/activity_main.xml
            ├── values/{strings,colors,themes,ic_launcher_background}.xml
            ├── xml/{network_security_config,data_extraction_rules}.xml
            ├── drawable/ic_launcher_foreground.xml
            └── mipmap-anydpi-v26/ic_launcher.xml
```

## Build

### Debug (iteración rápida) vs Release (instalable estable)

| | Debug | Release |
|---|---|---|
| Firma | debug-signed (autogenerada Android) | release-signed (keystore propio) |
| Script | `./build-apk.sh` | `./build-release.sh` |
| Salida | `app/build/outputs/apk/debug/app-debug.apk` | `app/build/outputs/apk/release/app-release.apk` |
| Updates limpios | ❌ pierde sesión al re-instalar | ✅ updates preservan cookies |
| Warning Android | Sí (fuente desconocida) | Solo primera vez |
| Para qué | Dev local rápido | Distribuir al Sunmi / Play Store |

**Keystore release** (no se commitea, vive en `~/.juliabakery/julia-release.jks`):

- Generado con `keytool -genkeypair -keyalg RSA -keysize 2048 -validity 9125 -alias julia-pos`
- Password guardada en 1Password/Bitwarden bajo "Julia Bakery — Android Release Keystore"
- DN: `CN=Julia Bakery POS, OU=POS, O=Julia Bakery, L=Guatemala City, ST=Guatemala, C=GT`
- Cert SHA-256: `b3b6af73996b522d1fc94bf688cea55559c74ab65ecd4e47e7e594a52f96f9a2`
- Validez: 25 años (recomendado para Play Store)

⚠️ **Si perdés el keystore, la app no se puede actualizar.** Para nuevas
instalaciones siempre podrías recrearla, pero Play Store la trataría como
una app distinta. Backup obligatorio.

### Requisitos

- JDK 17
- Android SDK (cmdline-tools o Android Studio Hedgehog+)
- `ANDROID_HOME` apuntando al SDK

Si tenes Android Studio, simplemente abrilo apuntando a `android/` y
deja que descargue lo que falta.

### Linea de comandos

Primera vez, generar el Gradle wrapper jar (este repo no lo trackea):

```bash
cd android
gradle wrapper --gradle-version 8.7   # solo la primera vez
```

Build APK debug:

```bash
./gradlew assembleDebug
# Salida: app/build/outputs/apk/debug/app-debug.apk
```

### Build apuntando a un preview de Vercel

Util para testear contra una branch antes de mergear a prod:

```bash
./gradlew assembleDebug -PJULIA_BASE_URL="https://julia-bakery-XXXX-cr96devs-projects.vercel.app"
```

(Si el preview tiene Deployment Protection prendida, vas a necesitar pasar
el bypass como cookie inicialmente — abrir la URL una vez en la WebView
con el `?x-vercel-protection-bypass=...&x-vercel-set-bypass-cookie=true`.)

## Sideload en Sunmi D3 Mini

1. Activar **Opciones de desarrollador** + **Depuracion USB** en el Sunmi
   (Settings → About → tocar Build Number 7 veces → volver atras → Developer).
2. Conectar Sunmi por USB.
3. `adb devices` debe listar el dispositivo.
4. Verificar que el NeoPOS App este instalado:
   ```bash
   adb shell pm list packages | grep -i visanet
   # esperamos algo como package:com.visanet.pos o com.visanet.neopos
   ```
   Si no aparece, instalar el .apk del NeoPOS App que Neonet provee.
5. Instalar nuestro wrapper:
   ```bash
   adb install -r app/build/outputs/apk/debug/app-debug.apk
   ```
6. Lanzar:
   ```bash
   adb shell am start -n com.juliabakery.pos/.MainActivity
   ```
   o tocar el icono "Julia Bakery POS" en el launcher del Sunmi.
7. Logueate en la WebView con tu usuario admin (las cookies de Supabase
   persisten).

## Testing del bridge

### Sin Sunmi (emulador Android Studio)

El emulador no tiene NeoPOS App instalado. Cualquier intento de cobrar
con tarjeta caera al error `error_neopos_missing`. Util para validar el
resto del flujo (UI, fetch de credenciales, manejo de errores).

### Con Sunmi (D3 Mini)

Flujo de prueba:

1. Abrir la app.
2. Loguearse como admin.
3. POS → agregar producto al carrito → Cobrar.
4. Elegir "Tarjeta".
5. La WebView muestra "Procesando tarjeta · Q XXX".
6. NeoPOS App abre su UI (chip / tap / banda).
7. Pasar tarjeta de prueba contra QA_HIDROCOM.
8. NeoPOS devuelve, WebView muestra el ticket aprobado.
9. Verificar en `neonet_transacciones`:
   ```sql
   SELECT idsale, retrieval_no, authorization_code, approved, origen, factura_id
   FROM neonet_transacciones ORDER BY created_at DESC LIMIT 5;
   ```
   - `origen` deberia ser `'sandbox'` (no `'mock'`)
   - `factura_id` deberia estar lleno (FEL emitido)

## Troubleshooting

| Sintoma | Causa probable | Solucion |
|---|---|---|
| `error_neopos_missing` | NeoPOS App no instalado | `pm list packages` y reinstalar |
| Cobro se queda colgado 90s+ | Intent lanzo pero no recibio response | Mirar logcat `JuliaPOSBridge` |
| `pos-credentials HTTP 401` | Cookie de Supabase no esta en la WebView | Cerrar sesion y loguearse de nuevo |
| `pos-credentials HTTP 403` | Tu usuario no tiene rol admin | Cambiar perfil en BD |
| WebView blanca al arrancar | URL bloqueada por network_security_config | Revisar dominio en `xml/network_security_config.xml` |
| Cobro aprueba pero FEL falla | Bug del backend, NO del wrapper | Mirar logs Vercel `/api/pos/ventas` |

## Logcat util

```bash
# Filtrar logs del wrapper
adb logcat -s JuliaPOSBridge:V MainActivity:V JuliaWebView:V AndroidRuntime:E

# Console.log() del JS aparece como JuliaWebView (via WebChromeClient).
```

## Roadmap

- [ ] **Fase 3 (esta entrega)**: scaffold + bridge + Intent + credenciales JIT.
- [ ] Testing real contra QA_HIDROCOM con Sunmi fisico.
- [ ] Cutover a credenciales reales de Julia (Fase 4).
- [ ] Recibir push de Loyverse via Intent? (Sunmi soporta Bluetooth/printer
      tambien — eventualmente integrar el printer nativo para tickets bonitos).
- [ ] OTA update del APK (cuando salga la version 1.0 estable).

## Seguridad

- El APK NO contiene secretos. `merchantUser`/`merchantPasswd`/`JWT`
  vienen del backend en cada cobro.
- Solo admin autenticado puede pedirlos (`requireAdmin` en
  `/api/neonet/pos-credentials`).
- `Cache-Control: no-store` en la respuesta del endpoint para evitar
  proxies intermedios.
- Cleartext desactivado (`android:usesCleartextTraffic="false"`).
- `allowBackup="false"` para no exportar las cookies de la WebView via
  `adb backup`.
