import { TableItem } from './FloorPlanPanel';
import { TableTimer } from './TableTimer';
import { MoneyDisplay } from '../../common/MoneyDisplay';
import { BookmarkPlus, UserCheck } from 'lucide-react';

interface TableCardProps {
  table: TableItem;
  onClick: () => void;
  /** Boş masa için hızlı rezervasyon açılır. */
  onQuickReserve?: () => void;
}

// Garson adını formatlayan yardımcı fonksiyon
export function formatWaiterLabel(waiter?: string): string {
  if (!waiter || waiter.trim() === '') {
    return 'Garson: Belirtilmedi';
  }
  const trimmed = waiter.trim();
  if (trimmed.toLowerCase().startsWith('garson:')) {
    const rawName = trimmed.slice(trimmed.indexOf(':') + 1).trim();
    return rawName ? `Garson: ${rawName}` : 'Garson: Belirtilmedi';
  }
  if (trimmed === 'usr_waiter' || trimmed === 'WAITER' || trimmed.startsWith('usr_waiter')) {
    return 'Garson: Ahmet';
  }
  return `Garson: ${trimmed}`;
}

// Masa adını ve birleşen masa bilgilerini derleyen yardımcı fonksiyon
export function getTableDisplayName(table: TableItem): string {
  if (table.mergedWith && table.mergedWith.length > 0) {
    const existingParts = table.name.split('+').map((s) => s.trim());
    const newParts = table.mergedWith.filter((name) => !existingParts.includes(name.trim()));
    if (newParts.length > 0) {
      return `${table.name} + ${newParts.join(' + ')}`;
    }
  }
  return table.name;
}

export function TableCard({ table, onClick, onQuickReserve }: TableCardProps) {
  const isOccupied = table.status === 'occupied';
  const isReserved = table.status === 'reserved';
  const isEmpty = table.status === 'empty';

  const displayName = getTableDisplayName(table);
  const waiterLabel = formatWaiterLabel(table.waiterName);
  const reservation = table.reservation;
  const hasArrived = reservation?.status === 'ARRIVED';

  return (
    <div className="relative w-full h-full">
      <button
        onClick={onClick}
        type="button"
        aria-label={`${table.name}, durum: ${isEmpty ? 'Boş' : isOccupied ? 'Dolu' : 'Rezerve'}${
          reservation ? `, ${reservation.customerName} adına` : ''
        }`}
        className={`
          relative flex flex-col justify-between p-4 sm:p-5 rounded-[1.75rem] aspect-square w-full h-full overflow-hidden text-left select-none touch-manipulation active:scale-[0.97] transition-all duration-200 cursor-pointer
          backdrop-blur-xl dark:bg-white/[0.04] bg-white/75 dark:border-white/10 border-black/[0.08] shadow-[0_8px_24px_rgba(0,0,0,0.3),inset_0_1px_1px_rgba(255,255,255,0.25)] hover:shadow-xl hover:dark:bg-white/[0.08] hover:bg-white/90
          focus:outline-none focus-visible:ring-2 focus-visible:ring-[#007AFF]
          ${isOccupied ? 'dark:border-[#FF453A]/50 border-[#FF3B30]/40 shadow-[0_8px_24px_rgba(255,59,48,0.18)] hover:dark:border-[#FF453A]/70 hover:border-[#FF3B30]/60' : ''}
          ${isReserved ? 'dark:border-[#5E5CE6]/50 border-[#5856D6]/40 shadow-[0_8px_24px_rgba(88,86,214,0.18)] hover:dark:border-[#5E5CE6]/70 hover:border-[#5856D6]/60' : ''}
          ${isEmpty ? 'hover:dark:border-white/20 hover:border-black/15' : ''}
        `}
      >
        {/* 1. Boş Masa Görünümü */}
        {isEmpty && (
          <div className="flex flex-col items-center justify-center h-full w-full">
            <span className="text-2xl sm:text-3xl font-light tracking-tight dark:text-white/90 text-zinc-800 text-center">
              {displayName}
            </span>
            <span className="text-[11px] font-medium dark:text-white/50 text-zinc-500 mt-2 px-3 py-0.5 rounded-full dark:bg-white/[0.05] bg-black/[0.04] border dark:border-white/10 border-black/[0.08]">
              Boş
            </span>
          </div>
        )}

        {/* 2. Rezerve Masa Görünümü: kimin adına ve ne zaman bekleniyor bilgisi */}
        {isReserved && (
          <div className="flex flex-col justify-between h-full w-full">
            <div className="flex items-center justify-between gap-1 w-full">
              <span
                className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
                  hasArrived
                    ? 'bg-[#34C759]/20 text-[#34C759] dark:text-[#32D74B] border-[#34C759]/30'
                    : 'bg-[#5856D6]/15 text-[#5856D6] dark:text-[#5E5CE6] border-[#5856D6]/30'
                }`}
              >
                {hasArrived ? 'GELDİ' : 'REZERVE'}
              </span>
              {reservation && <TableTimer openedAt={reservation.waitingSince} mode="waiting" />}
            </div>

            <div className="flex flex-col items-center justify-center w-full my-auto px-1 py-1 gap-1">
              <span
                className="text-xl sm:text-2xl font-semibold tracking-tight dark:text-white text-zinc-900 text-center leading-snug line-clamp-2"
                title={displayName}
              >
                {displayName}
              </span>
              {reservation ? (
                <span
                  className="text-xs dark:text-white/70 text-zinc-600 text-center truncate max-w-full"
                  title={`${reservation.customerName} • ${reservation.partySize} kişi • ${reservation.reservedAtLabel}`}
                >
                  {reservation.customerName} • {reservation.partySize} kişi
                </span>
              ) : (
                // Rezervasyon kaydı okunamadıysa kart boş etikete dönüşmez: kayıt
                // eksikliği açıkça yazılır (rezervasyon uydurulmaz).
                <span className="text-xs text-[#FF9500] dark:text-[#FF9F0A] text-center">
                  Rezervasyon kaydı bulunamadı
                </span>
              )}
            </div>

            {hasArrived && (
              <div className="w-full flex items-center justify-center gap-1 text-[10px] font-semibold text-[#34C759] dark:text-[#32D74B] border-t dark:border-white/10 border-black/[0.08] pt-2">
                <UserCheck className="w-3 h-3" />
                Adisyon bekliyor
              </div>
            )}
          </div>
        )}

        {/* 3. Dolu Masa Görünümü */}
        {isOccupied && (
          <div className="flex flex-col justify-between h-full w-full">
            {/* Üst Satır: Garson Adı + Hazır Rozeti / Süre Sayacı */}
            <div className="flex items-center justify-between gap-1 w-full">
              <span className="text-xs dark:text-white/70 text-zinc-600 font-medium truncate max-w-[65%]" title={waiterLabel}>
                {waiterLabel}
              </span>
              <div className="flex items-center gap-1.5 shrink-0">
                {table.isReady && (
                  <span className="flex items-center gap-1 text-[10px] font-bold bg-[#34C759]/20 text-[#34C759] dark:text-[#32D74B] px-2 py-0.5 rounded-full border border-[#34C759]/30 shadow-sm animate-pulse">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#34C759] dark:text-[#32D74B]"></span>
                    HAZIR
                  </span>
                )}
                <TableTimer openedAt={table.openedAt} />
              </div>
            </div>

            {/* Orta Satır: Masa Adı (Tek masa veya birleşen masalar örn: Masa 1 + Masa 2) */}
            <div className="flex flex-col items-center justify-center w-full my-auto px-1 py-1 gap-1">
              <span
                className="text-xl sm:text-2xl lg:text-3xl font-semibold tracking-tight dark:text-white text-zinc-900 text-center leading-snug line-clamp-2"
                title={displayName}
              >
                {displayName}
              </span>
              {table.openedAt && (Date.now() - table.openedAt) >= 35 * 60000 && (
               <span className="flex items-center gap-1 text-[10px] font-bold bg-[#FF9500]/20 text-[#FF9500] dark:text-[#FF9F0A] px-2 py-0.5 rounded-full border border-[#FF9500]/30 shadow-sm mt-1">
                 <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
                 KİLİTLİ
               </span>
              )}
            </div>

            {/* Alt Kısım: Transfer Bilgisi ve Adisyon Tutarı */}
            <div className="w-full flex flex-col items-center pt-2 border-t dark:border-white/10 border-black/[0.08]">
              {table.transferInfo && (
                <div
                  className="w-full flex items-center justify-center gap-1 text-[11px] font-semibold text-[#FF9500] dark:text-[#FF9F0A] bg-[#FF9500]/10 dark:bg-[#FF9F0A]/10 px-2 py-0.5 rounded-full border border-[#FF9500]/20 dark:border-[#FF9F0A]/20 mb-1.5 truncate"
                  title={table.transferInfo}
                >
                  <span className="truncate">{table.transferInfo}</span>
                </div>
              )}
              <span className="text-[#34C759] dark:text-[#32D74B] font-mono font-semibold text-base sm:text-lg">
                <MoneyDisplay amountInCents={Math.round(table.totalAmount || 0)} />
              </span>
            </div>
          </div>
        )}
      </button>

      {/* Hızlı Rezerve Et — boş masanın sağ üst köşesinde, kartın dışında.
          Buton kartın `button` elementi içine gömülemez (geçersiz HTML); bu
          yüzden kardeş öğe olarak konumlandırılır ve tıklamayı yutmaz. */}
      {isEmpty && onQuickReserve && (
        <button
          type="button"
          onClick={onQuickReserve}
          aria-label={`${table.name} hızlı rezerve et`}
          title="Hızlı Rezerve Et"
          className="absolute top-3 right-3 z-10 flex items-center justify-center w-8 h-8 rounded-full bg-[#5856D6]/15 dark:bg-[#5856D6]/20 text-[#5856D6] dark:text-[#5E5CE6] border border-[#5856D6]/30 hover:bg-[#5856D6]/25 active:scale-95 transition-all cursor-pointer backdrop-blur-md"
        >
          <BookmarkPlus className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}
