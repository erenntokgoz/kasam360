import { X, ShieldCheck } from 'lucide-react';
import {
  AuditLogDto,
  auditActionLabel,
  auditCategoryLabel,
  isAuditCategory,
} from '../../../../core/audit/auditCatalog';

interface AuditLogDetailModalProps {
  log: AuditLogDto | null;
  onClose: () => void;
}

/**
 * Denetim kaydı detayı. Ham hash gösterilmez; kaydın mühürlü olduğu ve
 * payload içeriği gösterilir (payload zaten backend'de maskelenerek yazıldı).
 */
export function AuditLogDetailModal({ log, onClose }: AuditLogDetailModalProps) {
  if (!log) return null;

  const rows: Array<{ label: string; value: string; mono?: boolean }> = [
    { label: 'İşlem', value: auditActionLabel(log.action) },
    { label: 'İşlem Kodu', value: log.action, mono: true },
    { label: 'Kategori', value: auditCategoryLabel(log.category) },
    { label: 'Personel', value: log.actor_id },
    { label: 'Rol', value: log.actor_role },
    { label: 'Zaman', value: new Date(log.timestamp).toLocaleString('tr-TR') },
    { label: 'Kaynak', value: log.resource_id, mono: true },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xl p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="dark:bg-[#1F2024]/90 bg-white/90 border dark:border-white/10 border-black/[0.08] rounded-3xl max-w-md w-full p-6 shadow-2xl backdrop-blur-2xl flex flex-col gap-4 dark:text-zinc-100 text-zinc-900"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`Denetim kaydı ${log.sequence}`}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldCheck size={20} className="text-[#0A84FF]" />
            <h3 className="font-semibold text-base dark:text-white text-zinc-900">
              Denetim Kaydı #{log.sequence}
            </h3>
          </div>
          <button
            onClick={onClose}
            aria-label="Kapat"
            className="w-7 h-7 rounded-full dark:bg-white/10 bg-black/10 hover:dark:bg-white/20 hover:bg-black/20 flex items-center justify-center dark:text-zinc-400 text-zinc-600 transition-colors"
          >
            <X size={14} />
          </button>
        </div>

        <div className="dark:bg-white/[0.03] bg-black/[0.03] rounded-2xl p-4 border dark:border-white/5 border-black/[0.05] space-y-2.5 text-xs">
          {rows.map((row) => (
            <div
              key={row.label}
              className="flex justify-between gap-3 py-1 border-b dark:border-white/5 border-black/5 last:border-b-0"
            >
              <span className="dark:text-zinc-400 text-zinc-500 shrink-0">{row.label}</span>
              <span
                className={`text-right dark:text-white text-zinc-900 break-all ${row.mono ? 'font-mono' : 'font-medium'}`}
              >
                {row.value}
              </span>
            </div>
          ))}

          <div className="flex items-center justify-between gap-3 py-1">
            <span className="dark:text-zinc-400 text-zinc-500">Bütünlük</span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[#30D158]/30 bg-[#30D158]/10 px-2.5 py-1 text-[11px] font-semibold text-[#30D158]">
              <ShieldCheck size={12} />
              <span>{log.sealed ? 'Mühürlü' : 'Mühürsüz'}</span>
            </span>
          </div>
        </div>

        <div>
          <span className="dark:text-zinc-400 text-zinc-500 block mb-1 text-xs">
            Kayıt İçeriği
          </span>
          <pre className="p-3 rounded-xl dark:bg-black/40 bg-black/5 font-mono text-[11px] break-all dark:text-zinc-200 text-zinc-800 border dark:border-white/5 border-black/5 max-h-48 overflow-auto">
            {log.payload ? JSON.stringify(log.payload, null, 2) : 'Kayıtta ek alan yok.'}
          </pre>
        </div>

        <button
          onClick={onClose}
          className="w-full py-2.5 rounded-xl bg-[#0A84FF] hover:bg-[#409CFF] text-white text-xs font-semibold shadow-sm transition-all cursor-pointer"
        >
          Kapat
        </button>
      </div>
    </div>
  );
}

/** Kategori rozeti rengi Apple sistem renklerinden seçilir. */
export function categoryBadgeStyle(category: string): string {
  if (!isAuditCategory(category)) return 'bg-zinc-500/15 text-zinc-300 border-zinc-500/30';
  switch (category) {
    case 'ODEME':
    case 'FINANS':
      return 'bg-[#30D158]/15 text-[#30D158] border-[#30D158]/30';
    case 'SIPARIS_MASA':
      return 'bg-[#0A84FF]/15 text-[#0A84FF] border-[#0A84FF]/30';
    case 'PERSONEL':
      return 'bg-[#BF5AF2]/15 text-[#BF5AF2] border-[#BF5AF2]/30';
    case 'MENU':
      return 'bg-[#FF9F0A]/15 text-[#FF9F0A] border-[#FF9F0A]/30';
    case 'YETKI':
    case 'GUVENLIK':
      return 'bg-[#FF375F]/15 text-[#FF375F] border-[#FF375F]/30';
    default:
      return 'bg-[#64D2FF]/15 text-[#64D2FF] border-[#64D2FF]/30';
  }
}
