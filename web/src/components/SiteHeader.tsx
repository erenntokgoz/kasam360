'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { navLinks } from '@/content/siteConfig';
import { authGet } from '@/lib/authApi';

type Theme = 'light' | 'dark';

// Tema seçimi tarayıcıda hatırlanır; gizli pencerede depolama kapalıysa seçim yalnız o sayfada kalır.
function useTheme(): [Theme | null, () => void] {
  const [theme, setTheme] = useState<Theme | null>(null);
  useEffect(() => {
    setTheme(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
  }, []);
  const toggle = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('k360-theme', next); } catch { /* depolama kapalı: seçim kalıcı olmaz */ }
    setTheme(next);
  };
  return [theme, toggle];
}

// Oturum çerezi httpOnly olduğu için menü durumu sunucuya sorulur. Sayfa ilk çizimde misafir menüsüyle gelir;
// JavaScript kapalı ziyaretçi de giriş bağlantısını görür. Geri tuşuyla önbellekten dönen sayfa (çıkıştan sonra)
// eski hesap menüsünü göstermesin diye pageshow'da yeniden sorulur.
function useSignedIn(): boolean {
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => {
    const check = () => {
      void authGet<unknown>('/get-session').then((result) => setSignedIn(result.ok && Boolean(result.data)));
    };
    check();
    const onPageShow = (event: PageTransitionEvent) => { if (event.persisted) check(); };
    window.addEventListener('pageshow', onPageShow);
    return () => window.removeEventListener('pageshow', onPageShow);
  }, []);
  return signedIn;
}

const guestLinks = [
  { href: '/giris', label: 'Giriş yap', className: 'k-btn k-btn-ghost' },
  { href: '/kayit', label: 'Kayıt olun', className: 'k-btn k-btn-buy' },
];
const memberLinks = [
  { href: '/destek', label: 'Destek', className: 'k-btn k-btn-ghost' },
  { href: '/hesabim', label: 'Hesabım', className: 'k-btn k-btn-line' },
];

export function SiteHeader() {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [theme, toggleTheme] = useTheme();
  const accountLinks = useSignedIn() ? memberLinks : guestLinks;

  useEffect(() => {
    if (!menuOpen) return undefined;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [menuOpen]);

  const themeLabel = theme === 'dark' ? 'Gündüz temasına geç' : 'Gece temasına geç';

  return (
    <header className="k-root k-header" style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}>
      <div className="k-wrap">
        <Link href="/" className="k-brand" aria-label="KASAM360 ana sayfa" onClick={() => setMenuOpen(false)}>
          <Image className="k-logo-dark" src="/logo/kasam360-ikon-kucuk-koyu-zemin.svg" alt="" width={28} height={28} priority />
          <Image className="k-logo-light" src="/logo/kasam360-ikon-kucuk-renkli.svg" alt="" width={28} height={28} priority />
          KASAM360
        </Link>
        <nav className="k-nav" aria-label="Ana menü">
          {navLinks.map((link) => (
            <Link key={link.href} href={link.href} aria-current={pathname === link.href ? 'page' : undefined}>
              {link.label}
            </Link>
          ))}
        </nav>
        <div className="k-header-end">
          {accountLinks.map((link) => (
            <Link key={link.href} href={link.href} className={`${link.className} k-hide-sm`} aria-current={pathname === link.href ? 'page' : undefined}>
              {link.label}
            </Link>
          ))}
          <button type="button" className="k-btn k-btn-line k-menu-btn" aria-expanded={menuOpen} aria-controls="mobile-menu" onClick={() => setMenuOpen((open) => !open)}>
            {menuOpen ? 'Kapat' : 'Menü'}
          </button>
          <span className="k-header-sep" aria-hidden="true" />
          <button type="button" className="k-theme-btn" onClick={toggleTheme} aria-label={themeLabel} title={themeLabel} suppressHydrationWarning>
            {/* İki ikon da çizilir; hangisinin görüneceğini tema özniteliği belirler, ilk boyamada yanlış ikon görünmez. */}
            <svg className="k-ico-moon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 14.2A8.5 8.5 0 0 1 9.8 3.5a8.5 8.5 0 1 0 10.7 10.7Z" /></svg>
            <svg className="k-ico-sun" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4.2" /><path d="M12 2.5v2.2M12 19.3v2.2M4.6 4.6l1.6 1.6M17.8 17.8l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.6 19.4l1.6-1.6M17.8 6.2l1.6-1.6" /></svg>
          </button>
        </div>
      </div>
      {menuOpen && (
        <nav id="mobile-menu" className="k-mobile" aria-label="Mobil menü">
          {navLinks.map((link) => (
            <Link key={link.href} href={link.href} aria-current={pathname === link.href ? 'page' : undefined} onClick={() => setMenuOpen(false)}>
              {link.label}
            </Link>
          ))}
          {accountLinks.map((link) => (
            <Link key={link.href} href={link.href} className={link.href === '/kayit' ? 'k-btn k-btn-buy' : undefined}
              aria-current={pathname === link.href ? 'page' : undefined} onClick={() => setMenuOpen(false)}>
              {link.label}
            </Link>
          ))}
        </nav>
      )}
    </header>
  );
}
