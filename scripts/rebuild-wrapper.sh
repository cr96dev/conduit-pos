#!/usr/bin/env bash
# scripts/rebuild-wrapper.sh
#
# Rebuild + sideload del wrapper Julia Bakery POS (com.juliabakery.pos).
# La firma usa el keystore ~/.juliabakery/julia-release.jks. La contraseña
# se pide con read -s (no aparece en pantalla ni en shell history).
#
# Uso:
#   bash scripts/rebuild-wrapper.sh
#
# Requisitos:
#   - Java 17 + Android SDK configurados (lo mismo que builds previas)
#   - Sunmi conectado via adb (192.168.0.13:38337 o USB)
#   - Keystore en ~/.juliabakery/julia-release.jks
#
# Que cambia en este rebuild (vs el APK 0.3.0 actual):
#   - TicketPayload.esReimpresion + reimpresionNum
#   - SunmiPrinter renderea banner "REIMPRESION N°X / DUPLICADO" arriba del
#     ticket cuando recibe esReimpresion=true (texto plano + ESC/POS)
#   - Necesario para que /facturacion/reimprimir funcione cumpliendo SAT

set -uo pipefail

cd "$(dirname "$0")/../android"

# === Android SDK ===========================================================
# Gradle necesita saber donde esta el SDK. Si no esta seteado, probamos las
# ubicaciones tipicas que crea Android Studio en macOS.
if [[ -z "${ANDROID_HOME:-}" && -z "${ANDROID_SDK_ROOT:-}" ]]; then
  for CANDIDATE in "$HOME/Library/Android/sdk" "$HOME/Library/Android/Sdk"; do
    if [[ -d "$CANDIDATE/platform-tools" ]]; then
      export ANDROID_HOME="$CANDIDATE"
      export ANDROID_SDK_ROOT="$CANDIDATE"
      echo "ANDROID_HOME=$ANDROID_HOME"
      break
    fi
  done
  if [[ -z "${ANDROID_HOME:-}" ]]; then
    echo "ERROR: no encuentro Android SDK."
    echo "  Abri Android Studio una vez y dejá que descargue el SDK,"
    echo "  o seteá ANDROID_HOME a la ruta de instalacion."
    exit 1
  fi
fi
# ===========================================================================

# === Java toolchain ========================================================
# Si no hay JAVA_HOME, usar el JBR que viene con Android Studio (path estandar
# en macOS). Es JDK 21 que es compatible con sourceCompatibility=17. Asi no
# requerimos al usuario instalar Java separado por su cuenta.
if [[ -z "${JAVA_HOME:-}" ]]; then
  ANDROID_STUDIO_JBR="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
  if [[ -x "$ANDROID_STUDIO_JBR/bin/java" ]]; then
    export JAVA_HOME="$ANDROID_STUDIO_JBR"
    export PATH="$JAVA_HOME/bin:$PATH"
    echo "JAVA_HOME=$JAVA_HOME (Android Studio JBR)"
  else
    echo "ERROR: no encuentro Java."
    echo "  JAVA_HOME no esta seteado y Android Studio JBR no esta en"
    echo "  $ANDROID_STUDIO_JBR"
    echo "  Opciones:"
    echo "  - Instalar Android Studio: https://developer.android.com/studio"
    echo "  - O 'brew install --cask zulu@17' y exportar JAVA_HOME"
    exit 1
  fi
fi
# ===========================================================================

KEYSTORE_PATH="${JULIA_KEYSTORE_FILE:-$HOME/.juliabakery/julia-release.jks}"
if [[ ! -f "$KEYSTORE_PATH" ]]; then
  echo "ERROR: keystore no existe en $KEYSTORE_PATH"
  exit 1
fi

echo "== Rebuild wrapper Julia Bakery POS =="
echo "Keystore: $KEYSTORE_PATH"
printf "Contraseña keystore (no se muestra): "
IFS= read -rs PASS
echo
if [[ -z "$PASS" ]]; then
  echo "vacio - aborto"
  exit 1
fi

# Export solo para la sesion de gradle, no para el shell padre.
export JULIA_KEYSTORE_PASSWORD="$PASS"
export JULIA_KEY_PASSWORD="$PASS"
unset PASS

echo
echo "== Compilando assembleRelease (puede tardar 1-3 min)..."
if ! ./gradlew assembleRelease; then
  echo
  echo "FAIL: gradle build fallo. Revisa output arriba."
  exit 1
fi

unset JULIA_KEYSTORE_PASSWORD JULIA_KEY_PASSWORD

APK="app/build/outputs/apk/release/app-release.apk"
if [[ ! -f "$APK" ]]; then
  echo "FAIL: APK no se genero en $APK"
  exit 1
fi

SIZE=$(du -h "$APK" | cut -f1)
echo
echo "== APK generado: $APK ($SIZE) =="

# Verificar device conectado
if ! adb devices | grep -qE "device$"; then
  echo "ADVERTENCIA: ningun device en adb. Conecta el Sunmi y corre:"
  echo "  adb install -r $APK"
  exit 0
fi

echo
echo "== Instalando en Sunmi via adb =="
if adb install -r "$APK"; then
  echo
  echo "== Version instalada =="
  adb shell dumpsys package com.juliabakery.pos 2>&1 | grep -E "versionName|versionCode|lastUpdateTime" | head -3
  echo
  echo "OK. Para probar:"
  echo "  - Abri Julia Bakery POS en el Sunmi"
  echo "  - Logueate"
  echo "  - Anda a /facturacion -> click una factura certificada -> Reimprimir"
  echo "  - El ticket deberia salir con banner 'REIMPRESION N°1' arriba"
else
  echo "FAIL: adb install fallo. Puede que el signature guard rechace si el"
  echo "keystore cambio. Mira el output arriba."
  exit 1
fi
