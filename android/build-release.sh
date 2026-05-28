#!/bin/bash
# build-release.sh — build APK release firmado del wrapper Julia Bakery POS.
# Usa el keystore en ~/.juliabakery/julia-release.jks.
#
# Uso:
#   ./build-release.sh                                          # build apuntando a prod
#   ./build-release.sh "https://julia-bakery-XXX.vercel.app"   # apuntando a preview
#   ./build-release.sh "https://preview.vercel.app" "BYPASS"   # preview con Deployment Protection
#
# Pide el password del keystore una vez (sin echo).
set -euo pipefail

cd "$(dirname "$0")"

# 1. JDK embebido en Android Studio.
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
if [[ ! -x "$JAVA_HOME/bin/java" ]]; then
  echo "ERROR: JDK no encontrado en $JAVA_HOME" >&2
  exit 1
fi
export PATH="$JAVA_HOME/bin:$PATH"

# 2. Android SDK.
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
if [[ ! -d "$ANDROID_HOME" ]]; then
  echo "ERROR: ANDROID_HOME no encontrado en $ANDROID_HOME" >&2
  exit 1
fi
export ANDROID_SDK_ROOT="$ANDROID_HOME"

# 3. Keystore.
export JULIA_KEYSTORE_FILE="${JULIA_KEYSTORE_FILE:-$HOME/.juliabakery/julia-release.jks}"
export JULIA_KEY_ALIAS="${JULIA_KEY_ALIAS:-julia-pos}"
if [[ ! -f "$JULIA_KEYSTORE_FILE" ]]; then
  echo "ERROR: keystore no encontrado en $JULIA_KEYSTORE_FILE" >&2
  echo "Generalo con:" >&2
  echo "  keytool -genkeypair -keystore $JULIA_KEYSTORE_FILE -keyalg RSA -keysize 2048 -validity 9125 -alias julia-pos" >&2
  exit 1
fi

# 4. Password del keystore (sin echo).
if [[ -z "${JULIA_KEYSTORE_PASSWORD:-}" ]]; then
  printf "Password del keystore: " >&2
  stty -echo
  read -r JULIA_KEYSTORE_PASSWORD
  stty echo
  echo "" >&2
fi
export JULIA_KEYSTORE_PASSWORD
export JULIA_KEY_PASSWORD="${JULIA_KEY_PASSWORD:-$JULIA_KEYSTORE_PASSWORD}"

# 5. Args opcionales: URL backend + bypass token (igual que build-apk.sh).
EXTRA_ARGS=()
if [[ $# -ge 1 && -n "$1" ]]; then
  EXTRA_ARGS+=("-PJULIA_BASE_URL=$1")
  echo "Apuntando a backend: $1"
fi
if [[ $# -ge 2 && -n "$2" ]]; then
  EXTRA_ARGS+=("-PJULIA_BYPASS_TOKEN=$2")
  echo "Bypass token configurado (longitud ${#2})"
fi

# 6. Build release.
./gradlew assembleRelease "${EXTRA_ARGS[@]}"

APK=app/build/outputs/apk/release/app-release.apk
if [[ -f "$APK" ]]; then
  SIZE=$(du -h "$APK" | cut -f1)
  echo ""
  echo "============================================="
  echo "APK release firmado: $APK ($SIZE)"
  echo "============================================="
  echo ""
  echo "Verificar firma:"
  echo "  \$JAVA_HOME/bin/jarsigner -verify -verbose -certs $APK | head -5"
  echo ""
  echo "Instalar al Sunmi/Samsung (primera vez puede pedir confirmar fuente desconocida):"
  echo "  adb install -r $APK"
fi
