import React from 'react';
import { formatNumber } from '../../../lib/numberText';
import { formatMoney } from '../../../lib/formatMoney';
import { marginPercent } from '../../../lib/panoramaInsights';
import type { PanoramaProduct } from '../../../stores/panoramaStore';
import { Panel } from './Panel';

interface TopProductsProps {
  products: PanoramaProduct[];
  showProfit: boolean;
}

export const TopProducts: React.FC<TopProductsProps> = ({ products, showProfit }) => {
  const peak = Math.max(1, ...products.map((item) => item.revenueCents));
  return (
    <Panel title="Çok Satanlar">
      {products.length === 0 ? (
        <p className="text-sm text-[var(--text-secondary)]">Bu dönemde kapanan satış yok.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-[var(--text-muted)]">
              <th className="font-medium pb-2">Ürün</th>
              <th className="font-medium pb-2 text-right">Adet</th>
              <th className="font-medium pb-2 text-right">Ciro</th>
              {showProfit ? <th className="font-medium pb-2 text-right">Kâr</th> : null}
            </tr>
          </thead>
          <tbody>
            {products.map((item) => {
              const margin = marginPercent(item.profitCents, item.revenueCents);
              return (
                <tr key={item.productId} className="border-t border-[var(--border)]">
                  <td className="py-2 pr-3 max-w-0 w-full">
                    <span className="block truncate font-semibold text-[var(--text-primary)]">{item.name}</span>
                    <span className="block h-1 mt-1 rounded bg-[var(--bg-subtle)] overflow-hidden">
                      <span className="block h-full rounded bg-[var(--accent-blue)]" style={{ width: `${(item.revenueCents / peak) * 100}%` }} />
                    </span>
                  </td>
                  <td className="py-2 pl-3 text-right tabular-nums text-[var(--text-secondary)]">{formatNumber(item.units)}</td>
                  <td className="py-2 pl-3 text-right tabular-nums whitespace-nowrap text-[var(--text-primary)]">{formatMoney(item.revenueCents)}</td>
                  {showProfit ? (
                    <td className="py-2 pl-3 text-right tabular-nums whitespace-nowrap text-[var(--text-primary)]">
                      {item.profitCents === null ? (
                        <span className="text-[var(--text-muted)]" title="Parti girişi olmadığı için maliyet bilinmiyor">Maliyet yok</span>
                      ) : (
                        <>
                          {formatMoney(item.profitCents)}
                          {margin !== null ? <span className="text-xs text-[var(--text-muted)]"> %{margin}</span> : null}
                        </>
                      )}
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </Panel>
  );
};
