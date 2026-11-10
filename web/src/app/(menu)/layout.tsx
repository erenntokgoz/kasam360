import { Fraunces } from 'next/font/google';
import type { ReactNode } from 'react';
import './menu.css';

// İşletme adı için karakterli bir serif display yazı tipi; latin-ext alt kümesi Türkçe harfleri (ğ ş ı İ) kapsar.
// Derlemede siteye alınır, ziyaretçi üçüncü taraf yazı tipi sunucusuna gitmez.
const display = Fraunces({ subsets: ['latin', 'latin-ext'], variable: '--font-display', axes: ['opsz'] });

// Müşteri menüsü sitenin üst menüsünü ve alt bilgisini taşımaz. Tema: kayıtlı seçim, yoksa cihazın teması
// (müşteri kendi telefonunun koyu/açık ayarını görür). Betik içerik boyanmadan çalışır.
const menuThemeInit =
  "try{var s=localStorage.getItem('k360-theme');var d=s?s==='dark':matchMedia('(prefers-color-scheme: dark)').matches;document.documentElement.dataset.theme=d?'dark':'light'}catch(e){}";

export default function MenuLayout({ children }: { children: ReactNode }) {
  return (
    <div className={display.variable}>
      <script dangerouslySetInnerHTML={{ __html: menuThemeInit }} />
      <noscript>
        <style>{'.m-img,.m-card,.m-list{opacity:1!important}'}</style>
      </noscript>
      {children}
    </div>
  );
}
