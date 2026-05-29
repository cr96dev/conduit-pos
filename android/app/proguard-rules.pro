# Proguard rules para release con R8 minify + obfuscation.
#
# Lo que protege:
# - Codigo de negocio renombrado a a/b/c (decompilar sigue siendo posible
#   pero entender es 10x mas dificil)
# - Strings literales restantes mas dificiles de localizar
#
# Lo que NO debe minificarse (causaria crash en runtime):
# - @JavascriptInterface methods (la WebView los llama por nombre)
# - @Serializable data classes de kotlinx.serialization
# - AIDL Sunmi (Binder TX_CODE depende del orden y nombres)
# - SignatureGuard (anti-debug — el guard usa la propia clase, debe sobrevivir)
# - MainActivity (referenced from AndroidManifest)
# - ViewBinding generated
# - BuildConfig fields

# =======================
# JavascriptInterface
# =======================
-keep class com.juliabakery.pos.JuliaPOSBridge {
    public *;
}
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# =======================
# Activities / Receivers / Services referenced from manifest
# =======================
-keep class com.juliabakery.pos.MainActivity { *; }

# =======================
# SignatureGuard (anti-tampering check)
# Tiene que sobrevivir a la minificacion para que la verificacion corra.
# =======================
-keep class com.juliabakery.pos.SignatureGuard { *; }

# =======================
# kotlinx.serialization
# Mantener Companion + serializer + descriptor de TODOS los @Serializable
# =======================
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.AnnotationsKt

-keep,includedescriptorclasses class com.juliabakery.pos.**$$serializer { *; }
-keepclassmembers class com.juliabakery.pos.** {
    *** Companion;
}
-keepclasseswithmembers class com.juliabakery.pos.** {
    kotlinx.serialization.KSerializer serializer(...);
}

# Mantener intactos los data classes Serializable
-keep @kotlinx.serialization.Serializable class com.juliabakery.pos.** {
    *;
}

# =======================
# AIDL Sunmi InnerPrinter
# El binder Sunmi llama por TX_CODE y nombres exactos — NO renombrar.
# =======================
-keep class woyou.aidlservice.jiuiv5.** { *; }
-keep interface woyou.aidlservice.jiuiv5.** { *; }

# =======================
# ViewBinding (generadas por gradle)
# =======================
-keep class com.juliabakery.pos.databinding.** { *; }

# =======================
# BuildConfig (usado por SignatureGuard para detectar debug)
# =======================
-keep class com.juliabakery.pos.BuildConfig { *; }

# =======================
# Kotlin metadata + reflection minima
# =======================
-keepattributes Signature, *Annotation*
-keep class kotlin.Metadata { *; }
-dontwarn kotlinx.coroutines.**
-dontwarn kotlinx.serialization.**

# =======================
# Mantener nombres de Throwable / Exception para stack traces utiles
# =======================
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

# =======================
# AndroidX core / appcompat — confiamos en sus consumer rules.
# Pero por las dudas:
# =======================
-dontwarn androidx.**

# =======================
# WebView callbacks
# =======================
-keep class * extends android.webkit.WebViewClient { *; }
-keep class * extends android.webkit.WebChromeClient { *; }
