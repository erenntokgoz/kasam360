import React from 'react';
import type { MenuMetrics } from '../../../stores/panoramaStore';
import { Panel } from './Panel';

// Anahtarlar sunucudaki `BcgQuadrant` adlarıdır: Plowhorse az satan kârlı, CashCow çok satan
// düşük kârlı üründür. Klasik menü mühendisliği adlarıyla karıştırılmamalı.
const QUADRANTS = [
  { key: 'Star', countKey: 'star', title: 'Yıldız', advice: 'Çok satıyor, kârlı. Öne çıkarın.' },
  { key: 'CashCow', countKey: 'cash_cow', title: 'Emekçi', advice: 'Çok satıyor, kârı düşük. Fiyatı gözden geçirin.' },
  { key: 'Plowhorse', countKey: 'plowhorse', title: 'Gizli Fırsat', advice: 'Kârlı, az satıyor. Garsona önerdirin.' },
  { key: 'Dog', countKey: 'dog', title: 'Zayıf', advice: 'Az satıyor, kârı düşük. Menüden çıkarmayı düşünün.' },
] as const;

/** Menü kararını rakamdan öneriye çevirir: hangi ürüne ne yapılacağı tek bakışta görünür. */
export const MenuMatrix: React.FC<{ metrics: MenuMetrics | null }> = ({ metrics }) => {
  if (!metrics) {
    return (
      <Panel title="Menü Analizi">
        <p className="text-sm text-[var(--text-secondary)]">Menü analizi okunamadı.</p>
      </Panel>
    );
  }
  const pair = metrics.combinations[0];
  const hasData = metrics.bcg_matrix.length > 0;
  return (
    <Panel title="Menü Analizi">
      {!hasData ? (
        <p className="text-sm text-[var(--text-secondary)]">Analiz için bu dönemde kapanan satış gerekiyor.</p>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {QUADRANTS.map(({ key, countKey, title, advice }) => {
            const names = metrics.bcg_matrix.filter((item) => item.quadrant === key).map((item) => item.product_name);
            return (
              <div key={key} className="rounded-lg bg-[var(--bg-card)] border border-[var(--border)] p-3 min-w-0">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-xs font-bold text-[var(--text-primary)]">{title}</span>
                  <span className="text-lg font-bold tabular-nums text-[var(--text-primary)]">{metrics.bcg_counts[countKey]}</span>
                </div>
                <p className="text-xs text-[var(--text-secondary)] mt-0.5 truncate" title={names.join(', ')}>
                  {names.length > 0 ? names.join(', ') : 'Ürün yok'}
                </p>
                <p className="text-[11px] text-[var(--text-muted)] mt-1">{advice}</p>
              </div>
            );
          })}
        </div>
      )}
      {pair ? (
        <p className="text-xs text-[var(--text-secondary)]">
          <span className="font-bold text-[var(--text-primary)]">{pair.product_a_name}</span> alanların
          <span className="tabular-nums"> %{pair.confidence_percent}</span> kadarı{' '}
          <span className="font-bold text-[var(--text-primary)]">{pair.product_b_name}</span> da alıyor.
        </p>
      ) : null}
    </Panel>
  );
};
