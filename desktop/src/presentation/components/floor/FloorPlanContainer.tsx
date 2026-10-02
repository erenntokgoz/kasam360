import { useEffect, useState } from 'react';
import { FloorPlanPanel, TableItem } from './ui/FloorPlanPanel';
import { ReserveTableModal, ReserveTableInput } from './ui/ReserveTableModal';
import { useCartStore } from '../../store/useCartStore';
import { useFloorStore } from '../../store/useFloorStore';
import { TableActionModal } from './ui/TableActionModal';
import { useAuthStore } from '../../store/useAuthStore';
import { toast as useToast } from '@core/components/ui/toast';
import { tauriInvoke } from '../../../data/ipc/tauriInvoke';
import { AppleButton } from '../common/AppleButton';

export function FloorPlanContainer() {
  const selectTable = useCartStore((state) => state.selectTable);
  const navigate = useCartStore((state) => state.navigate);
  const setPaymentModalOpen = useCartStore((state) => state.setPaymentModalOpen);

  const user = useAuthStore((state) => state.user);
  const isWaiter = user?.role === 'WAITER';

  const {
    tables,
    reservations,
    readyStatuses,
    isClockedIn,
    fetchFloorPlan,
    fetchReservations,
    moveTable,
    mergeTables,
    reserveTable,
    cancelReservation,
    markReservationNoShow,
    markReservationArrived,
    pollReadyStatuses,
    waiterClockIn,
  } = useFloorStore();

  const [selectedOccupiedTable, setSelectedOccupiedTable] = useState<TableItem | null>(null);
  const [reserveTargetTableId, setReserveTargetTableId] = useState<string | null>(null);

  // Birleşen masalar ve transfer bilgilerini operasyonel oturum boyunca takip eden yerel durumlar
  const [mergeMap, setMergeMap] = useState<Record<string, string[]>>({});
  const [transferMap, setTransferMap] = useState<Record<string, string>>({});

  // Bildirim yardımcıları
  const notifySuccess = (title: string, description?: string) => {
    try {
      useToast.add({ title, description, type: 'success' });
    } catch {
      console.log(`[Success] ${title}: ${description}`);
    }
  };

  const notifyError = (title: string, error: unknown) => {
    const description = error instanceof Error ? error.message : String(error);
    try {
      useToast.add({ title, description, type: 'error' });
    } catch {
      alert(`${title}\n${description}`);
    }
  };

  // 1. Masa Planı Yükleme
  useEffect(() => {
    fetchFloorPlan().catch((e) => {
      notifyError('Masa Planı Yüklenemedi', e);
    });
    // Rezervasyon listesi ayrı okunur: salon kartındaki müşteri adı ve bekleme
    // sayacı bu kayıttan gelir, `tables.status` yalnız rengi belirler.
    fetchReservations().catch(() => {});
  }, [fetchFloorPlan, fetchReservations]);

  // 2. Mutfakta hazır sipariş ve rezervasyon polling'i (5 saniyede bir)
  useEffect(() => {
    pollReadyStatuses().catch(() => {});
    const interval = setInterval(() => {
      pollReadyStatuses().catch(() => {});
      fetchReservations().catch(() => {});
    }, 5000);
    return () => clearInterval(interval);
  }, [tables, pollReadyStatuses, fetchReservations]);

  // Garson Mesai Başlatma
  const handleClockIn = async () => {
    try {
      await waiterClockIn(user?.userId || 'UNKNOWN');
      notifySuccess('Vardiya Başlatıldı', 'Garson mesai girişi başarıyla kaydedildi.');
    } catch (e: unknown) {
      notifyError('Mesai Giriş Hatası', e);
    }
  };

  // Rezervasyon durumunu arayüz diline çevirir. "Bilinmeyen durum" artık rezerve
  // sayılmaz: eski eşleme `status === 'AVAILABLE' ? empty : status === 'OCCUPIED'
  // ? occupied : reserved` idi ve bozuk/öngörülmemiş her değer mor "Rezerve"
  // bloğuna dönüşüyordu. Bilinmeyen değer boş kabul edilmez, açıkça işaretlenir.
  const mapTableStatus = (status: string): TableItem['status'] => {
    if (status === 'OCCUPIED') return 'occupied';
    if (status === 'RESERVED') return 'reserved';
    if (status === 'AVAILABLE') return 'empty';
    console.warn(`[FloorPlan] bilinmeyen masa durumu: ${status}`);
    return 'empty';
  };

  const formatReservedAt = (value?: string): string => {
    if (!value) return 'Saat belirtilmedi';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return 'Saat belirtilmedi';
    return parsed.toLocaleString('tr-TR', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const mappedTables: TableItem[] = tables.map((t) => {
    const status = mapTableStatus(t.status);
    // Rezervasyon yalnız `RESERVED` masalarda aranır: dolu/boş masada açık kayıt
    // bulunması bir tutarsızlıktır ve bu yüzden gösterilmez.
    const reservation = status === 'reserved'
      ? reservations.find((item) => item.tableId === t.id)
      : undefined;
    const waitingSince = reservation?.createdAt ? new Date(reservation.createdAt).getTime() : NaN;
    return {
      id: t.id,
      name: t.name,
      status,
      openedAt: t.openedAt ? new Date(t.openedAt).getTime() : undefined,
      waiterName: t.waiterId,
      totalAmount: t.currentTotal,
      isReady: readyStatuses[t.id] || false,
      mergedWith: mergeMap[t.id],
      transferInfo: transferMap[t.id],
      reservation: reservation
        ? {
            customerName: reservation.customerName,
            partySize: reservation.partySize,
            waitingSince: Number.isNaN(waitingSince) ? Date.now() : waitingSince,
            status: reservation.status === 'ARRIVED' ? 'ARRIVED' : 'ACTIVE',
            reservedAtLabel: formatReservedAt(reservation.reservedAt),
          }
        : undefined,
    };
  });

  const handleTableClick = async (tableId: string) => {
    const table = mappedTables.find((t) => t.id === tableId);
    if (!table) return;

    try {
      const locked = await tauriInvoke<boolean>('try_lock_table', { 
        tableId: table.id, 
        waiterId: user?.userId || 'UNKNOWN' 
      });
      if (!locked) {
        notifyError('Masa Kilitli', 'Bu masa şu anda başka bir personel tarafından işlem görüyor. Lütfen bekleyiniz.');
        return;
      }
    } catch (e) {
      console.warn("Kilit kontrolü başarısız, devam ediliyor:", e);
    }

    if (table.status === 'empty') {
      // Boş masaya tıklandığında doğrudan adisyonu bağlayarak POS ekranına yönlendir
      await selectTable(table.id);
      navigate('POS');
    } else {
      setSelectedOccupiedTable(table);
    }
  };

  const handleQuickReserve = (tableId: string) => {
    const table = tables.find((t) => t.id === tableId);
    if (!table) return;
    // Hızlı rezerve yalnızca boş masada açılır. Dolu masaya rezervasyon
    // backend'de `CONFLICT` ile reddedilir; burada hiç pencere açılmaz.
    if (mapTableStatus(table.status) !== 'empty') {
      notifyError('Masa Rezerve Edilemez', 'Yalnızca boş masalar rezerve edilebilir.');
      return;
    }
    setReserveTargetTableId(tableId);
  };

  const handleReserveSubmit = async (input: ReserveTableInput) => {
    if (!reserveTargetTableId) return;
    const table = tables.find((t) => t.id === reserveTargetTableId);
    await reserveTable(reserveTargetTableId, input);
    setReserveTargetTableId(null);
    notifySuccess(
      'Masa Rezerve Edildi',
      `${table?.name || 'Masa'} masası ${input.customerName} adına ${formatReservedAt(input.reservedAt)} saatine rezerve edildi.`
    );
  };

  const handleModalAction = async (action: string, targetTableId?: string) => {
    if (!selectedOccupiedTable) return;
    const table = selectedOccupiedTable;

    try {
      switch (action) {
        case 'Sipariş Ekle':
          // İlgili masanın adisyonunu bağlayarak akıcı sipariş ekranına geçiş yap
          await selectTable(table.id);
          navigate('POS');
          break;

        case 'Tahsilat':
          await selectTable(table.id);
          navigate('POS');
          setPaymentModalOpen(true);
          break;

        case 'Masa Taşı': {
          if (!targetTableId) {
            notifyError('Hedef Masa Seçilmedi', 'Taşınacak masa belirtilmedi.');
            return;
          }
          await moveTable(table.id, targetTableId);
          const targetTable = tables.find((t) => t.id === targetTableId);
          const targetName = targetTable?.name || targetTableId;
          // Transfer bilgisini hedef masa kartında gösterilmek üzere kaydet
          setTransferMap((prev) => ({
            ...prev,
            [targetTableId]: `${table.name} ➔ ${targetName}`,
          }));
          notifySuccess(
            'Masa Taşındı',
            `${table.name} masası ${targetName} masasına başarıyla taşındı.`
          );
          break;
        }

        case 'Masa Birleştir': {
          if (!targetTableId) {
            notifyError('Hedef Masa Seçilmedi', 'Birleştirilecek masa belirtilmedi.');
            return;
          }
          await mergeTables(table.id, targetTableId, user?.userId || 'MANAGER');
          const targetTable = tables.find((t) => t.id === targetTableId);
          const targetName = targetTable?.name || targetTableId;
          // Birleştirilen masayı hedef masa üzerinde 'Masa 1 + Masa 2' şeklinde gösterilmek üzere ekle
          setMergeMap((prev) => {
            const existing = prev[targetTableId] || [];
            return {
              ...prev,
              [targetTableId]: existing.includes(table.name) ? existing : [...existing, table.name],
            };
          });
          notifySuccess(
            'Masalar Birleştirildi',
            `${table.name} masası ${targetName} masası ile başarıyla birleştirildi.`
          );
          break;
        }

        case 'Rezervasyonu Kaldır': {
          const reservation = reservations.find((item) => item.tableId === table.id);
          if (!reservation) {
            notifyError('Rezervasyon Bulunamadı', 'Bu masa için açık bir rezervasyon kaydı yok.');
            break;
          }
          await cancelReservation(reservation.id);
          notifySuccess('Rezervasyon Kaldırıldı', `${table.name} masası yeniden boş duruma geçti.`);
          break;
        }

        case 'Müşteri Gelmedi': {
          const reservation = reservations.find((item) => item.tableId === table.id);
          if (!reservation) {
            notifyError('Rezervasyon Bulunamadı', 'Bu masa için açık bir rezervasyon kaydı yok.');
            break;
          }
          await markReservationNoShow(reservation.id);
          notifySuccess('Gelmedi İşaretlendi', `${reservation.customerName} adına kayıt "gelmedi" olarak kapatıldı.`);
          break;
        }

        case 'Müşteri Geldi': {
          const reservation = reservations.find((item) => item.tableId === table.id);
          if (!reservation) {
            notifyError('Rezervasyon Bulunamadı', 'Bu masa için açık bir rezervasyon kaydı yok.');
            break;
          }
          await markReservationArrived(reservation.id);
          notifySuccess(
            'Müşteri Geldi',
            `${reservation.customerName} adına kayıt "geldi" olarak işaretlendi. Adisyonu POS ekranından açabilirsiniz.`
          );
          break;
        }

        case 'Adisyon Yazdır': {
          // Adisyon fişi tahsilat değildir; masanın açık siparişinden okunur.
          const orderId = await tauriInvoke<string | null>('get_active_order_id', {
            tableId: table.id,
            tenantId: user?.tenantId,
          });
          if (!orderId) {
            useToast.add({ title: 'Bu masa için açık sipariş bulunamadı.', type: 'error' });
            break;
          }
          await tauriInvoke('print_order_slip', {
            orderId,
            actorRole: user?.role,
            tenantId: user?.tenantId,
          });
          notifySuccess('Adisyon Yazdırıldı', `${table.name} masasının adisyon fişi yazıcıya gönderildi.`);
          break;
        }

        default:
          console.log(`Action ${action} triggered for table ${table.id}`);
          break;
      }
    } catch (e: unknown) {
      notifyError('İşlem Başarısız', e);
    } finally {
      setSelectedOccupiedTable(null);
    }
  };

  return (
    <div className="flex h-full w-full flex-col overflow-hidden dark:bg-[#060609] bg-[#f5f5f7] dark:text-[#f5f5f7] text-zinc-900 relative p-4 sm:p-6 gap-4">
      {/* macOS Frosted Glass Bağımsız Yüzen Başlık Adası */}
      <div className="flex items-center justify-between px-6 py-4 rounded-3xl dark:bg-white/[0.04] bg-white/80 backdrop-blur-xl border dark:border-white/10 border-black/[0.08] shadow-lg shrink-0">
        <div>
          <h2 className="text-xl font-bold tracking-tight dark:text-white text-zinc-900">Salon ve Masa Planı</h2>
        </div>
      </div>

      {/* Ana Masa Planı veya macOS Tarzı Boş Durum */}
      {tables.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center p-6">
          <div className="flex flex-col items-center justify-center p-8 rounded-3xl dark:bg-white/[0.04] bg-white/75 backdrop-blur-xl border dark:border-white/10 border-black/[0.08] shadow-lg max-w-md w-full text-center">
            <div className="mb-4 rounded-3xl dark:bg-white/[0.05] bg-black/[0.04] p-5 dark:text-white/40 text-zinc-400 border dark:border-white/10 border-black/[0.08]">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-12 w-12"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
                />
              </svg>
            </div>
            <h3 className="mb-2 text-xl font-semibold tracking-tight dark:text-white text-zinc-900">Salon Boş</h3>
            <p className="text-sm dark:text-white/50 text-zinc-500">
              Kayıtlı masa bulunmuyor. Yönetim panelinden salon masalarını tanımlayabilirsiniz.
            </p>
          </div>
        </div>
      ) : (
        <FloorPlanPanel
          tables={mappedTables}
          onTableClick={handleTableClick}
          onQuickReserve={handleQuickReserve}
        />
      )}

      {/* Hızlı Rezervasyon Penceresi — boş masadaki ikonu açan yüzey */}
      {reserveTargetTableId && (
        <ReserveTableModal
          tableName={tables.find((t) => t.id === reserveTargetTableId)?.name || 'Masa'}
          isOpen={true}
          onClose={() => setReserveTargetTableId(null)}
          onSubmit={handleReserveSubmit}
        />
      )}

      {/* Masa İşlem Modalı */}
      {selectedOccupiedTable && (
        <TableActionModal
          table={selectedOccupiedTable}
          allTables={mappedTables}
          isOpen={true}
          onClose={() => setSelectedOccupiedTable(null)}
          onAction={handleModalAction}
        />
      )}

      {/* Garson Mesai Başlatma Bildirim Kapsülü — macOS Frosted Glass */}
      {isWaiter && !isClockedIn && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 dark:bg-white/[0.06] bg-white/85 border dark:border-white/10 border-black/[0.08] dark:text-white text-zinc-900 px-6 py-4 rounded-3xl shadow-2xl flex items-center gap-6 z-40 backdrop-blur-2xl">
          <div>
            <h3 className="font-semibold text-sm dark:text-white text-zinc-900">Vardiyaya Başla</h3>
            <p className="text-xs dark:text-white/50 text-zinc-500">Sipariş almak ve masalara servis yapmak için mesainizi başlatın.</p>
          </div>
          <AppleButton
            onClick={handleClockIn}
            variant="primary"
            size="md"
          >
            Giriş Yap
          </AppleButton>
        </div>
      )}
    </div>
  );
}
