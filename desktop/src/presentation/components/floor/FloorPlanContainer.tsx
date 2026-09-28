import { useEffect, useState } from 'react';
import { FloorPlanPanel, TableItem } from './ui/FloorPlanPanel';
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
    readyStatuses,
    isClockedIn,
    fetchFloorPlan,
    moveTable,
    mergeTables,
    reserveTable,
    pollReadyStatuses,
    waiterClockIn,
  } = useFloorStore();

  const [selectedOccupiedTable, setSelectedOccupiedTable] = useState<TableItem | null>(null);

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
  }, [fetchFloorPlan]);

  // 2. Mutfakta hazır sipariş polling'i (5 saniyede bir)
  useEffect(() => {
    pollReadyStatuses().catch(() => {});
    const interval = setInterval(() => {
      pollReadyStatuses().catch(() => {});
    }, 5000);
    return () => clearInterval(interval);
  }, [tables, pollReadyStatuses]);

  // Garson Mesai Başlatma
  const handleClockIn = async () => {
    try {
      await waiterClockIn(user?.userId || 'UNKNOWN');
      notifySuccess('Vardiya Başlatıldı', 'Garson mesai girişi başarıyla kaydedildi.');
    } catch (e: unknown) {
      notifyError('Mesai Giriş Hatası', e);
    }
  };

  const mappedTables: TableItem[] = tables.map((t) => ({
    id: t.id,
    name: t.name,
    status: t.status === 'AVAILABLE' ? 'empty' : t.status === 'OCCUPIED' ? 'occupied' : 'reserved',
    openedAt: t.openedAt ? new Date(t.openedAt).getTime() : undefined,
    waiterName: t.waiterId,
    totalAmount: t.currentTotal,
    isReady: readyStatuses[t.id] || false,
    mergedWith: mergeMap[t.id],
    transferInfo: transferMap[t.id],
  }));

  const handleTableClick = async (tableId: string) => {
    const table = mappedTables.find((t) => t.id === tableId);
    if (!table) return;

    if (table.status === 'empty') {
      // Boş masaya tıklandığında doğrudan adisyonu bağlayarak POS ekranına yönlendir
      await selectTable(table.id);
      navigate('POS');
    } else {
      setSelectedOccupiedTable(table);
    }
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

        case 'Rezerve Et':
          await reserveTable(table.id);
          notifySuccess('Masa Rezerve Edildi', `${table.name} masası rezerve olarak işaretlendi.`);
          break;

        case 'Adisyon Yazdır': {
          await tauriInvoke('print_receipt', {
            order: {
              type: 'BILL',
              title: 'ADİSYON',
              tableId: table.id,
              tableName: table.name,
              totalAmount: Math.round(table.totalAmount || 0),
              timestamp: new Date().toISOString(),
            },
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
