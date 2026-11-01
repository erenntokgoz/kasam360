import React, { useState } from 'react';
import { errorText } from '../../lib/cariInput';
import { downloadFile } from '../../lib/downloadFile';
import { invokeIPC } from '../../services/tauriClient';
import { useAuthStore } from '../../stores/authStore';
import { sessionArgs } from '../../stores/cariStore';
import { Button } from '../../ui/Button';

interface MenuFile {
  html: string;
}

/**
 * Menü dosyası çevrimdışı üretilir. Karekodun göstereceği adres ve müşteriden sipariş
 * almak için barındırma gerekir; o olmadan ekran sipariş alıyormuş gibi davranmaz.
 */
export const QrMenuPanel: React.FC = () => {
  const modules = useAuthStore((state) => state.user?.activeModules ?? []);
  const [error, setError] = useState<string | null>(null);
  if (!modules.includes('feat_qr_menu')) return null;

  const build = async () => {
    const { actorId, actorRole, tenantId } = sessionArgs();
    setError(null);
    try {
      const file = await invokeIPC<MenuFile>('qr_menu_build', { actorId, actorRole, tenantId, activeModules: modules });
      downloadFile('menu.html', file.html, 'text/html');
    } catch (caught) {
      setError(errorText(caught));
    }
  };

  return (
    <section className="paper border border-[var(--border)] rounded-xl p-4 space-y-2">
      <h3 className="print-title text-sm font-bold text-[var(--text-primary)]">QR Menü Dosyası</h3>
      <p className="text-xs text-[var(--text-secondary)]">
        Güncel menüyü imzalı dosya olarak verir. Adres tanımlanana kadar karekod üretilmez, müşteriden sipariş alınmaz.
      </p>
      <Button variant="secondary" className="min-h-12 text-sm" onClick={() => void build()}>Menü Dosyasını İndir</Button>
      {error ? <p role="alert" className="text-xs font-semibold text-[var(--accent-red)]">{error}</p> : null}
    </section>
  );
};
