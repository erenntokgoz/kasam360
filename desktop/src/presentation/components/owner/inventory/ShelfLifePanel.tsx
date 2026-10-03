// Faz 12 · Raf ömrü ve son kullanma paneli.
//
// Beklenen değer: uyarı penceresi dolduğunda fire kâğıdına basılır. Panel
// yalnız rapor gösterir; fire kaydı Fire & Sayım panelinden yapılır. İki
// yeri birleştirmek "kayıt mı açayım, bildirim mi vereyim" belirsizliği yaratır.

import { CalendarClock } from 'lucide-react';
import {
  EmptyState,
  ErrorStrip,
  GlassPanel,
  InfoStrip,
  LoadingRows,
  PanelHeader,
  StateBadge,
} from './inventory360Primitives';
import { freshnessLabel, quantity, shortDate, type BatchFreshness, type ExpiryReport } from './inventory360Types';
import { FeatureOffNotice, NoPermissionNotice, useAsyncCommand, usePanelContext } from './usePanelContext';

export function ShelfLifePanel() {
  const ctx = usePanelContext();

  const rapor = useAsyncCommand<ExpiryReport>(
    'get_expiry_report',
    { tenantId: ctx.tenantId },
    ctx.tenantId !== '' && ctx.isLossRadarEnabled,
  );

  if (!ctx.isManager) {
    return <NoPermissionNotice need="Raf ömrü takibi işletme sahibi ve müdür yetkisindedir." />;
  }

  if (!ctx.isLossRadarEnabled) {
    return (
      <FeatureOffNotice
        featureName="Raf ömrü ve fire radarı"
        hint="Bu işletmede son kullanma takibi kapalı. Fire kaydı yine de tutulur; takip raporu oluşmaz."
      />
    );
  }

  const veri = rapor.data;
  const suresiGecen = veri?.expired ?? [];
  const yaklasan = veri?.expiring ?? [];

  return (
    <div className="flex flex-col gap-5">
      {rapor.error ? <ErrorStrip message={rapor.error} onDismiss={rapor.reload} /> : null}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <GlassPanel>
          <PanelHeader
            title={`Süresi geçen parti (${suresiGecen.length})`}
            hint="Bu partiler satışa kapalıdır"
            icon={<CalendarClock size={18} strokeWidth={1.6} />}
          />
          {rapor.loading ? (
            <LoadingRows />
          ) : suresiGecen.length === 0 ? (
            <EmptyState message="Süresi geçen parti yok." />
          ) : (
            <PartyList satirlar={suresiGecen} />
          )}
        </GlassPanel>

        <GlassPanel>
          <PanelHeader
            title={`Yaklaşan parti (${yaklasan.length})`}
            hint="Uyarı penceresi doldu, fire kâğıdına basılmalı"
            icon={<CalendarClock size={18} strokeWidth={1.6} />}
          />
          {rapor.loading ? (
            <LoadingRows />
          ) : yaklasan.length === 0 ? (
            <EmptyState message="Uyarı penceresindeki parti yok." />
          ) : (
            <PartyList satirlar={yaklasan} />
          )}
        </GlassPanel>
      </div>

      {!rapor.loading && suresiGecen.length > 0 && (
        <InfoStrip>
          Süresi geçen partiyi satmak kar zararı gizler. Önce fire kaydı aç: Fire & Sayım panelinden
          gerekçeyi seçip miktarı gir, sonra ürünü 86'la.
        </InfoStrip>
      )}
    </div>
  );
}

function PartyList({ satirlar }: { satirlar: BatchFreshness[] }) {
  return (
    <ul className="px-5 pb-5 space-y-2">
      {satirlar.map((parti) => (
        <li
          key={parti.batch_id}
          className="px-3.5 py-2.5 rounded-2xl dark:bg-white/[0.03] bg-black/[0.02] border dark:border-white/5 border-black/[0.05]"
        >
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-medium dark:text-white text-zinc-900 truncate">{parti.product_name}</p>
            <StateBadge tone={parti.state === 'SURESI_GECTI' ? 'bad' : 'warn'}>
              {freshnessLabel(parti.state)}
            </StateBadge>
          </div>
          <p className="text-[11px] dark:text-zinc-500 text-zinc-500 mt-1 font-mono">
            {parti.batch_code ?? parti.batch_id} · kalan {quantity(parti.remaining_quantity)} · son kullanma{' '}
            {shortDate(parti.expiry_date)}
            {parti.days_left !== null ? ` · ${parti.days_left} gün` : ''}
          </p>
        </li>
      ))}
    </ul>
  );
}