import { invokeIPC } from '../services/tauriClient';

/**
 * Android kabuğunun JavaScript köprüsü (Chrome Custom Tabs). Masaüstünde ve tarayıcıda yoktur.
 * Google, gömülü WebView'da OAuth'u reddeder; uygulama içi sekme onun kabul ettiği yoldur.
 */
interface NativeBridge {
  openGoogle: (url: string) => void;
}

declare global {
  interface Window {
    KasamNative?: NativeBridge;
  }
}

/**
 * Siteden bilinen bir sayfayı açar. Google girişi masaüstünde uygulama penceresinde, Android'de
 * uygulama içi sekmede açılır; yasal metinler sistem tarayıcısında kalır. Adresi Rust üretir ve
 * doğrular, arayüz serbest adres vermez.
 */
export async function openSitePage(path: string): Promise<void> {
  const bridge = typeof window === 'undefined' ? undefined : window.KasamNative;
  const url = await invokeIPC<string>('open_site_page', { path, inApp: bridge !== undefined });
  if (bridge && path.endsWith('/google')) bridge.openGoogle(url);
}

/** Giriş bitince ya da vazgeçilince uygulama içi Google penceresini kapatır; pencere yoksa sessiz geçer. */
export async function closeGoogleLogin(): Promise<void> {
  try {
    await invokeIPC('close_google_login');
  } catch {
    // Pencere zaten kapalıysa yapılacak bir şey yok.
  }
}
