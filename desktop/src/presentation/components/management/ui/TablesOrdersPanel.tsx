import { useEffect, useState, useMemo } from 'react';
import { useFloorStore } from '../../../store/useFloorStore';
import { toast as useToast } from '@core/components/ui/toast';
import { 
  Armchair, 
  Plus, 
  Layers, 
  Pencil, 
  Trash2, 
  Search, 
  RefreshCw, 
  Building2,
  QrCode
} from 'lucide-react';
import { AddTableModal } from '../../floor/ui/AddTableModal';
import { EditTableModal } from '../../floor/ui/EditTableModal';
import { DeleteTableModal } from '../../floor/ui/DeleteTableModal';

// Masa Yönetim Paneli: Salon düzeni, masa ekleme, düzenleme ve silme operasyonları
export function TablesOrdersPanel() {
  const { 
    tables, 
    isLoading, 
    fetchFloorPlan, 
    addTable, 
    addTablesBatch, 
    removeTable, 
    updateTableName 
  } = useFloorStore();

  const [isRefreshing, setIsRefreshing] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedSection, setSelectedSection] = useState<string>('ALL');

  // Modallar için State Tanımları
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingTable, setEditingTable] = useState<{ id: string; name: string } | null>(null);
  const [deletingTable, setDeletingTable] = useState<{ id: string; name: string } | null>(null);
  const [qrPreviewTable, setQrPreviewTable] = useState<{ id: string; name: string } | null>(null);

  const addToast = (msg: string, type: 'success' | 'error' | 'info') => useToast.add({ title: msg, type });

  // İlk yüklemede ve yenileme tıklandığında masa listesini çek
  useEffect(() => {
    fetchFloorPlan().catch(() => {
      addToast('Masa listesi yüklenemedi.', 'error');
    });
  }, [fetchFloorPlan]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await fetchFloorPlan();
      addToast('Masa listesi güncellendi.', 'success');
    } catch {
      addToast('Masa listesi güncellenemedi.', 'error');
    } finally {
      setIsRefreshing(false);
    }
  };

  // Masanın bölümünü belirleme (İsimden akıllı bölüm tespiti)
  const getSectionName = (tableName: string): string => {
    const lower = tableName.toLowerCase();
    if (lower.includes('bahçe') || lower.includes('bahce')) return 'Bahçe';
    if (lower.includes('teras')) return 'Teras';
    if (lower.includes('balkon')) return 'Balkon';
    if (lower.includes('vip')) return 'VIP';
    if (lower.includes('bar')) return 'Bar';
    return 'Ana Salon';
  };

  // Mevcut bölümleri dinamik olarak topla
  const sections = useMemo(() => {
    const secSet = new Set<string>();
    secSet.add('Ana Salon');
    tables.forEach(t => secSet.add(getSectionName(t.name)));
    return Array.from(secSet);
  }, [tables]);

  // Arama ve bölüm filtresine göre masaları süz
  const filteredTables = useMemo(() => {
    return tables.filter(t => {
      const matchesSearch = t.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        t.id.toLowerCase().includes(searchTerm.toLowerCase());
      
      const tableSection = getSectionName(t.name);
      const matchesSection = selectedSection === 'ALL' || tableSection === selectedSection;

      return matchesSearch && matchesSection;
    });
  }, [tables, searchTerm, selectedSection]);

  // Tek Masa Ekleme İşleyicisi
  const handleAddSingle = async (id: string, name: string) => {
    try {
      await addTable(id, name);
      addToast(`${name} başarıyla oluşturuldu.`, 'success');
      setIsAddModalOpen(false);
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Masa eklenemedi.', 'error');
    }
  };

  // Toplu Masa Ekleme İşleyicisi
  const handleAddBatch = async (tablesToAdd: { id: string; name: string }[]) => {
    try {
      await addTablesBatch(tablesToAdd);
      addToast(`${tablesToAdd.length} adet masa başarıyla oluşturuldu.`, 'success');
      setIsAddModalOpen(false);
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Toplu masa eklenemedi.', 'error');
    }
  };

  // Masa Adı Güncelleme İşleyicisi
  const handleUpdateName = async (id: string, newName: string) => {
    try {
      await updateTableName(id, newName);
      addToast('Masa adı güncellendi.', 'success');
      setEditingTable(null);
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Masa adı güncellenemedi.', 'error');
    }
  };

  // Masa Silme İşleyicisi
  const handleDeleteConfirm = async (id: string) => {
    try {
      await removeTable(id);
      addToast('Masa başarıyla kaldırıldı.', 'success');
      setDeletingTable(null);
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Masa silinemedi.', 'error');
    }
  };

  return (
    <div className="space-y-6">
      {/* 1. Üst Başlık & Yönetim Araç Çubuğu */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 pb-2 border-b dark:border-white/10 border-black/[0.08]">
        <div>
          <h2 className="text-xl font-bold tracking-tight dark:text-white text-zinc-900 flex items-center gap-2">
            Masa &amp; Salon Yönetimi
            <span className="text-[11px] font-mono px-2.5 py-0.5 rounded-full dark:bg-[#007AFF]/15 bg-[#007AFF]/10 text-[#007AFF] border border-[#007AFF]/30 font-semibold">
              {tables.length} Masa Tanımlı
            </span>
          </h2>
          <p className="text-xs dark:text-zinc-400 text-zinc-500 mt-1">
            İşletmenizin salon, bahçe ve teras masalarını tanımlayın, adlandırın ve düzenleyin.
          </p>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <button
            onClick={handleRefresh}
            disabled={isRefreshing || isLoading}
            className="p-2.5 rounded-2xl dark:bg-white/[0.06] bg-black/[0.05] hover:dark:bg-white/[0.12] hover:bg-black/[0.08] dark:text-zinc-300 text-zinc-700 border dark:border-white/10 border-black/[0.08] transition-all cursor-pointer"
            title="Yenile"
          >
            <RefreshCw size={15} className={isRefreshing ? 'animate-spin' : ''} />
          </button>

          <button
            onClick={() => setIsAddModalOpen(true)}
            className="flex items-center gap-2 px-5 py-2.5 bg-[#007AFF] hover:bg-[#0071eb] text-white rounded-2xl text-xs font-semibold shadow-md shadow-[#007AFF]/25 transition-all active:scale-95 cursor-pointer"
          >
            <Plus size={15} />
            <span>Masa Ekle</span>
          </button>
        </div>
      </div>

      {/* 2. Apple Borsa Tarzı Metrik Özet Kartları */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* Toplam Masa */}
        <div className="rounded-3xl dark:bg-white/[0.04] bg-white/80 backdrop-blur-xl border dark:border-white/10 border-black/[0.08] p-5 shadow-sm flex items-center justify-between">
          <div>
            <span className="text-[11px] font-semibold uppercase tracking-wider dark:text-zinc-400 text-zinc-500 block">
              Toplam Masa Kapasitesi
            </span>
            <span className="text-3xl font-bold font-mono tracking-tight dark:text-white text-zinc-900 mt-1 block">
              {tables.length}
            </span>
          </div>
          <div className="w-12 h-12 rounded-2xl bg-[#007AFF]/15 text-[#007AFF] border border-[#007AFF]/25 flex items-center justify-center">
            <Armchair size={22} />
          </div>
        </div>

        {/* Bölüm Sayısı */}
        <div className="rounded-3xl dark:bg-white/[0.04] bg-white/80 backdrop-blur-xl border dark:border-white/10 border-black/[0.08] p-5 shadow-sm flex items-center justify-between">
          <div>
            <span className="text-[11px] font-semibold uppercase tracking-wider dark:text-zinc-400 text-zinc-500 block">
              Aktif Alan &amp; Bölümler
            </span>
            <span className="text-3xl font-bold font-mono tracking-tight dark:text-white text-zinc-900 mt-1 block">
              {sections.length}
            </span>
          </div>
          <div className="w-12 h-12 rounded-2xl bg-emerald-500/15 text-emerald-500 border border-emerald-500/25 flex items-center justify-center">
            <Building2 size={22} />
          </div>
        </div>

        {/* Hızlı Toplu Ekleme Kısa Yolu */}
        <div 
          onClick={() => setIsAddModalOpen(true)}
          className="rounded-3xl dark:bg-white/[0.04] bg-white/80 hover:dark:bg-white/[0.08] hover:bg-white border dark:border-white/10 border-black/[0.08] p-5 shadow-sm flex items-center justify-between cursor-pointer transition-all duration-200 group"
        >
          <div>
            <span className="text-[11px] font-semibold uppercase tracking-wider text-[#007AFF] block">
              Hızlı Toplu Oluşturucu
            </span>
            <span className="text-xs dark:text-zinc-300 text-zinc-700 mt-1 block font-medium">
              Seri masa numaralandır &rarr;
            </span>
          </div>
          <div className="w-12 h-12 rounded-2xl bg-purple-500/15 text-purple-500 border border-purple-500/25 flex items-center justify-center group-hover:scale-105 transition-transform">
            <Layers size={22} />
          </div>
        </div>
      </div>

      {/* 3. Arama Çubuğu & Bölüm Filtreleri */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        {/* Arama Alanı */}
        <div className="relative flex-1 max-w-md">
          <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 dark:text-zinc-400 text-zinc-500" />
          <input
            type="text"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            placeholder="Masa adı veya koduna göre ara..."
            className="w-full pl-10 pr-4 py-2.5 rounded-2xl dark:bg-white/[0.05] bg-black/[0.03] border dark:border-white/10 border-black/[0.08] dark:text-white text-zinc-900 placeholder:text-zinc-400 text-xs focus:outline-none focus:border-[#007AFF] transition-all"
          />
        </div>

        {/* Bölüm Filtre Butonları */}
        <div className="flex items-center gap-1.5 p-1 rounded-2xl dark:bg-white/[0.04] bg-black/[0.03] border dark:border-white/10 border-black/[0.08] overflow-x-auto no-scrollbar">
          <button
            onClick={() => setSelectedSection('ALL')}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer shrink-0 ${
              selectedSection === 'ALL'
                ? 'bg-[#007AFF] text-white shadow-sm'
                : 'dark:text-zinc-400 text-zinc-600 hover:dark:text-white hover:text-zinc-900'
            }`}
          >
            Tümü ({tables.length})
          </button>
          {sections.map(sec => {
            const count = tables.filter(t => getSectionName(t.name) === sec).length;
            return (
              <button
                key={sec}
                onClick={() => setSelectedSection(sec)}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer shrink-0 ${
                  selectedSection === sec
                    ? 'bg-[#007AFF] text-white shadow-sm'
                    : 'dark:text-zinc-400 text-zinc-600 hover:dark:text-white hover:text-zinc-900'
                }`}
              >
                {sec} ({count})
              </button>
            );
          })}
        </div>
      </div>

      {/* 4. Masa Kartları Izgarası (Grid) */}
      {isLoading && tables.length === 0 ? (
        <div className="flex items-center justify-center py-20 text-xs dark:text-zinc-400 text-zinc-500">
          Masalar yükleniyor...
        </div>
      ) : filteredTables.length === 0 ? (
        <div className="rounded-3xl dark:bg-white/[0.02] bg-black/[0.01] border dark:border-white/10 border-black/[0.08] p-12 text-center">
          <Armchair size={36} className="mx-auto mb-3 dark:text-zinc-600 text-zinc-400" />
          <h3 className="text-sm font-semibold dark:text-white text-zinc-900">Masa Bulunamadı</h3>
          <p className="text-xs dark:text-zinc-400 text-zinc-500 mt-1 max-w-sm mx-auto">
            {searchTerm ? 'Arama kriterinize uygun masa bulunamadı.' : 'Bu bölüme ait tanımlanmış masa bulunmuyor. Yeni bir masa ekleyebilirsiniz.'}
          </p>
          <button
            onClick={() => setIsAddModalOpen(true)}
            className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-[#007AFF] hover:bg-[#0071eb] text-white rounded-2xl text-xs font-semibold shadow-md shadow-[#007AFF]/25 transition-all cursor-pointer"
          >
            <Plus size={14} />
            <span>Yeni Masa Ekle</span>
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {filteredTables.map(table => {
            const sectionName = getSectionName(table.name);
            return (
              <div
                key={table.id}
                className="group rounded-3xl dark:bg-white/[0.04] bg-white/80 hover:dark:bg-white/[0.07] hover:bg-white backdrop-blur-xl border dark:border-white/10 border-black/[0.08] p-5 shadow-sm hover:shadow-md transition-all duration-200 flex flex-col justify-between"
              >
                <div>
                  {/* Kart Üst Bilgisi: Rozet ve QR/ID */}
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-[11px] font-semibold px-2.5 py-1 rounded-xl dark:bg-white/[0.06] bg-black/[0.04] dark:text-zinc-300 text-zinc-700 border dark:border-white/10 border-black/[0.08]">
                      {sectionName}
                    </span>

                    <button
                      onClick={() => setQrPreviewTable(table)}
                      className="p-1.5 rounded-xl dark:text-zinc-400 text-zinc-500 hover:dark:text-white hover:text-black dark:hover:bg-white/10 hover:bg-black/5 transition-colors cursor-pointer"
                      title="Masa Kodu / QR"
                    >
                      <QrCode size={15} />
                    </button>
                  </div>

                  {/* Masa Adı & İkon */}
                  <div className="flex items-center gap-3 my-2">
                    <div className="w-10 h-10 rounded-2xl dark:bg-white/[0.06] bg-black/[0.04] border dark:border-white/10 border-black/[0.08] flex items-center justify-center text-[#007AFF] shrink-0">
                      <Armchair size={20} />
                    </div>
                    <div className="min-w-0">
                      <h4 className="text-base font-bold tracking-tight dark:text-white text-zinc-900 truncate">
                        {table.name}
                      </h4>
                      <span className="text-[11px] font-mono dark:text-zinc-500 text-zinc-400 block truncate">
                        ID: {table.id}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Alt Aksiyon Butonları: Düzenle & Sil */}
                <div className="pt-4 mt-3 border-t dark:border-white/10 border-black/[0.08] flex items-center justify-between gap-2">
                  <button
                    onClick={() => setEditingTable({ id: table.id, name: table.name })}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl dark:bg-white/[0.06] bg-black/[0.04] hover:dark:bg-white/[0.12] hover:bg-black/[0.08] dark:text-zinc-200 text-zinc-700 text-xs font-semibold transition-all cursor-pointer"
                  >
                    <Pencil size={13} />
                    <span>Düzenle</span>
                  </button>

                  <button
                    onClick={() => setDeletingTable({ id: table.id, name: table.name })}
                    className="flex items-center justify-center p-2 rounded-xl text-rose-500 hover:bg-rose-500/10 transition-colors cursor-pointer"
                    title="Masayı Sil"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 5. Modallar (Ekle, Düzenle, Sil, QR Önizleme) */}
      <AddTableModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        existingTableCount={tables.length}
        onAddSingle={handleAddSingle}
        onAddBatch={handleAddBatch}
      />

      <EditTableModal
        isOpen={!!editingTable}
        table={editingTable}
        onClose={() => setEditingTable(null)}
        onSave={handleUpdateName}
      />

      <DeleteTableModal
        isOpen={!!deletingTable}
        table={deletingTable}
        onClose={() => setDeletingTable(null)}
        onConfirm={handleDeleteConfirm}
      />

      {/* QR Menü / Masa Bilgisi Modalı */}
      {qrPreviewTable && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 dark:bg-black/75 backdrop-blur-2xl p-4 animate-in fade-in duration-150">
          <div className="backdrop-blur-3xl dark:bg-[#121318]/95 bg-white/95 border dark:border-white/10 border-black/[0.08] rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden p-6 text-center animate-in zoom-in-95 duration-150">
            <div className="w-12 h-12 rounded-2xl bg-[#007AFF]/15 text-[#007AFF] border border-[#007AFF]/25 flex items-center justify-center mx-auto mb-3">
              <QrCode size={24} />
            </div>
            <h3 className="text-base font-bold dark:text-white text-zinc-900">{qrPreviewTable.name}</h3>
            <p className="text-xs dark:text-zinc-400 text-zinc-500 mt-1 font-mono">
              Masa Kodu: {qrPreviewTable.id}
            </p>

            <div className="my-6 p-4 rounded-2xl dark:bg-white/[0.03] bg-black/[0.02] border dark:border-white/[0.08] border-black/[0.08] flex flex-col items-center justify-center">
              <div className="w-36 h-36 bg-white rounded-2xl p-2 flex items-center justify-center shadow-md">
                <QrCode size={120} className="text-black" />
              </div>
              <span className="text-[11px] dark:text-zinc-400 text-zinc-500 mt-3">
                Müşteri QR Menü Sipariş Bağlantısı
              </span>
            </div>

            <button
              onClick={() => setQrPreviewTable(null)}
              className="w-full py-2.5 bg-[#007AFF] hover:bg-[#0071eb] text-white rounded-2xl text-xs font-semibold shadow-md shadow-[#007AFF]/25 transition-all cursor-pointer"
            >
              Kapat
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
