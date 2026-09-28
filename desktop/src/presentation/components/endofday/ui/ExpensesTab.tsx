import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  FileText,
  Plus,
  Search,
  RefreshCw,
  TrendingDown,
} from 'lucide-react';
import { tauriInvoke } from '../../../../data/ipc/tauriInvoke';
import { toast } from '@core/components/ui/toast';

export interface ExpenseItem {
  id: string;
  tenantId: string;
  category: string;
  amountCents: number;
  paymentMethod: string;
  directoryId?: string;
  directoryName?: string;
  shiftId?: string;
  actorId: string;
  description?: string;
  expenseDate: string;
  createdAt: string;
}

const CATEGORY_NAMES: Record<string, string> = {
  RENT: 'Kira Gideri',
  UTILITIES: 'Faturalar (Elektrik/Su)',
  SUPPLIER: 'Toptancı & Mal Alımı',
  STAFF_ADVANCE: 'Personel Avansı / Maaş',
  TAX: 'Vergi & Harçlar',
  MAINTENANCE: 'Bakım & Onarım',
  PERSONAL: 'Patron Şahsi',
  OTHER: 'Diğer Sarfiyat',
};

/**
 * Gider Defteri Sekmesi.
 * Kira, faturalar, personel avansları ve işletme sarfiyat fişlerini listeler.
 */
export const ExpensesTab: React.FC<{ onOpenNewExpense: () => void }> = ({ onOpenNewExpense }) => {
  const [expenses, setExpenses] = useState<ExpenseItem[]>([]);
  const [selectedCat, setSelectedCat] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  // Bildirim yöneticisi
  const showToast = (title: string, type: 'success' | 'error' | 'info' = 'info') => {
    try {
      toast.add({ title, type });
    } catch {
      console.log(`[${type}] ${title}`);
    }
  };

  const fetchExpenses = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await tauriInvoke<ExpenseItem[]>('get_expenses', {
        category: selectedCat === 'ALL' ? undefined : selectedCat,
      });
      setExpenses(Array.isArray(data) ? data : []);
    } catch (err) {
      showToast('Gider kayıtları yüklenemedi', 'error');
    } finally {
      setIsLoading(false);
    }
  }, [selectedCat]);

  useEffect(() => {
    fetchExpenses();
  }, [fetchExpenses]);

  const filteredExpenses = useMemo(() => {
    if (!searchQuery.trim()) return expenses;
    const q = searchQuery.toLowerCase();
    return expenses.filter(
      (e) =>
        (e.description && e.description.toLowerCase().includes(q)) ||
        (e.directoryName && e.directoryName.toLowerCase().includes(q)) ||
        (e.actorId && e.actorId.toLowerCase().includes(q))
    );
  }, [expenses, searchQuery]);

  const totalExpenseCents = useMemo(() => {
    return filteredExpenses.reduce((sum, e) => sum + e.amountCents, 0);
  }, [filteredExpenses]);

  const formatMoney = (cents: number) => {
    const liras = cents / 100;
    return new Intl.NumberFormat('tr-TR', {
      style: 'currency',
      currency: 'TRY',
      minimumFractionDigits: 2,
    }).format(liras);
  };

  return (
    <div className="space-y-6">
      {/* Üst Özet ve Aksiyon Barı */}
      <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
        {/* Kategori Filtreleri */}
        <div className="flex flex-wrap items-center gap-1.5 p-1 rounded-2xl dark:bg-white/[0.04] bg-white/75 border dark:border-white/10 border-black/10 backdrop-blur-xl">
          <button
            type="button"
            onClick={() => setSelectedCat('ALL')}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
              selectedCat === 'ALL'
                ? 'dark:bg-white/15 bg-black text-white shadow-sm'
                : 'dark:text-zinc-400 text-zinc-600 hover:dark:text-white'
            }`}
          >
            Tüm Giderler ({expenses.length})
          </button>
          {Object.entries(CATEGORY_NAMES).map(([key, name]) => (
            <button
              key={key}
              type="button"
              onClick={() => setSelectedCat(key)}
              className={`px-2.5 py-1.5 rounded-xl text-xs font-semibold transition-all ${
                selectedCat === key
                  ? 'dark:bg-white/15 bg-black text-white shadow-sm'
                  : 'dark:text-zinc-400 text-zinc-600 hover:dark:text-white'
              }`}
            >
              {name}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2.5 w-full sm:w-auto">
          <div className="relative flex-1 sm:w-60">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" size={14} />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Gider açıklaması ara..."
              className="w-full h-10 pl-8 pr-3 rounded-xl border dark:border-white/10 border-black/10 dark:bg-black/20 bg-black/[0.03] dark:text-white text-zinc-900 text-xs focus:outline-none"
            />
          </div>

          <button
            type="button"
            onClick={onOpenNewExpense}
            className="flex items-center gap-1.5 h-10 px-4 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold shadow-md transition-all active:scale-95 cursor-pointer shrink-0"
          >
            <Plus size={15} />
            <span>Yeni Gider Fişi</span>
          </button>
        </div>
      </div>

      {/* Toplam Gider Özeti Kartı */}
      <div className="backdrop-blur-xl dark:bg-white/[0.04] bg-white/75 border dark:border-white/10 border-black/10 rounded-2xl p-4 flex items-center justify-between shadow-md apple-specular">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-rose-500/15 text-rose-500">
            <TrendingDown size={20} />
          </div>
          <div>
            <span className="text-xs font-semibold uppercase tracking-wider dark:text-zinc-400 text-zinc-500">
              Listelenen Gider Toplamı
            </span>
            <p className="text-xl font-bold font-mono text-rose-600 dark:text-rose-400 tabular-nums">
              {formatMoney(totalExpenseCents)}
            </p>
          </div>
        </div>
        <span className="text-xs font-medium dark:text-zinc-400 text-zinc-500">
          {filteredExpenses.length} gider fişi
        </span>
      </div>

      {/* Giderler Listesi */}
      {isLoading ? (
        <div className="p-12 text-center dark:text-zinc-400 text-zinc-500 text-xs flex items-center justify-center gap-2">
          <RefreshCw className="animate-spin" size={16} />
          <span>Gider kayıtları yükleniyor...</span>
        </div>
      ) : filteredExpenses.length === 0 ? (
        <div className="p-12 text-center dark:bg-white/[0.02] bg-black/[0.02] rounded-3xl border dark:border-white/10 border-black/10">
          <FileText size={32} className="mx-auto text-zinc-400 mb-2 opacity-50" />
          <p className="text-sm font-semibold dark:text-white text-zinc-800">Gider Kaydı Bulunamadı</p>
          <p className="text-xs dark:text-zinc-500 text-zinc-500 mt-1">Seçili kategoride henüz kayıtlı bir gider bulunmuyor.</p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {filteredExpenses.map((exp) => (
            <div
              key={exp.id}
              className="backdrop-blur-xl dark:bg-white/[0.04] bg-white/75 border dark:border-white/10 border-black/[0.08] rounded-2xl p-4 shadow-sm hover:border-black/20 dark:hover:border-white/20 transition-all flex items-center justify-between gap-4"
            >
              <div className="flex items-center gap-3.5">
                <div className="w-10 h-10 rounded-xl dark:bg-white/[0.06] bg-black/[0.04] flex items-center justify-center text-zinc-600 dark:text-zinc-300 font-bold text-xs shrink-0">
                  {CATEGORY_NAMES[exp.category]?.charAt(0) || 'G'}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold dark:text-white text-zinc-900">
                      {CATEGORY_NAMES[exp.category] || exp.category}
                    </span>
                    {exp.directoryName && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full dark:bg-white/10 bg-black/5 dark:text-zinc-300 text-zinc-600">
                        {exp.directoryName}
                      </span>
                    )}
                  </div>
                  <p className="text-xs dark:text-zinc-400 text-zinc-600 mt-0.5">
                    {exp.description || 'Gider açıklaması belirtilmedi'}
                  </p>
                  <div className="flex items-center gap-3 text-[10px] dark:text-zinc-500 text-zinc-400 mt-1 font-mono">
                    <span>{new Date(exp.expenseDate).toLocaleDateString('tr-TR')}</span>
                    <span>•</span>
                    <span>Ödeme: {exp.paymentMethod === 'CASH' ? 'Nakit Kasa' : exp.paymentMethod === 'BANK_TRANSFER' ? 'Havale' : 'Banka Kartı'}</span>
                    <span>•</span>
                    <span>İşleyen: {exp.actorId}</span>
                  </div>
                </div>
              </div>

              <div className="text-right shrink-0">
                <div className="text-base font-bold font-mono text-rose-600 dark:text-rose-400 tabular-nums">
                  -{formatMoney(exp.amountCents)}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
