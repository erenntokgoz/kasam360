import { ErrorToast } from '../../ui/ErrorToast';
import { useEffect, useState } from 'react';
import { formatServerDateTime } from '../../lib/date';
import { invokeIPC } from '../../services/tauriClient';
import { sessionArgs } from '../../stores/cariStore';
import { useStockStore } from '../../stores/stockStore';

interface TrailRow {
  id: string;
  createdAt: string;
  productId: string;
  productName: string;
  kind: 'MAL_KABUL' | 'SATIS' | 'FIRE' | 'IADE' | 'SAYIM';
  quantity: number;
  reason?: string | null;
  sourceId?: string | null;
  orderId?: string | null;
  actorName: string;
}

const KIND_LABEL: Record<TrailRow['kind'], string> = {
  MAL_KABUL: 'Mal kabulü',
  SATIS: 'Satış / reçete',
  FIRE: 'Fire',
  IADE: 'İptal iadesi',
  SAYIM: 'Sayım farkı',
};

const SOURCE_LABEL: Record<TrailRow['kind'], string> = {
  MAL_KABUL: 'Sipariş',
  SATIS: 'Adisyon',
  FIRE: 'Fire kaydı',
  IADE: 'Adisyon',
  SAYIM: 'Sayım',
};

/** Stoktaki her değişimin nedeni, kaynağı ve kişisi. Yükseltmeden önceki hareketler burada yoktur. */
export function StockTrailPanel() {
  const products = useStockStore((state) => state.products);
  const load = useStockStore((state) => state.load);
  const [productId, setProductId] = useState('');
  const [rows, setRows] = useState<TrailRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const { actorRole, tenantId } = sessionArgs();
    invokeIPC<TrailRow[]>('get_stock_trail', { actorRole, tenantId, productId: productId || null })
      .then((list) => {
        setRows(list);
        setError(null);
      })
      .catch((caught: unknown) => setError(String(caught)));
  }, [productId]);

  return (
    <div className="page-fill flex-1 overflow-y-auto p-4 space-y-4 text-[var(--text-primary)]">
      <select
        aria-label="Hareket ürünü"
        className="min-h-12 w-full max-w-sm rounded-lg border border-[var(--border)] bg-[var(--bg-subtle)] px-3 text-sm"
        value={productId}
        onChange={(event) => setProductId(event.target.value)}
      >
        <option value="">Tüm ürünler</option>
        {products.map((product) => (
          <option key={product.id} value={product.id}>{product.name}</option>
        ))}
      </select>
      <ErrorToast message={error} />
      <section className="rounded-xl border border-[var(--border)] paper overflow-x-auto">
        {rows.length === 0 && !error ? <p className="p-4 text-xs text-[var(--text-secondary)]">Kayıtlı stok hareketi yok.</p> : null}
        {rows.length > 0 ? (
          <table className="w-full text-left text-xs">
            <thead className="text-[var(--text-secondary)] border-b border-[var(--border)]">
              <tr>
                <th className="p-3">Tarih</th>
                <th className="p-3">Ürün</th>
                <th className="p-3">Tür</th>
                <th className="p-3 text-right">Miktar</th>
                <th className="p-3">Neden</th>
                <th className="p-3">Kaynak</th>
                <th className="p-3">Kişi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className="p-3 tabular-nums whitespace-nowrap">{formatServerDateTime(row.createdAt)}</td>
                  <td className="p-3 font-bold">{row.productName}</td>
                  <td className="p-3">{KIND_LABEL[row.kind]}</td>
                  <td className={`p-3 text-right font-bold tabular-nums ${row.quantity < 0 ? 'text-[var(--accent-red)]' : 'text-[var(--accent-emerald)]'}`}>
                    {row.quantity > 0 ? '+' : ''}{row.quantity.toLocaleString('tr-TR')}
                  </td>
                  <td className="p-3 text-[var(--text-secondary)]">{row.reason ?? '-'}</td>
                  <td className="p-3 tabular-nums text-[var(--text-secondary)]">
                    {SOURCE_LABEL[row.kind]} {(row.orderId ?? row.sourceId ?? '-').slice(-8)}
                  </td>
                  <td className="p-3">{row.actorName}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </section>
    </div>
  );
}
