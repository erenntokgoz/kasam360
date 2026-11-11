import type { Metadata } from 'next';
import { pageMetadata } from '@/content/pageMetadata';
import { PageShell } from '@/components/PageShell';
import { downloadRelease, downloadItems } from '@/content/downloads';

export const metadata: Metadata = pageMetadata({
  title: 'İndir',
  description: 'KASAM360 Windows kurulum paketi ve Android uygulaması. Test sürümü; otomatik güncelleme kapalıdır.',
  path: '/indir',
});

export default function DownloadPage() {
  return (
    <PageShell title="KASAM360'ı indirin." lead="Windows kasa uygulaması ve Android el terminali. Her iki paket de test sürümüdür.">
      <p className="k-muted k-dl-meta">Sürüm {downloadRelease.version} · {downloadRelease.dateLabel}</p>
      <div className="k-download-grid">
        {downloadItems.map((item) => (
          <article className="k-panel k-download-card" key={item.platform}>
            <header>
              <span className="k-tag">Test sürümü</span>
              <h2>{item.platform}</h2>
              <p>{item.requirement}</p>
            </header>
            <dl className="k-download-facts">
              <div><dt>Dosya</dt><dd>{item.fileName}</dd></div>
              <div><dt>Boyut</dt><dd>{item.sizeLabel}</dd></div>
              <div><dt>SHA-256</dt><dd className="k-hash">{item.sha256}</dd></div>
            </dl>
            <a className="k-btn k-btn-buy k-btn-lg" href={item.url} download>{item.platform} için indir</a>
            <ol className="k-download-steps">
              {item.steps.map((step) => <li key={step}>{step}</li>)}
            </ol>
          </article>
        ))}
      </div>
      <p className="k-muted">Otomatik güncelleme kapalıdır. Yeni sürümler bu sayfada yayımlanır. İndirdiğiniz dosyanın SHA-256 değeri yukarıdakiyle aynı olmalıdır.</p>
    </PageShell>
  );
}
