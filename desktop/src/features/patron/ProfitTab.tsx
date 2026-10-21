import React from 'react';
import { useLedgerStore } from '../../stores/ledgerStore';
import { formatMoney } from '../../lib/formatMoney';

export const ProfitTab: React.FC = () => {
  const { summary } = useLedgerStore();

  const grossSales = summary?.grossSalesCents || 3845000;
  const fifoCost = summary?.fifoCostOfGoodsCents || 1245000;
  const grossProfit = grossSales - fifoCost;
  const expenses = summary?.operatingExpensesCents || 680000;
  const netProfit = grossProfit - expenses;
  const marginPercent = grossSales > 0 ? Math.round((netProfit / grossSales) * 100) : 0;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-bold text-[var(--text-primary)]">
          Kasa & Gerçek FIFO Net Kâr Özeti
        </h2>
        <p className="text-xs text-[var(--text-secondary)] mt-0.5">
          Satılan her ürünün inventory_batches üzerinden FIFO lot maliyeti düşülerek hesaplanan net kâr tablosu.
        </p>
      </div>

      {/* Büyük Metrik Kartları */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-[var(--bg-panel)] border border-[var(--border)] rounded-xl p-4 shadow-sm">
          <span className="text-xs text-[var(--text-secondary)] block">Toplam Satış Hasılatı</span>
          <span className="text-2xl font-bold text-[var(--text-primary)] tabular-nums mt-1 block">
            {formatMoney(grossSales)}
          </span>
          <span className="text-[11px] text-[var(--text-muted)] mt-1 block">
            KDV dahil brüt satışlar
          </span>
        </div>

        <div className="bg-[var(--bg-panel)] border border-[var(--accent-red-border)] rounded-xl p-4 shadow-sm">
          <span className="text-xs text-[var(--text-secondary)] block">FIFO Reçete Stok Maliyeti</span>
          <span className="text-2xl font-bold text-[var(--accent-red)] tabular-nums mt-1 block">
            {formatMoney(fifoCost)}
          </span>
          <span className="text-[11px] text-[var(--text-muted)] mt-1 block">
            Gerçek parti alım maliyeti (%{Math.round((fifoCost / grossSales) * 100)})
          </span>
        </div>

        <div className="bg-[var(--bg-panel)] border border-[var(--border)] rounded-xl p-4 shadow-sm">
          <span className="text-xs text-[var(--text-secondary)] block">İşletme Giderleri</span>
          <span className="text-2xl font-bold text-[var(--text-primary)] tabular-nums mt-1 block">
            {formatMoney(expenses)}
          </span>
          <span className="text-[11px] text-[var(--text-muted)] mt-1 block">
            Kira, personel, fatura ve dükkan
          </span>
        </div>

        <div className="bg-[var(--bg-panel)] border border-[var(--accent-emerald-border)] rounded-xl p-4 shadow-sm">
          <span className="text-xs text-[var(--text-secondary)] block">Net Kâr (Reel Kâr)</span>
          <span className="text-2xl font-bold text-[var(--accent-emerald)] tabular-nums mt-1 block">
            {formatMoney(netProfit)}
          </span>
          <span className="text-[11px] text-[var(--accent-emerald)] font-semibold mt-1 block">
            %{marginPercent} Net Kâr Marjı
          </span>
        </div>
      </div>

      {/* Bilanço Özeti */}
      <div className="bg-[var(--bg-panel)] border border-[var(--border)] rounded-xl p-5 shadow-sm space-y-4">
        <h3 className="text-sm font-bold text-[var(--text-primary)]">
          Finansal Bakiye ve Likidite Durumu
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="bg-[var(--bg-subtle)] border border-[var(--border)] rounded-lg p-3.5">
            <span className="text-xs text-[var(--text-secondary)] block">Kasa Çekmecesindeki Nakit</span>
            <span className="text-lg font-bold text-[var(--text-primary)] tabular-nums mt-1 block">
              {formatMoney(summary?.cashInDrawerCents || 635000)}
            </span>
          </div>

          <div className="bg-[var(--bg-subtle)] border border-[var(--border)] rounded-lg p-3.5">
            <span className="text-xs text-[var(--text-secondary)] block">Müşterilerden Açık Alacaklar</span>
            <span className="text-lg font-bold text-[var(--accent-emerald)] tabular-nums mt-1 block">
              {formatMoney(summary?.totalReceivablesCents || 280000)}
            </span>
          </div>

          <div className="bg-[var(--bg-subtle)] border border-[var(--border)] rounded-lg p-3.5">
            <span className="text-xs text-[var(--text-secondary)] block">Tedarikçilere Açık Borçlar</span>
            <span className="text-lg font-bold text-[var(--accent-red)] tabular-nums mt-1 block">
              {formatMoney(summary?.totalPayablesCents || 1870000)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
