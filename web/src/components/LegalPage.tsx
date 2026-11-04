import { PageSheet } from '@/components/PageSheet';
import { siteConfig } from '@/content/siteConfig';

export interface LegalSection {
  title: string;
  paragraphs: string[];
}

export function LegalPage({ title, sections }: { title: string; sections: LegalSection[] }) {
  return (
    <PageSheet>
      <header className="flex flex-col gap-2">
        <h1 className="sheet-subtitle">{title}</h1>
        <p className="printed">Son güncelleme: {siteConfig.legalUpdatedAt}</p>
      </header>
      <div className="flex max-w-3xl flex-col gap-6">
        {sections.map((section) => (
          <section key={section.title} className="flex flex-col gap-1.5">
            <h2 className="text-xl font-bold">{section.title}</h2>
            {section.paragraphs.map((paragraph) => (
              <p key={paragraph} className="text-ink-soft">
                {paragraph}
              </p>
            ))}
          </section>
        ))}
      </div>
    </PageSheet>
  );
}
