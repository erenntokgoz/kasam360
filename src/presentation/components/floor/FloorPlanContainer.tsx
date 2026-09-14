import { useEffect, useState } from 'react';
import { FloorPlanPanel, TableItem } from './ui/FloorPlanPanel';
import { useCartStore } from '../../store/useCartStore';
import { useFloorStore } from '../../store/useFloorStore';
import { TableActionModal } from './ui/TableActionModal';
import { AddTableModal } from './ui/AddTableModal';
import { EditTableModal } from './ui/EditTableModal';
import { DeleteTableModal } from './ui/DeleteTableModal';
import { useAuthStore } from '../../store/useAuthStore';
import { toast as useToast } from '@core/components/ui/toast';
import { Plus } from 'lucide-react';

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
    addTable,
    addTablesBatch,
    removeTable,
    updateTableName,
    pollReadyStatuses,
    waiterClockIn,
  } = useFloorStore();

  const [selectedOccupiedTable, setSelectedOccupiedTable] = useState<TableItem | null>(null);

  // Modal Dialog States
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingTable, setEditingTable] = useState<{ id: string; name: string } | null>(null);
  const [deletingTable, setDeletingTable] = useState<{ id: string; name: string } | null>(null);

  // Toast Helpers
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
  }));

  const handleTableClick = async (tableId: string) => {
    const table = mappedTables.find((t) => t.id === tableId);
    if (!table) return;

    if (table.status === 'empty') {
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
          notifySuccess(
            'Masa Taşındı',
            `${table.name} masası ${targetTable?.name || targetTableId} masasına başarıyla taşındı.`
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
          notifySuccess(
            'Masalar Birleştirildi',
            `${table.name} masası ${targetTable?.name || targetTableId} masası ile başarıyla birleştirildi.`
          );
          break;
        }

        case 'Rezerve Et':
          await reserveTable(table.id);
          notifySuccess('Masa Rezerve Edildi', `${table.name} masası rezerve olarak işaretlendi.`);
          break;

        case 'Masa Düzenle':
          setEditingTable({ id: table.id, name: table.name });
          break;

        case 'Masa Sil':
          setDeletingTable({ id: table.id, name: table.name });
          break;

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

  // Masa Ekleme - Tekli
  const handleAddSingleTable = async (id: string, name: string) => {
    try {
      await addTable(id, name);
      notifySuccess('Masa Eklendi', `"${name}" masası başarıyla oluşturuldu.`);
    } catch (e: unknown) {
      notifyError('Masa Eklenemedi', e);
      throw e;
    }
  };

  // Masa Ekleme - Toplu
  const handleAddBatchTables = async (tablesToAdd: { id: string; name: string }[]) => {
    try {
      await addTablesBatch(tablesToAdd);
      notifySuccess('Toplu Masalar Eklendi', `${tablesToAdd.length} adet masa başarıyla oluşturuldu.`);
    } catch (e: unknown) {
      notifyError('Toplu Masa Eklenemedi', e);
      throw e;
    }
  };

  // Masa İsim Güncelleme
  const handleSaveTableName = async (id: string, newName: string) => {
    try {
      await updateTableName(id, newName);
      notifySuccess('Masa Güncellendi', `Masa adı "${newName}" olarak güncellendi.`);
    } catch (e: unknown) {
      notifyError('Masa Güncellenemedi', e);
      throw e;
    }
  };

  // Masa Silme
  const handleDeleteTable = async (id: string) => {
    try {
      await removeTable(id);
      notifySuccess('Masa Silindi', 'Masa başarıyla silindi.');
    } catch (e: unknown) {
      notifyError('Masa Silinemedi', e);
      throw e;
    }
  };

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-slate-900 relative">
      {/* Header */}
      <div className="flex items-center justify-between p-6 pb-4 bg-slate-900 border-b border-slate-800">
        <div>
          <h2 className="text-3xl font-bold text-slate-100">Salon ve Masa Planı</h2>
          <p className="text-sm text-slate-400 mt-0.5">
            Masa durumlarını görüntüleyin, sipariş ve yerleşim işlemlerini yönetin.
          </p>
        </div>
        {!isWaiter && (
          <button
            onClick={() => setIsAddModalOpen(true)}
            className="flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-md transition-all hover:bg-blue-500 active:scale-98"
          >
            <Plus className="w-4 h-4" />
            <span>Yeni Masa Ekle</span>
          </button>
        )}
      </div>

      {/* Main Floor Plan or Empty State */}
      {tables.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center p-6 bg-slate-950">
          <div className="mb-4 rounded-full bg-slate-800/80 p-5 text-slate-500 border border-slate-700">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-16 w-16"
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
          <h3 className="mb-2 text-2xl font-bold text-slate-200">Salon boş</h3>
          <p className="mb-6 text-slate-400 max-w-sm text-center">
            Şu anda kayıtlı masa bulunmuyor. Yeni bir masa ekleyerek başlayabilirsiniz.
          </p>
          {!isWaiter && (
            <button
              onClick={() => setIsAddModalOpen(true)}
              className="flex items-center gap-2 rounded-xl bg-blue-600 px-6 py-3 font-semibold text-white transition-all hover:bg-blue-500 shadow-lg shadow-blue-600/30"
            >
              <Plus className="w-5 h-5" />
              <span>İlk Masayı Ekleyin</span>
            </button>
          )}
        </div>
      ) : (
        <FloorPlanPanel
          tables={mappedTables}
          onTableClick={handleTableClick}
          onEditTable={!isWaiter ? (id, name) => setEditingTable({ id, name }) : undefined}
          onDeleteTable={!isWaiter ? (id) => {
            const t = tables.find((item) => item.id === id);
            setDeletingTable({ id, name: t?.name || id });
          } : undefined}
        />
      )}

      {/* Table Action Modal */}
      {selectedOccupiedTable && (
        <TableActionModal
          table={selectedOccupiedTable}
          allTables={mappedTables}
          isOpen={true}
          onClose={() => setSelectedOccupiedTable(null)}
          onAction={handleModalAction}
        />
      )}

      {/* Waiter Clock-In Banner */}
      {isWaiter && !isClockedIn && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 bg-blue-950/95 border border-blue-500 text-blue-100 px-6 py-4 rounded-2xl shadow-2xl flex items-center gap-6 z-40 backdrop-blur-md">
          <div>
            <h3 className="font-bold text-base text-white">Vardiyaya Başla</h3>
            <p className="text-xs text-blue-200">Sipariş almak ve masalara servis yapmak için mesainizi başlatın.</p>
          </div>
          <button
            onClick={handleClockIn}
            className="bg-blue-600 hover:bg-blue-500 text-white px-6 py-2.5 rounded-xl font-bold shadow-md transition-all active:scale-98 shrink-0"
          >
            Giriş Yap
          </button>
        </div>
      )}

      {/* Add Table Modal (Single & Batch) */}
      <AddTableModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        existingTableCount={tables.length}
        onAddSingle={handleAddSingleTable}
        onAddBatch={handleAddBatchTables}
      />

      {/* Edit Table Modal */}
      <EditTableModal
        isOpen={Boolean(editingTable)}
        table={editingTable}
        onClose={() => setEditingTable(null)}
        onSave={handleSaveTableName}
      />

      {/* Delete Table Modal */}
      <DeleteTableModal
        isOpen={Boolean(deletingTable)}
        table={deletingTable}
        onClose={() => setDeletingTable(null)}
        onConfirm={handleDeleteTable}
      />
    </div>
  );
}


