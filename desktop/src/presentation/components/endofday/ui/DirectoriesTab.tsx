import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Users,
  Truck,
  UserCheck,
  Zap,
  Crown,
  Plus,
  Search,
  Phone,
  Mail,
  RefreshCw,
  X,
  CheckCircle2,
} from 'lucide-react';
import { tauriInvoke } from '../../../../data/ipc/tauriInvoke';
import { toast } from '@core/components/ui/toast';
import { DirectoryGuide } from './DirectoryGuide';
import { DirectoryStatement } from './DirectoryStatement';
import { OwnerPersonalPanel } from './OwnerPersonalPanel';

export interface DirectoryItem {
  id: string;
  tenantId: string;
  name: string;
  type: string;
  phone?: string;
  email?: string;
  taxNo?: string;
  taxOffice?: string;
  address?: string;
  creditLimitCents: number;
  notes?: string;
  createdAt: string;
  balanceCents: number;
}

const TYPE_CONFIG = {
  SUPPLIER: { label: 'Toptancı Firmalar', icon: <Truck size={14} />, badge: 'bg-indigo-500/15 text-indigo-500 border-indigo-500/30' },
  CUSTOMER: { label: 'Müşteri Veresiye', icon: <Users size={14} />, badge: 'bg-emerald-500/15 text-emerald-500 border-emerald-500/30' },
  STAFF: { label: 'Personel Finansı', icon: <UserCheck size={14} />, badge: 'bg-blue-500/15 text-blue-500 border-blue-500/30' },
  FIXED_EXPENSE: { label: 'Sabit Giderler', icon: <Zap size={14} />, badge: 'bg-amber-500/15 text-amber-500 border-amber-500/30' },
  OWNER_PERSONAL: { label: 'Patron Şahsi', icon: <Crown size={14} />, badge: 'bg-purple-500/15 text-purple-500 border-purple-500/30' },
};

/**
 * 5 Ayrıştırılmış Cari Rehber Bileşeni.
 * Toptancı firmalar, müşteri veresiye hesapları, personel avansları,
 * sabit işletme gider adresleri ve patron şahsi hesaplarını yönetir.
 */
export const DirectoriesTab: React.FC = () => {
  const [directories, setDirectories] = useState<DirectoryItem[]>([]);
  const [selectedType, setSelectedType] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);

  // Yeni Cari Form Durumları
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState('CUSTOMER');
  const [newPhone, setNewPhone] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newLimitStr, setNewLimitStr] = useState('');
  const [newNotes, setNewNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedDirectoryId, setSelectedDirectoryId] = useState<string | null>(null);

  // Bildirim yöneticisi
  const showToast = (title: string, type: 'success' | 'error' | 'info' = 'info') => {
    try {
      toast.add({ title, type });
    } catch {
      console.log(`[${type}] ${title}`);
    }
  };

  const fetchDirectories = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await tauriInvoke<DirectoryItem[]>('get_directories', {
        directory_type: selectedType === 'ALL' ? undefined : selectedType,
      });
      setDirectories(Array.isArray(data) ? data : []);
    } catch (err) {
      showToast('Cari kartlar yüklenemedi', 'error');
    } finally {
      setIsLoading(false);
    }
  }, [selectedType]);

  useEffect(() => {
    fetchDirectories();
  }, [fetchDirectories]);

  const filteredList = useMemo(() => {
    if (!searchQuery.trim()) return directories;
    const q = searchQuery.toLowerCase();
    return directories.filter(
      (d) =>
        d.name.toLowerCase().includes(q) ||
        (d.phone && d.phone.includes(q)) ||
        (d.taxNo && d.taxNo.includes(q))
    );
  }, [directories, searchQuery]);

  const handleCreateDirectory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;

    const limitVal = parseFloat(newLimitStr.replace(',', '.'));
    const limitCents = isNaN(limitVal) ? 0 : Math.round(limitVal * 100);

    setIsSubmitting(true);
    try {
      await tauriInvoke('create_directory', {
        payload: {
          name: newName.trim(),
          type: newType,
          phone: newPhone.trim() || undefined,
          email: newEmail.trim() || undefined,
          creditLimitCents: limitCents,
          notes: newNotes.trim() || undefined,
        },
      });
      showToast('Cari kart oluşturuldu', 'success');
      setShowAddModal(false);
      setNewName('');
      setNewPhone('');
      setNewEmail('');
      setNewLimitStr('');
      setNewNotes('');
      fetchDirectories();
    } catch (err) {
      showToast('Cari kart kaydedilemedi', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const formatMoney = (cents: number) => {
    const liras = cents / 100;
    return new Intl.NumberFormat('tr-TR', {
      style: 'currency',
      currency: 'TRY',
      minimumFractionDigits: 2,
    }).format(liras);
  };

  const selectedDirectory = useMemo(
    () => directories.find((d) => d.id === selectedDirectoryId) ?? null,
    [directories, selectedDirectoryId]
  );

  return (
    <div className="space-y-6">
      {/* Seçili rehber: alan kataloğu + ekstre + Patron Şahsi */}
      {selectedDirectory && (
        <>
          <DirectoryGuide type={selectedDirectory.type} record={selectedDirectory} />
          <DirectoryStatement
            directoryId={selectedDirectory.id}
            onNotify={(message, tone) => showToast(message, tone)}
          />
          {selectedDirectory.type === 'OWNER_PERSONAL' && (
            <OwnerPersonalPanel
              directoryId={selectedDirectory.id}
              onNotify={(message, tone) => showToast(message, tone)}
            />
          )}
        </>
      )}

      {/* Üst Filtre ve Aksiyon Barı */}
      <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
        {/* 5 Ayrıştırılmış Rehber Butonları */}
        <div className="flex flex-wrap items-center gap-1.5 p-1 rounded-2xl dark:bg-white/[0.04] bg-white/75 border dark:border-white/10 border-black/10 backdrop-blur-xl">
          <button
            type="button"
            onClick={() => setSelectedType('ALL')}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
              selectedType === 'ALL'
                ? 'dark:bg-white/15 bg-black text-white shadow-sm'
                : 'dark:text-zinc-400 text-zinc-600 hover:dark:text-white'
            }`}
          >
            Tüm Rehber ({directories.length})
          </button>
          {Object.entries(TYPE_CONFIG).map(([key, cfg]) => (
            <button
              key={key}
              type="button"
              onClick={() => setSelectedType(key)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
                selectedType === key
                  ? 'dark:bg-white/15 bg-black text-white shadow-sm'
                  : 'dark:text-zinc-400 text-zinc-600 hover:dark:text-white'
              }`}
            >
              {cfg.icon}
              <span>{cfg.label}</span>
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2.5 w-full sm:w-auto">
          {/* Arama */}
          <div className="relative flex-1 sm:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" size={14} />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Cari veya telefon ara..."
              className="w-full h-10 pl-8 pr-3 rounded-xl border dark:border-white/10 border-black/10 dark:bg-black/20 bg-black/[0.03] dark:text-white text-zinc-900 text-xs focus:outline-none focus:ring-1 focus:ring-[#007AFF]"
            />
          </div>

          <button
            type="button"
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-1.5 h-10 px-4 rounded-xl bg-[#007AFF] hover:bg-[#0071E3] text-white text-xs font-semibold shadow-md transition-all active:scale-95 cursor-pointer shrink-0"
          >
            <Plus size={15} />
            <span>Yeni Cari Kart</span>
          </button>
        </div>
      </div>

      {/* Cari Kartlar Izgarası */}
      {isLoading ? (
        <div className="p-12 text-center dark:text-zinc-400 text-zinc-500 text-xs flex items-center justify-center gap-2">
          <RefreshCw className="animate-spin" size={16} />
          <span>Cari rehber yükleniyor...</span>
        </div>
      ) : filteredList.length === 0 ? (
        <div className="p-12 text-center dark:bg-white/[0.02] bg-black/[0.02] rounded-3xl border dark:border-white/10 border-black/10">
          <Users size={32} className="mx-auto text-zinc-400 mb-2 opacity-50" />
          <p className="text-sm font-semibold dark:text-white text-zinc-800">Cari Kart Bulunamadı</p>
          <p className="text-xs dark:text-zinc-500 text-zinc-500 mt-1">Bu filtreye uygun kayıtlı cari hesap bulunmuyor.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredList.map((dir) => {
            const cfg = TYPE_CONFIG[dir.type as keyof typeof TYPE_CONFIG] || TYPE_CONFIG.CUSTOMER;
            const isOwed = dir.balanceCents > 0; // Bize borcu var (Alacak)
            const isOwing = dir.balanceCents < 0; // Biz borçluyuz

            return (
              <div
                key={dir.id}
                data-testid={`directory-card-${dir.id}`}
                onClick={() => setSelectedDirectoryId(dir.id)}
                className={`backdrop-blur-xl dark:bg-white/[0.04] bg-white/75 border rounded-3xl p-5 shadow-xl transition-all apple-specular flex flex-col justify-between cursor-pointer ${
                  selectedDirectoryId === dir.id
                    ? 'border-[#007AFF]/60 dark:bg-white/[0.08]'
                    : 'border dark:border-white/10 border-black/[0.08] hover:border-[#007AFF]/40'
                }`}
              >
                <div>
                  <div className="flex items-start justify-between gap-2 mb-3">
                    <div>
                      <h4 className="text-sm font-semibold dark:text-white text-zinc-900 tracking-tight leading-snug">
                        {dir.name}
                      </h4>
                      <div className="flex items-center gap-2 mt-1">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${cfg.badge}`}>
                          {cfg.icon}
                          <span>{cfg.label}</span>
                        </span>
                      </div>
                    </div>

                    {/* Bakiye Rozeti */}
                    <div className="text-right font-mono">
                      <div className={`text-sm font-bold tabular-nums ${
                        isOwed ? 'text-emerald-500' : isOwing ? 'text-rose-500' : 'dark:text-zinc-400 text-zinc-500'
                      }`}>
                        {formatMoney(Math.abs(dir.balanceCents))}
                      </div>
                      <div className="text-[10px] dark:text-zinc-500 text-zinc-500">
                        {isOwed ? 'Alacağımız' : isOwing ? 'Borcumuz' : 'Bakiye Sıfır'}
                      </div>
                    </div>
                  </div>

                  {/* İletişim Bilgileri */}
                  <div className="space-y-1.5 text-xs dark:text-zinc-400 text-zinc-600 pt-2 border-t dark:border-white/5 border-black/5">
                    {dir.phone && (
                      <div className="flex items-center gap-2">
                        <Phone size={12} className="text-zinc-500 shrink-0" />
                        <span className="font-mono">{dir.phone}</span>
                      </div>
                    )}
                    {dir.email && (
                      <div className="flex items-center gap-2 truncate">
                        <Mail size={12} className="text-zinc-500 shrink-0" />
                        <span className="truncate">{dir.email}</span>
                      </div>
                    )}
                    {dir.notes && (
                      <p className="text-[11px] italic dark:text-zinc-500 text-zinc-400 line-clamp-1 pt-1">
                        "{dir.notes}"
                      </p>
                    )}
                  </div>
                </div>

                {dir.creditLimitCents > 0 && (
                  <div className="mt-4 pt-2 border-t dark:border-white/5 border-black/5 flex items-center justify-between text-[11px] dark:text-zinc-500 text-zinc-400 font-mono">
                    <span>Kredi Limiti:</span>
                    <span>{formatMoney(dir.creditLimitCents)}</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Yeni Cari Kart Ekleme Modalı */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md animate-in fade-in duration-150">
          <div className="relative w-full max-w-md rounded-3xl dark:bg-[#121318]/90 bg-white/95 border dark:border-white/10 border-black/10 p-6 shadow-2xl backdrop-blur-2xl apple-specular animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between pb-3 mb-4 border-b dark:border-white/10 border-black/10">
              <h3 className="text-base font-semibold dark:text-white text-zinc-900">
                Yeni Cari Kart Tanımla
              </h3>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="p-1 rounded-full dark:text-zinc-400 text-zinc-600 hover:dark:text-white hover:text-black"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleCreateDirectory} className="space-y-3.5">
              <div>
                <label className="block mb-1 text-xs font-semibold dark:text-zinc-400 text-zinc-600">
                  Cari / Firma Adı *
                </label>
                <input
                  type="text"
                  required
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Örn: Anadolu Gıda Ltd."
                  className="w-full h-10 px-3 rounded-xl border dark:border-white/10 border-black/10 dark:bg-black/30 bg-black/[0.04] dark:text-white text-zinc-900 text-xs focus:outline-none focus:ring-2 focus:ring-[#007AFF]/40"
                />
              </div>

              <div>
                <label className="block mb-1 text-xs font-semibold dark:text-zinc-400 text-zinc-600">
                  Rehber Tipi *
                </label>
                <select
                  value={newType}
                  onChange={(e) => setNewType(e.target.value)}
                  className="w-full h-10 px-3 rounded-xl border dark:border-white/10 border-black/10 dark:bg-black/30 bg-black/[0.04] dark:text-white text-zinc-900 text-xs focus:outline-none"
                >
                  <option value="CUSTOMER">Müşteri Veresiye</option>
                  <option value="SUPPLIER">Toptancı Firma</option>
                  <option value="STAFF">Personel Finansı</option>
                  <option value="FIXED_EXPENSE">Sabit Gider Adresi</option>
                  <option value="OWNER_PERSONAL">Patron Şahsi Hesabı</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block mb-1 text-xs font-semibold dark:text-zinc-400 text-zinc-600">
                    Telefon
                  </label>
                  <input
                    type="text"
                    value={newPhone}
                    onChange={(e) => setNewPhone(e.target.value)}
                    placeholder="05..."
                    className="w-full h-10 px-3 rounded-xl border dark:border-white/10 border-black/10 dark:bg-black/30 bg-black/[0.04] dark:text-white text-zinc-900 text-xs font-mono focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block mb-1 text-xs font-semibold dark:text-zinc-400 text-zinc-600">
                    Kredi Limiti (₺)
                  </label>
                  <input
                    type="number"
                    value={newLimitStr}
                    onChange={(e) => setNewLimitStr(e.target.value)}
                    placeholder="0.00"
                    className="w-full h-10 px-3 rounded-xl border dark:border-white/10 border-black/10 dark:bg-black/30 bg-black/[0.04] dark:text-white text-zinc-900 text-xs font-mono focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block mb-1 text-xs font-semibold dark:text-zinc-400 text-zinc-600">
                  E-Posta
                </label>
                <input
                  type="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="ornek@firma.com"
                  className="w-full h-10 px-3 rounded-xl border dark:border-white/10 border-black/10 dark:bg-black/30 bg-black/[0.04] dark:text-white text-zinc-900 text-xs focus:outline-none"
                />
              </div>

              <div>
                <label className="block mb-1 text-xs font-semibold dark:text-zinc-400 text-zinc-600">
                  Notlar
                </label>
                <input
                  type="text"
                  value={newNotes}
                  onChange={(e) => setNewNotes(e.target.value)}
                  placeholder="Özel şartlar, vade süresi vb."
                  className="w-full h-10 px-3 rounded-xl border dark:border-white/10 border-black/10 dark:bg-black/30 bg-black/[0.04] dark:text-white text-zinc-900 text-xs focus:outline-none"
                />
              </div>

              <div className="pt-2 flex gap-3">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="flex-1 h-11 rounded-2xl dark:bg-white/[0.06] bg-black/[0.05] text-xs font-semibold dark:text-white text-zinc-800"
                >
                  İptal
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex-1 h-11 rounded-2xl bg-[#007AFF] hover:bg-[#0071E3] text-white text-xs font-semibold shadow-md flex items-center justify-center gap-1.5"
                >
                  <CheckCircle2 size={16} />
                  <span>{isSubmitting ? 'Kaydediliyor...' : 'Kaydet'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
