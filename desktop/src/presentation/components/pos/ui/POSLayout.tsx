/**
 * POSLayout — Apple HIG ve Spatial Glass POS Ana Sunum Düzeni
 *
 * POS işletim yüzeyi için yapısal dış kabuk. Tüm alt bileşenler slot
 * propları olarak dışarıdan enjekte edilir. Bu bileşen iş mantığı barındırmaz.
 *
 * Görünüm Bölümü:
 *   ┌──────────────────────────────┬────────────────┐
 *   │                              │                │
 *   │   mainContent   (flex-1)     │  sidebar       │
 *   │   Apple Derin Antrasit       │  Cam Panel     │
 *   │   #16171b                    │  #1c1d22       │
 *   └──────────────────────────────┴────────────────┘
 */

import React from 'react';

export interface POSLayoutProps {
  /** Sol ana çalışma yüzeyi: ürün kataloğu, arama, kategori gezinimi */
  mainContent: React.ReactNode;
  /** Sağ ray: sepet paneli */
  sidebar: React.ReactNode;
  /** İsteğe bağlı üst çubuk alanı (saat, kasiyer bilgisi, vardiya durumları) */
  topBar?: React.ReactNode;
}

export function POSLayout({ mainContent, sidebar, topBar }: POSLayoutProps): JSX.Element {
  // Apple HIG ve Spatial Glass layout: Kök saydam, paneller light/dark uyumlu buzlu cam
  return (
    <div className="flex h-full w-full flex-col overflow-hidden dark:bg-[#16171b] bg-transparent dark:text-zinc-100 text-zinc-900 font-sans antialiased selection:bg-[#007AFF]/30 select-none">
      {/* ── Üst Çubuk (Opsiyonel) ────────────────────────────────────── */}
      {topBar && (
        <header className="shrink-0 border-b dark:border-white/10 border-black/10 dark:bg-black/20 bg-white/60 backdrop-blur-xl z-20">
          {topBar}
        </header>
      )}

      {/* ── Ana Yatay Bölme (Apple Spatial Split) ─────────────────────── */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Sol Alan: Ürün Kataloğu ve Izgarası */}
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden bg-transparent">
          {mainContent}
        </main>

        {/* Sağ Ray: Apple Spatial Glass Sepet Paneli (1px Hairline Sol Kenarlık) */}
        <aside className="flex w-96 lg:w-[410px] shrink-0 flex-col overflow-hidden dark:bg-white/[0.04] bg-white/75 backdrop-blur-2xl border-l dark:border-white/10 border-black/10 shadow-[0_0_40px_rgba(0,0,0,0.06)] dark:shadow-[0_0_40px_rgba(0,0,0,0.4)] z-10">
          {sidebar}
        </aside>
      </div>
    </div>
  );
}
