import type { ReactNode } from 'react';

// İç sayfaların ortak kabuğu. "split" düzeni solda başlık ve bağlam, sağda form paneli gösterir;
// "plain" düzeni başlığın altına tam genişlikte içerik koyar.
export function PageShell({ title, lead, intro, children, layout = 'plain' }: {
  title: ReactNode; lead?: ReactNode; intro?: ReactNode; children: ReactNode; layout?: 'plain' | 'split';
}) {
  if (layout === 'split') {
    return (
      <div className="k-root k-page">
        <div className="k-wrap k-split">
          <header className="k-split-head">
            <h1>{title}</h1>
            {lead && <p>{lead}</p>}
            {intro}
          </header>
          <div className="k-panel">{children}</div>
        </div>
      </div>
    );
  }
  return (
    <div className="k-root k-page">
      <div className="k-wrap">
        <header className="k-page-head">
          <h1>{title}</h1>
          {lead && <p>{lead}</p>}
        </header>
        {children}
      </div>
    </div>
  );
}
