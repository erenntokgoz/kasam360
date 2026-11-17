import React, { useEffect, useState } from 'react';
import { errorText, localDate } from '../../lib/cariInput';
import { formatMoney } from '../../lib/formatMoney';
import { PAYMENT_LABEL, secondsText } from '../../lib/packageModel';
import { loadPackageReport } from '../../stores/packageStore';
import type { PackageReport } from '../../types/packageService';
import { InlineAlert } from '../../ui/InlineAlert';
import { Input } from '../../ui/Input';

/** Yerel gün başlangıcını sunucunun karşılaştırdığı ISO-8601 ana çevirir; bitiş gün sonu dahildir. */
function dayBound(date: string, endOfDay: boolean): string {
  const start = new Date(`${date}T00:00:00`);
  if (endOfDay) start.setDate(start.getDate() + 1);
  return start.toISOString();
}

/** Paket servis raporu: ciro, ödeme şekli, kurye başına teslim sayısı ve süresi, iptaller. */
export const PackageReportTab: React.FC = () => {
  const today = localDate(new Date());
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [report, setReport] = useState<PackageReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const invalid = !from || !to || to < from;

  useEffect(() => {
    if (invalid) return undefined;
    let current = true;
    setReport(null);
    setError(null);
    loadPackageReport(dayBound(from, false), dayBound(to, true))
      .then((next) => { if (current) setReport(next); })
      .catch((caught) => { if (current) setError(errorText(caught)); });
    return () => { current = false; };
  }, [from, to, invalid]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs font-semibold text-[var(--text-secondary)]">Başlangıç
          <Input type="date" className="!w-44 tabular-nums" value={from} onChange={(event) => setFrom(event.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold text-[var(--text-secondary)]">Bitiş
          <Input type="date" className="!w-44 tabular-nums" value={to} onChange={(event) => setTo(event.target.value)} />
        </label>
      </div>
      {invalid ? <p role="alert" className="text-sm font-semibold text-[var(--accent-red)]">Bitiş tarihi başlangıçtan önce olamaz.</p> : null}
      {error ? <InlineAlert message={`Rapor okunamadı: ${error}`} onDismiss={() => setError(null)} /> : null}
      {!report && !error && !invalid ? <p role="status" className="text-sm">Rapor yükleniyor.</p> : null}

      {report ? (
        <>
          <dl className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,180px),1fr))]">
            {[
              ['Paket cirosu', formatMoney(report.revenueCents)],
              ['Teslim edilen', String(report.deliveredCount)],
              ['Teslimat ücreti', formatMoney(report.feeCents)],
              ['Ortalama süre', secondsText(report.averageTotalSeconds)],
              ['İptal', `${report.cancelledCount} · ${formatMoney(report.cancelledCents)}`],
            ].map(([term, value]) => (
              <div key={term} className="work-surface rounded-2xl border border-[var(--border)] p-4">
                <dt className="text-xs font-semibold text-[var(--text-secondary)]">{term}</dt>
                <dd className="mt-1 text-xl font-bold tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>

          <div className="grid gap-4 lg:grid-cols-2">
            <section aria-label="Ödeme şekline göre" className="space-y-2">
              <h2 className="text-sm font-bold">Ödeme şekline göre</h2>
              {report.methods.length === 0 ? <p className="text-sm">Bu aralıkta teslim yok.</p> : (
                <table className="w-full text-sm"><tbody>
                  {report.methods.map((share) => (
                    <tr key={share.method}><td>{PAYMENT_LABEL[share.method]}</td><td className="text-right tabular-nums">{share.orderCount}</td><td className="text-right font-bold tabular-nums">{formatMoney(share.amountCents)}</td></tr>
                  ))}
                </tbody></table>
              )}
            </section>
            <section aria-label="Kurye başına" className="space-y-2">
              <h2 className="text-sm font-bold">Kurye başına</h2>
              {report.couriers.length === 0 ? <p className="text-sm">Bu aralıkta kurye teslimi yok.</p> : (
                <table className="w-full text-sm">
                  <thead><tr className="text-left"><th>Kurye</th><th className="text-right">Teslim</th><th className="text-right">Ort. yol</th><th className="text-right">Tutar</th></tr></thead>
                  <tbody>
                    {report.couriers.map((courier) => (
                      <tr key={courier.courierId}><td className="font-semibold">{courier.name}</td><td className="text-right tabular-nums">{courier.deliveredCount}</td><td className="text-right tabular-nums">{secondsText(courier.averageTripSeconds)}</td><td className="text-right font-bold tabular-nums">{formatMoney(courier.amountCents)}</td></tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          </div>
        </>
      ) : null}
    </div>
  );
};
