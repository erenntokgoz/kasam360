import { PageShell } from '@/components/PageShell';
import { siteConfig } from '@/content/siteConfig';

export interface LegalSection {
  title: string;
  paragraphs: string[];
}

// Bölüm başlığından Türkçe karakterleri sadeleştirilmiş bağlantı adı üretir; sayfa içi bağlantılar paylaşılabilir.
const ASCII: Record<string, string> = { ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u' };
const slug = (text: string) =>
  text.toLocaleLowerCase('tr-TR').replace(/[çğıöşü]/g, (c) => ASCII[c] ?? c)
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export function LegalPage({ title, sections }: { title: string; sections: LegalSection[] }) {
  return (
    <PageShell title={title} lead={`Son güncelleme: ${siteConfig.legalUpdatedAt}`}>
      <div className="k-legal">
        <nav aria-label="Bölümler">
          {sections.map((s) => (
            <a key={s.title} href={`#${slug(s.title)}`}>{s.title}</a>
          ))}
        </nav>
        <div>
          {sections.map((section) => (
            <section key={section.title} id={slug(section.title)}>
              <h2>{section.title}</h2>
              {section.paragraphs.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
            </section>
          ))}
        </div>
      </div>
    </PageShell>
  );
}
