#!/bin/bash
# build-apk.sh — build APK debug del wrapper Julia Bakery POS.
# Usa el JDK 17 embebido en Android Studio y el SDK en ~/Library/Android/sdk.
#
# Uso:
#   ./build-apk.sh                                           # build prod
#   ./build-apk.sh "https://julia-bakery-XXX.vercel.app"    # build preview (sin protection)
#   ./build-apk.sh "https://julia-bakery-XXX.vercel.app" "BYPASS_TOKEN"  # preview con Deployment Protection
set -euo pipefail

cd "$(dirname "$0")"

# 1. JDK embebido en Android Studio (Hedgehog+ trae JBR 17).
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
if [[ ! -x "$JAVA_HOME/bin/java" ]]; then
  echo "ERROR: JDK no encontrado en $JAVA_HOME" >&2
  echo "Instala/actualiza Android Studio o ajusta JAVA_HOME a mano." >&2
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

echo "JAVA_HOME=$JAVA_HOME"
echo "java -version:"; java -version
echo "ANDROID_HOME=$ANDROID_HOME"

# 3. Generar gradle wrapper si no existe (no trackeamos el jar en git).
if [[ ! -f gradle/wrapper/gradle-wrapper.jar ]]; then
  if ! command -v gradle >/dev/null 2>&1; then
    echo "ERROR: gradle no esta en PATH. Instalalo con 'brew install gradle'." >&2
    exit 1
  fi
  echo "Generando gradle wrapper..."
  gradle wrapper --gradle-version 8.7 --distribution-type bin
fi

# 4. Override de URL backend + bypass token si los pasaron.
EXTRA_ARGS=()
if [[ $# -ge 1 && -n "$1" ]]; then
  EXTRA_ARGS+=("-PJULIA_BASE_URL=$1")
  echo "Apuntando a backend: $1"
fi
if [[ $# -ge 2 && -n "$2" ]]; then
  EXTRA_ARGS+=("-PJULIA_BYPASS_TOKEN=$2")
  echo "Bypass token configurado (longitud ${#2})"
fi

# 5. Build.
./gradlew assembleDebug ${EXTRA_ARGS[@]+"${EXTRA_ARGS[@]}"}

APK=app/build/outputs/apk/debug/app-debug.apk
if [[ -f "$APK" ]]; then
  SIZE=$(du -h "$APK" | cut -f1)
  echo ""
  echo "============================================="
  echo "APK generado: $APK ($SIZE)"
  echo "============================================="
  echo ""
  echo "Sideload al Sunmi:"
  echo "  adb devices                      # confirma que esta conectado"
  echo "  adb install -r $APK"
  echo "  adb shell am start -n com.juliabakery.pos/.MainActivity"
fi
