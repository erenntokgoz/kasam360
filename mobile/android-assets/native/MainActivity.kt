package com.kasam360.mobile

import android.net.Uri
import android.os.Bundle
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.browser.customtabs.CustomTabsIntent

/**
 * Google girişi uygulama içinde Chrome Custom Tabs ile açılır. Google gömülü WebView'da OAuth'u
 * reddeder; Custom Tabs uygulamanın üstünde açılan ve çerezleri tarayıcıyla paylaşan kabul edilmiş yoldur.
 * Giriş bitince site `kasam360://google-done` adresine yönlenir, uygulama öne gelir ve sekme arkada kalır;
 * oturum bilgisi uygulamadaki tek kullanımlık kod yoklamasıyla taşınır, bu adres veri taşımaz.
 */
class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
  }

  override fun onWebViewCreate(webView: WebView) {
    webView.addJavascriptInterface(NativeBridge(), "KasamNative")
  }

  private inner class NativeBridge {
    @JavascriptInterface
    fun openGoogle(url: String) {
      val target = Uri.parse(url)
      // Köprüyü yalnız uygulamanın kendi sayfaları çağırır; yine de yalnız site adresi açılır.
      val allowed = target.scheme == "https" && target.host == "kasam360.com.tr" &&
        target.path?.startsWith("/api/desktop-link/") == true
      if (!allowed) return
      runOnUiThread {
        CustomTabsIntent.Builder().setShowTitle(true).build().launchUrl(this@MainActivity, target)
      }
    }
  }
}
