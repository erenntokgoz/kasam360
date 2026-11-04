import Image from 'next/image';
import Link from 'next/link';
import { legalLinks, navLinks, siteConfig } from '@/content/siteConfig';

export function SiteFooter() {
  return (
    <footer className="on-desk gutter grid gap-8 pb-[calc(2.5rem+env(safe-area-inset-bottom,0px))] pt-14 md:grid-cols-[2fr_1fr_1fr]">
      <div className="flex flex-col items-start gap-3">
        <Image src="/logo/kasam360-logo-koyu-zemin.svg" alt="KASAM360" width={178} height={50} className="-ml-2.5" />
        <p className="max-w-sm text-sm opacity-80">
          İşletme yönetimi ve adisyon yazılımı. Mali belgeyi işletmenizin yazar kasası keser.
        </p>
        <a href={`mailto:${siteConfig.contactEmail}`} className="flex min-h-11 items-center break-all text-sm underline underline-offset-4">
          {siteConfig.contactEmail}
        </a>
        <p className="text-sm opacity-80">© 2026 {siteConfig.name}</p>
      </div>
      <nav className="flex flex-col" aria-label="Site">
        {navLinks.map((link) => (
          <Link key={link.href} href={link.href} className="nav-link px-0">
            {link.label}
          </Link>
        ))}
      </nav>
      <nav className="flex flex-col" aria-label="Yasal">
        {legalLinks.map((link) => (
          <Link key={link.href} href={link.href} className="nav-link px-0">
            {link.label}
          </Link>
        ))}
      </nav>
    </footer>
  );
}
