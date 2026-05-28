# Keep las clases con @JavascriptInterface accesibles desde la WebView.
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# Keep kotlinx.serialization (descriptor metadata).
-keep,includedescriptorclasses class com.juliabakery.pos.**$$serializer { *; }
-keepclassmembers class com.juliabakery.pos.** {
    *** Companion;
}
-keepclasseswithmembers class com.juliabakery.pos.** {
    kotlinx.serialization.KSerializer serializer(...);
}
