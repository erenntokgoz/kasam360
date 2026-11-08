import Link from 'next/link';
import { legalLinks, navLinks, siteConfig } from '@/content/siteConfig';

export function SiteFooter() {
  return (
    <footer className="k-root k-footer">
      <div className="k-wrap">
        <div>
          <p>İşletme yönetimi ve adisyon yazılımı. Mali belgeyi işletmenizin yazar kasası keser.</p>
          <a href={`mailto:${siteConfig.contactEmail}`}>{siteConfig.contactEmail}</a>
          <p>© 2026 {siteConfig.name}</p>
        </div>
        <nav aria-label="Site">
          {navLinks.map((link) => (
            <Link key={link.href} href={link.href}>{link.label}</Link>
          ))}
        </nav>
        <nav aria-label="Yasal">
          {legalLinks.map((link) => (
            <Link key={link.href} href={link.href}>{link.label}</Link>
          ))}
        </nav>
      </div>
    </footer>
  );
}
