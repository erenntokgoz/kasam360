import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Menü bulunamadı', robots: { index: false } };

export default function MenuNotFound() {
  return (
    <main className="m-root m-state">
      <h1>Menü bulunamadı</h1>
    </main>
  );
}
