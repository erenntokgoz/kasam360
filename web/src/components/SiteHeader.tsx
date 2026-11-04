'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { navLinks } from '@/content/siteConfig';

export function SiteHeader() {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [menuOpen]);

  return (
    <header className="on-desk sticky z-40 bg-desk" style={{ top: 'env(safe-area-inset-top, 0px)' }}>
      <div className="gutter relative" style={{ paddingBottom: '18px' }}>
        <div className="flex h-[66px] items-center justify-between gap-4">
          <Link href="/" aria-label="KASAM360 ana sayfa" className="flex min-h-11 items-center" onClick={() => setMenuOpen(false)}>
            <Image src="/logo/kasam360-ikon-kucuk-koyu-zemin.svg" alt="" width={44} height={44} priority />
          </Link>

          <nav className="hidden items-center gap-1 md:flex" aria-label="Ana menü">
            {navLinks.map((link) => (
              <Link key={link.href} href={link.href} className="nav-link" aria-current={pathname === link.href ? 'page' : undefined}>
                {link.label}
              </Link>
            ))}
            <Link href="/giris" className="nav-link" aria-current={pathname === '/giris' ? 'page' : undefined}>
              Giriş
            </Link>
            <Link href="/kayit" className="btn btn-paper ml-3">
              Kayıt Olun
            </Link>
          </nav>

          <button
            type="button"
            className="btn btn-paper md:hidden"
            aria-expanded={menuOpen}
            aria-controls="mobile-menu"
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? 'Kapat' : 'Menü'}
          </button>
        </div>

        {menuOpen && (
          <nav id="mobile-menu" className="flex flex-col pb-6 text-lg md:hidden" aria-label="Mobil menü">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="flex min-h-12 items-center"
                aria-current={pathname === link.href ? 'page' : undefined}
                onClick={() => setMenuOpen(false)}
              >
                {link.label}
              </Link>
            ))}
            <Link href="/giris" className="flex min-h-12 items-center" onClick={() => setMenuOpen(false)}>
              Giriş
            </Link>
            <Link href="/kayit" className="btn btn-paper mt-3" onClick={() => setMenuOpen(false)}>
              Kayıt Olun
            </Link>
          </nav>
        )}

        <div className="spiral mx-[max(16px,env(safe-area-inset-left,0px))] md:mx-8" aria-hidden="true" />
      </div>
    </header>
  );
}
