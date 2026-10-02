/**
 * Faz 10 analitik tabloları.
 *
 * Neden ayrı dosya: `AnalyticsPanel` bölümleri yönlendirir; tablo gövdesi
 * burada toplanır. Böylece her dosya 300 satır sınırının altında kalır.
 *
 * Veri kuralı: yüzde alanları `null` gelirse "Bilinmiyor" yazılır.
 */

import type { BcgEntry, CompetitorPriceGap, MonthlyTargetStatus, ProductCombination } from './analyticsTypes';
import { formatCents, formatPercent } from './analyticsTypes';

export const tableCellClass = 'px-3 py-2 text-[13px] text-zinc-800 dark:text-zinc-200';

const headCellClass = `${tableCellClass} text-left`;

function EmptyRow({ colSpan, text }: { colSpan: number; text: string }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-3 py-3 text-[13px] text-zinc-600 dark:text-zinc-400">
        {text}
      </td>
    </tr>
  );
}

interface TableFrameProps {
  headers: readonly (string | null)[];
  children: React.ReactNode;
  emptyText: string;
  isEmpty: boolean;
  minWidth?: number;
}

/** Tüm analitik tablolarının ortak iskeleti; boş durum metni zorunlu. */
function TableFrame({ headers, children, emptyText, isEmpty, minWidth = 560 }: TableFrameProps) {
  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full border-collapse" style={{ minWidth }}>
        <thead>
          <tr className="border-b border-black/[0.06] dark:border-white/10">
            {headers.map((header, i) => (
              <th
                key={header ?? `col-${i}`}
                className={i === 0 ? headCellClass : `${tableCellClass} text-right`}
              >
                {header ?? ''}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{isEmpty ? <EmptyRow colSpan={headers.length} text={emptyText} /> : children}</tbody>
      </table>
    </div>
  );
}

export function BcgMatrixTable({ entries }: { entries: BcgEntry[] }) {
  return (
    <TableFrame
      headers={['Ürün', 'Kova', 'Adet', 'Marj']}
      isEmpty={entries.length === 0}
      emptyText="Bu dönemde satılan ürün yok."
    >
      {entries.map((e) => (
        <tr key={e.product_id} className="border-b border-black/[0.04] dark:border-white/5">
          <td className={tableCellClass}>{e.product_name}</td>
          <td className={tableCellClass}>{e.quadrant_label}</td>
          <td className={`${tableCellClass} text-right tabular-nums`}>{e.units_sold}</td>
          <td className={`${tableCellClass} text-right tabular-nums`}>
            {formatPercent(e.margin_percent)}
          </td>
        </tr>
      ))}
    </TableFrame>
  );
}

export function CombinationTable({ combinations }: { combinations: ProductCombination[] }) {
  return (
    <TableFrame
      headers={['Ürün A', 'Ürün B', 'Birlikte', 'Pay']}
      isEmpty={combinations.length === 0}
      emptyText="Eşiği geçen ürün çifti yok."
    >
      {combinations.map((c) => (
        <tr
          key={`${c.product_a_id}-${c.product_b_id}`}
          className="border-b border-black/[0.04] dark:border-white/5"
        >
          <td className={tableCellClass}>{c.product_a_name}</td>
          <td className={tableCellClass}>{c.product_b_name}</td>
          <td className={`${tableCellClass} text-right tabular-nums`}>{c.support}</td>
          <td className={`${tableCellClass} text-right tabular-nums`}>
            %{c.confidence_percent}
          </td>
        </tr>
      ))}
    </TableFrame>
  );
}

export function TargetTable({ targets }: { targets: MonthlyTargetStatus[] }) {
  return (
    <TableFrame
      headers={['Kategori', 'Hedef', 'Gerçekleşen', 'Oran']}
      isEmpty={targets.length === 0}
      emptyText="Bu ay için hedef tanımlanmamış."
      minWidth={480}
    >
      {targets.map((t) => (
        <tr key={t.category} className="border-b border-black/[0.04] dark:border-white/5">
          <td className={tableCellClass}>{t.category}</td>
          <td className={`${tableCellClass} text-right tabular-nums`}>
            {formatCents(t.target_cents)}
          </td>
          <td className={`${tableCellClass} text-right tabular-nums`}>
            {formatCents(t.actual_cents)}
          </td>
          <td className={`${tableCellClass} text-right tabular-nums`}>
            {formatPercent(t.achieved_percent)}
          </td>
        </tr>
      ))}
    </TableFrame>
  );
}

export function CompetitorGapTable({ gaps }: { gaps: CompetitorPriceGap[] }) {
  return (
    <TableFrame
      headers={['Ürün', 'Rakip', 'Biz', 'Rakip', 'Fark', 'Fark %']}
      isEmpty={gaps.length === 0}
      emptyText="Kayıtlı rakip fiyatı yok."
    >
      {gaps.map((g) => (
        <tr
          key={`${g.product_id}-${g.competitor_name}`}
          className="border-b border-black/[0.04] dark:border-white/5"
        >
          <td className={tableCellClass}>{g.product_name}</td>
          <td className={tableCellClass}>{g.competitor_name}</td>
          <td className={`${tableCellClass} text-right tabular-nums`}>
            {formatCents(g.our_price_cents)}
          </td>
          <td className={`${tableCellClass} text-right tabular-nums`}>
            {formatCents(g.competitor_price_cents)}
          </td>
          <td
            className={`${tableCellClass} text-right tabular-nums ${
              g.gap_cents > 0 ? 'text-[#FF3B30]' : 'text-[#34C759]'
            }`}
          >
            {formatCents(g.gap_cents)}
          </td>
          <td
            className={`${tableCellClass} text-right tabular-nums ${
              g.gap_percent > 0 ? 'text-[#FF3B30]' : 'text-[#34C759]'
            }`}
          >
            {g.gap_percent > 0 ? `+%${g.gap_percent}` : `%${g.gap_percent}`}
          </td>
        </tr>
      ))}
    </TableFrame>
  );
}