import { useCallback, useEffect, useState } from 'react';
import { errorText } from '../../lib/cariInput';
import { formatMoney } from '../../lib/formatMoney';
import { invokeIPC } from '../../services/tauriClient';
import { sessionArgs } from '../../stores/cariStore';
import { useStockStore } from '../../stores/stockStore';
import { Button } from '../../ui/Button';
import { Input } from '../../ui/Input';

interface CountLine {
  product_id: string;
  product_name: string;
  counted_quantity: number;
  variance_quantity: number | null;
  variance_cost_cents: number | null;
}

interface StockCount {
  id: string;
  status: string;
  started_at: string;
  lines: CountLine[];
}

interface WasteRow {
  id: string;
  product_name: string;
  reason: string;
  quantity: number;
  total_cost_cents: number | null;
}

const WASTE_REASONS: [string, string][] = [
  ['BOZULDU', 'Bozuldu'],
  ['RAF_OMRU_DOLDU', 'Raf ömrü doldu'],
  ['KIRILDI', 'Kırıldı'],
  ['SIZINTI', 'Sızıntı'],
  ['HATA_GIRIS', 'Hatalı giriş'],
  ['FIRE_EDILDI', 'Fire'],
];

const select = 'min-h-12 w-full rounded-lg border border-[var(--border)] bg-[var(--bg-subtle)] px-3 text-sm text-[var(--text-primary)]';

function quantityOf(text: string): number | null {
  const value = Number(text.trim().replace(',', '.'));
  return text.trim() !== '' && Number.isFinite(value) && value >= 0 ? value : null;
}

/** Kör sayım: beklenen miktar kapanışa kadar gösterilmez. Fire stoktan FIFO ile düşer. */
export function StockCountPanel() {
  const { products, load: loadStock } = useStockStore();
  const [count, setCount] = useState<StockCount | null>(null);
  const [wastes, setWastes] = useState<WasteRow[]>([]);
  const [productId, setProductId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [wasteProductId, setWasteProductId] = useState('');
  const [wasteQuantity, setWasteQuantity] = useState('');
  const [reason, setReason] = useState(WASTE_REASONS[0][0]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { actorRole, tenantId } = sessionArgs();
    try {
      const [counts, waste] = await Promise.all([
        invokeIPC<StockCount[]>('list_stock_counts_command', { actorRole, tenantId }),
        invokeIPC<WasteRow[]>('list_waste_records_command', { actorRole, tenantId, limit: 20 }),
      ]);
      setWastes(waste);
      const latest = counts.find((item) => item.status === 'ACIK') ?? counts[0] ?? null;
      setCount(
        latest
          ? await invokeIPC<StockCount>('get_stock_count_command', { actorRole, tenantId, stockCountId: latest.id })
          : null,
      );
    } catch (caught) {
      setError(errorText(caught));
    }
  }, []);

  useEffect(() => {
    void loadStock();
    void load();
  }, [load, loadStock]);

  const run = async (action: () => Promise<unknown>) => {
    setError(null);
    try {
      await action();
      await Promise.all([load(), loadStock()]);
    } catch (caught) {
      setError(errorText(caught));
    }
  };

  const session = () => {
    const { actorId, actorRole, tenantId } = sessionArgs();
    return { actorId, actorRole, tenantId };
  };
  const isOpen = count?.status === 'ACIK';

  const addLine = () => {
    const countedQuantity = quantityOf(quantity);
    if (!count || !productId || countedQuantity === null) {
      setError('Ürün ve sayılan miktarı girin.');
      return;
    }
    void run(async () => {
      await invokeIPC('record_count_line_command', {
        ...session(),
        args: { stockCountId: count.id, productId, countedQuantity },
      });
      setQuantity('');
    });
  };

  const addWaste = () => {
    const amount = quantityOf(wasteQuantity);
    if (!wasteProductId || !amount) {
      setError('Ürün ve fire miktarını girin.');
      return;
    }
    void run(async () => {
      await invokeIPC('record_waste_command', {
        ...session(),
        args: { productId: wasteProductId, reason, quantity: amount },
      });
      setWasteQuantity('');
    });
  };

  const productOptions = products.map((product) => (
    <option key={product.id} value={product.id}>
      {product.name}
    </option>
  ));

  return (
    <div className="flex-1 overflow-y-auto p-5 space-y-5 max-w-3xl">
      {error ? (
        <p role="alert" className="text-xs font-semibold text-[var(--accent-red)]">
          {error}
        </p>
      ) : null}

      <section className="paper border border-[var(--border)] rounded-xl p-4 space-y-3">
        <h2 className="print-title text-sm font-bold text-[var(--text-primary)]">Stok sayımı</h2>
        {!isOpen ? (
          <Button
            variant="primary"
            className="min-h-12"
            onClick={() => void run(() => invokeIPC('open_stock_count_command', { ...session(), args: {} }))}
          >
            Yeni Sayım Başlat
          </Button>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <select aria-label="Sayılan ürün" className={select} value={productId} onChange={(event) => setProductId(event.target.value)}>
              <option value="">Ürün seçin</option>
              {productOptions}
            </select>
            <Input aria-label="Sayılan miktar" inputMode="decimal" placeholder="Sayılan" className="min-h-12" value={quantity} onChange={(event) => setQuantity(event.target.value)} />
            <Button variant="secondary" className="min-h-12" onClick={addLine}>
              Satırı Kaydet
            </Button>
          </div>
        )}

        {count?.lines.length ? (
          <ul className="divide-y divide-[var(--border)]">
            {count.lines.map((line) => (
              <li key={line.product_id} className="flex justify-between gap-3 py-2 text-sm text-[var(--text-primary)]">
                <span className="truncate">{line.product_name}</span>
                <span className="tabular-nums">
                  {line.counted_quantity}
                  {line.variance_quantity != null ? ` (Fark: ${line.variance_quantity})` : ''}
                  {line.variance_cost_cents != null ? ` · ${formatMoney(line.variance_cost_cents)}` : ''}
                </span>
              </li>
            ))}
          </ul>
        ) : null}

        {isOpen ? (
          <Button
            variant="danger"
            className="w-full min-h-12"
            onClick={() =>
              void run(() =>
                invokeIPC('close_stock_count_command', {
                  ...session(),
                  args: { stockCountId: count.id, applyAdjustment: true },
                }),
              )
            }
          >
            Sayımı Kapat ve Stoğa Uygula
          </Button>
        ) : null}
      </section>

      <section className="paper border border-[var(--border)] rounded-xl p-4 space-y-3">
        <h2 className="print-title text-sm font-bold text-[var(--text-primary)]">Fire kaydı</h2>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
          <select aria-label="Fire ürünü" className={select} value={wasteProductId} onChange={(event) => setWasteProductId(event.target.value)}>
            <option value="">Ürün seçin</option>
            {productOptions}
          </select>
          <select aria-label="Fire nedeni" className={select} value={reason} onChange={(event) => setReason(event.target.value)}>
            {WASTE_REASONS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <Input aria-label="Fire miktarı" inputMode="decimal" placeholder="Miktar" className="min-h-12" value={wasteQuantity} onChange={(event) => setWasteQuantity(event.target.value)} />
          <Button variant="secondary" className="min-h-12" onClick={addWaste}>
            Fire Yaz
          </Button>
        </div>
        <ul className="divide-y divide-[var(--border)]">
          {wastes.map((row) => (
            <li key={row.id} className="flex justify-between gap-3 py-2 text-sm text-[var(--text-primary)]">
              <span className="truncate">
                {row.product_name} · {row.quantity}
              </span>
              <span className="tabular-nums">
                {row.total_cost_cents != null ? formatMoney(row.total_cost_cents) : 'Maliyet bilinmiyor'}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
