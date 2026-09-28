import { useEffect, useState, useCallback } from 'react';
import { tauriInvoke as invoke } from '../../../../data/ipc/tauriInvoke';
import { toast as useToast } from '@core/components/ui/toast';
import { 
  Flame, 
  ChefHat, 
  Clock, 
  Search, 
  RefreshCw, 
  AlertCircle, 
  CheckCircle2, 
  UtensilsCrossed
} from 'lucide-react';

export interface Station {
  id: string;
  name: string;
  description?: string | null;
}

export interface KdsOrderItem {
  id?: string;
  product_name?: string;
  quantity?: number;
  station?: string | null;
  modifiers?: string | null;
  notes?: string | null;
  status?: string;
  [key: string]: unknown;
}

export interface KdsTicket {
  id: string;
  orderNumber: string;
  tableNumber?: string | null;
  status: string;
  items: KdsOrderItem[];
  createdAt: string;
  priority: string;
  notes?: string | null;
}

function elapsedMinutes(dateStr: string): number {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 60000);
}

function formatElapsed(dateStr: string): string {
  const mins = elapsedMinutes(dateStr);
  if (mins < 1) return 'Az önce';
  if (mins < 60) return `${mins} dk`;
  const hours = Math.floor(mins / 60);
  return `${hours} sa ${mins % 60} dk`;
}

export function KdsOverviewPanel() {
  const [tickets, setTickets] = useState<KdsTicket[]>([]);
  const [stations, setStations] = useState<Station[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [selectedStation, setSelectedStation] = useState<string>('ALL');
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'PENDING' | 'IN_PROGRESS' | 'READY'>('ALL');
  const [selectedTicketDetail, setSelectedTicketDetail] = useState<KdsTicket | null>(null);

  const addToast = (msg: string, type: 'success' | 'error' | 'info') => useToast.add({ title: msg, type });

  const fetchData = useCallback(async (showLoader = false) => {
    if (showLoader) setIsRefreshing(true);
    try {
      const [ticketData, stationData] = await Promise.all([
        invoke<KdsTicket[]>('get_active_tickets'),
        invoke<Station[]>('get_stations'),
      ]);
      setTickets(ticketData || []);
      setStations(stationData || []);
    } catch (error) {
      console.error('Failed to load KDS overview:', error);
      addToast('Mutfak biletleri ve istasyonlar alınamadı.', 'error');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(() => fetchData(false), 5000);
    return () => clearInterval(interval);
  }, [fetchData]);

  // Sayısal özetler
  const pendingCount = tickets.filter(t => t.status.toUpperCase() === 'PENDING').length;
  const inProgressCount = tickets.filter(t => t.status.toUpperCase() === 'IN_PROGRESS' || t.status.toUpperCase() === 'PREPARING').length;
  const readyCount = tickets.filter(t => t.status.toUpperCase() === 'READY').length;

  const filteredTickets = tickets.filter(ticket => {
    // İstasyon filtresi: bilet içindeki herhangi bir ürün bu istasyonda mı?
    const matchesStation = selectedStation === 'ALL' || ticket.items?.some(item => 
      item.station && (item.station === selectedStation || item.station.toLowerCase().includes(selectedStation.toLowerCase()))
    );

    // Durum filtresi
    const matchesStatus = statusFilter === 'ALL' || 
      (statusFilter === 'PENDING' && ticket.status.toUpperCase() === 'PENDING') ||
      (statusFilter === 'IN_PROGRESS' && (ticket.status.toUpperCase() === 'IN_PROGRESS' || ticket.status.toUpperCase() === 'PREPARING')) ||
      (statusFilter === 'READY' && ticket.status.toUpperCase() === 'READY');

    // Arama
    const term = searchTerm.toLowerCase();
    const matchesSearch = 
      (ticket.orderNumber && ticket.orderNumber.toLowerCase().includes(term)) ||
      (ticket.tableNumber && ticket.tableNumber.toLowerCase().includes(term)) ||
      ticket.items?.some(item => item.product_name && item.product_name.toLowerCase().includes(term));

    return matchesStation && matchesStatus && matchesSearch;
  });

  if (isLoading) {
    return <div className="flex h-64 items-center justify-center text-slate-400">Yükleniyor...</div>;
  }

  return (
    <div className="flex flex-col h-full space-y-6 text-foreground">
      {/* Üst İstatistik Kartları */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
        <div
          onClick={() => setStatusFilter('ALL')}
          className={`cursor-pointer transition-all rounded-2xl backdrop-blur-xl dark:bg-white/[0.04] bg-white/80 border p-4 flex items-center justify-between shadow-sm hover:dark:bg-white/[0.07] hover:bg-white ${
            statusFilter === 'ALL' ? 'border-[#007AFF] ring-1 ring-[#007AFF]' : 'dark:border-white/10 border-black/[0.08]'
          }`}
        >
          <div>
            <span className="text-xs font-semibold dark:text-zinc-400 text-zinc-500 uppercase tracking-wider">Aktif Mutfak Biletleri</span>
            <p className="text-3xl font-bold dark:text-white text-zinc-900 mt-1">{tickets.length}</p>
          </div>
          <div className="p-3 bg-[#007AFF]/10 text-[#007AFF] rounded-2xl">
            <UtensilsCrossed size={24} />
          </div>
        </div>

        <div
          onClick={() => setStatusFilter(statusFilter === 'PENDING' ? 'ALL' : 'PENDING')}
          className={`cursor-pointer transition-all rounded-2xl backdrop-blur-xl dark:bg-white/[0.04] bg-white/80 border p-4 flex items-center justify-between shadow-sm hover:dark:bg-white/[0.07] hover:bg-white ${
            statusFilter === 'PENDING' ? 'border-amber-500 ring-1 ring-amber-500' : 'dark:border-white/10 border-black/[0.08]'
          }`}
        >
          <div>
            <span className="text-xs font-semibold text-amber-500 uppercase tracking-wider">Hazırlık Bekleyen</span>
            <p className="text-3xl font-bold text-amber-500 mt-1">{pendingCount}</p>
          </div>
          <div className="p-3 bg-amber-500/10 text-amber-500 rounded-2xl">
            <Clock size={24} />
          </div>
        </div>

        <div
          onClick={() => setStatusFilter(statusFilter === 'IN_PROGRESS' ? 'ALL' : 'IN_PROGRESS')}
          className={`cursor-pointer transition-all rounded-2xl backdrop-blur-xl dark:bg-white/[0.04] bg-white/80 border p-4 flex items-center justify-between shadow-sm hover:dark:bg-white/[0.07] hover:bg-white ${
            statusFilter === 'IN_PROGRESS' ? 'border-blue-500 ring-1 ring-blue-500' : 'dark:border-white/10 border-black/[0.08]'
          }`}
        >
          <div>
            <span className="text-xs font-semibold text-blue-500 uppercase tracking-wider">Ocakta / Hazırlanıyor</span>
            <p className="text-3xl font-bold text-blue-500 mt-1">{inProgressCount}</p>
          </div>
          <div className="p-3 bg-blue-500/10 text-blue-500 rounded-2xl">
            <Flame size={24} />
          </div>
        </div>

        <div
          onClick={() => setStatusFilter(statusFilter === 'READY' ? 'ALL' : 'READY')}
          className={`cursor-pointer transition-all rounded-2xl backdrop-blur-xl dark:bg-white/[0.04] bg-white/80 border p-4 flex items-center justify-between shadow-sm hover:dark:bg-white/[0.07] hover:bg-white ${
            statusFilter === 'READY' ? 'border-emerald-500 ring-1 ring-emerald-500' : 'dark:border-white/10 border-black/[0.08]'
          }`}
        >
          <div>
            <span className="text-xs font-semibold text-emerald-500 uppercase tracking-wider">Servise Hazır</span>
            <p className="text-3xl font-bold text-emerald-500 mt-1">{readyCount}</p>
          </div>
          <div className="p-3 bg-emerald-500/10 text-emerald-500 rounded-2xl">
            <CheckCircle2 size={24} />
          </div>
        </div>
      </div>

      {/* İstasyon Filtre Çubuğu */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl dark:bg-white/[0.04] bg-white/80 backdrop-blur-xl border dark:border-white/10 border-black/[0.08] p-3 shadow-sm">
        <div className="flex items-center gap-2 overflow-x-auto custom-scrollbar pb-1 sm:pb-0">
          <button
            onClick={() => setSelectedStation('ALL')}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all ${
              selectedStation === 'ALL'
                ? 'bg-[#007AFF] text-white shadow-sm'
                : 'dark:text-zinc-400 text-zinc-600 hover:dark:text-white hover:text-zinc-900 hover:dark:bg-white/[0.06] hover:bg-black/[0.04]'
            }`}
          >
            Tüm İstasyonlar ({tickets.length})
          </button>
          {stations.map(st => {
            const countForStation = tickets.filter(t => 
              t.items?.some(i => i.station && (i.station === st.name || i.station.includes(st.name)))
            ).length;

            return (
              <button
                key={st.id}
                onClick={() => setSelectedStation(st.name)}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap flex items-center gap-1.5 transition-all ${
                  selectedStation === st.name
                    ? 'bg-[#007AFF] text-white shadow-sm'
                    : 'dark:text-zinc-400 text-zinc-600 hover:dark:text-white hover:text-zinc-900 hover:dark:bg-white/[0.06] hover:bg-black/[0.04]'
                }`}
              >
                <ChefHat size={14} />
                {st.name} ({countForStation})
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-3 flex-1 max-w-md">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-zinc-400" />
            <input
              type="text"
              placeholder="Bilet no, masa veya ürün ara..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-4 py-2 rounded-2xl dark:bg-white/[0.05] bg-black/[0.03] border dark:border-white/10 border-black/[0.08] text-sm dark:text-white text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:border-[#007AFF]/50"
            />
          </div>

          <button
            onClick={() => fetchData(true)}
            disabled={isRefreshing}
            className="p-2 rounded-2xl dark:bg-white/[0.06] bg-black/[0.05] dark:text-zinc-300 text-zinc-700 hover:dark:bg-white/[0.1] hover:bg-black/[0.08] transition-all disabled:opacity-50 cursor-pointer"
            title="Yenile"
          >
            <RefreshCw size={16} className={isRefreshing ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Bilet Kartları Izgarası */}
      <div className="flex-1 overflow-y-auto">
        {filteredTickets.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 dark:bg-white/[0.02] bg-white/60 border dark:border-white/10 border-black/[0.08] rounded-3xl text-zinc-400 p-8 shadow-sm">
            <CheckCircle2 size={40} className="dark:text-zinc-600 text-zinc-400 mb-2" />
            <p className="text-base font-semibold dark:text-zinc-300 text-zinc-700">Şu anda bekleyen mutfak bileti bulunmuyor.</p>
            <p className="text-xs dark:text-zinc-500 text-zinc-400 mt-1">Sipariş girildiğinde mutfak istasyonlarında burada anlık listelenecektir.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredTickets.map(ticket => {
              const mins = elapsedMinutes(ticket.createdAt);
              const isUrgent = mins >= 25 || ticket.priority?.toUpperCase() === 'HIGH' || ticket.priority?.toUpperCase() === 'URGENT';
              const isWarning = mins >= 15 && mins < 25;

              const isReady = ticket.status.toUpperCase() === 'READY';
              const isInProgress = ticket.status.toUpperCase() === 'IN_PROGRESS' || ticket.status.toUpperCase() === 'PREPARING';

              return (
                <div
                  key={ticket.id}
                  onClick={() => setSelectedTicketDetail(ticket)}
                  className={`rounded-3xl border flex flex-col justify-between overflow-hidden transition-all cursor-pointer backdrop-blur-xl ${
                    isReady
                      ? 'dark:bg-emerald-500/10 bg-emerald-500/5 border-emerald-500/30 shadow-md hover:border-emerald-500'
                      : isUrgent
                      ? 'dark:bg-rose-500/10 bg-rose-500/5 border-rose-500/30 shadow-lg hover:border-rose-500'
                      : isWarning
                      ? 'dark:bg-amber-500/10 bg-amber-500/5 border-amber-500/30 hover:border-amber-500'
                      : 'dark:bg-white/[0.04] bg-white/80 dark:border-white/10 border-black/[0.08] hover:shadow-lg'
                  }`}
                >
                  {/* Bilet Üst Başlık */}
                  <div className="p-4 border-b dark:border-white/10 border-black/[0.08] dark:bg-white/[0.02] bg-black/[0.02] flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm font-bold dark:text-white text-zinc-900">
                          #{ticket.orderNumber || ticket.id}
                        </span>
                        <span className="text-xs px-2.5 py-0.5 rounded-full font-semibold dark:bg-white/10 bg-black/[0.05] dark:text-zinc-300 text-zinc-700">
                          {ticket.tableNumber || 'Paket / Genel'}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 text-xs dark:text-zinc-400 text-zinc-500 mt-1">
                        <Clock size={12} />
                        <span>Süre: </span>
                        <span className={`font-bold ${isUrgent ? 'text-red-500 animate-pulse' : isWarning ? 'text-amber-500' : 'dark:text-zinc-300 text-zinc-700'}`}>
                          {formatElapsed(ticket.createdAt)}
                        </span>
                      </div>
                    </div>

                    <div className="flex flex-col items-end gap-1">
                      <span
                        className={`text-xs px-2.5 py-0.5 rounded-full font-bold uppercase tracking-wider ${
                          isReady
                            ? 'bg-emerald-500/15 text-emerald-500 border border-emerald-500/30'
                            : isInProgress
                            ? 'bg-blue-500/15 text-blue-500 border border-blue-500/30'
                            : 'bg-amber-500/15 text-amber-500 border border-amber-500/30'
                        }`}
                      >
                        {isReady ? 'HAZIR' : isInProgress ? 'PİŞİYOR' : 'BEKLİYOR'}
                      </span>

                      {isUrgent && (
                        <span className="text-[10px] font-bold text-red-500 flex items-center gap-1">
                          <AlertCircle size={10} />
                          ÖNCELİKLİ
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Bilet İçi Kalemler */}
                  <div className="p-4 flex-1 space-y-2.5">
                    {ticket.notes && (
                      <div className="p-2.5 bg-amber-500/15 border border-amber-500/30 rounded-2xl text-xs text-amber-600 dark:text-amber-400">
                        <strong>Not:</strong> {ticket.notes}
                      </div>
                    )}

                    <div className="divide-y dark:divide-white/[0.06] divide-black/[0.06]">
                      {ticket.items?.map((item, idx) => (
                        <div key={item.id || idx} className="py-2.5 first:pt-0 last:pb-0 flex items-start justify-between gap-2">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-sm text-[#007AFF] min-w-[24px]">
                                {item.quantity || 1}x
                              </span>
                              <span className="text-sm font-semibold dark:text-white text-zinc-900">
                                {item.product_name || 'Ürün'}
                              </span>
                            </div>

                            {item.modifiers && (
                              <p className="text-xs dark:text-zinc-400 text-zinc-500 pl-8 mt-0.5">
                                + {item.modifiers}
                              </p>
                            )}

                            {item.notes && (
                              <p className="text-xs text-amber-500 pl-8 mt-0.5">
                                • {item.notes}
                              </p>
                            )}
                          </div>

                          {item.station && (
                            <span className="text-[10px] px-2 py-0.5 rounded-full dark:bg-white/10 bg-black/[0.05] dark:text-zinc-400 text-zinc-600 font-medium whitespace-nowrap">
                              {item.station}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Alt Bilgi */}
                  <div className="px-4 py-2.5 dark:bg-white/[0.02] bg-black/[0.02] border-t dark:border-white/10 border-black/[0.08] text-xs dark:text-zinc-500 text-zinc-400 flex justify-between items-center">
                    <span>{ticket.items?.length || 0} Kalem</span>
                    <span className="font-mono text-[11px]">{new Date(ticket.createdAt).toLocaleTimeString()}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* MODAL: Mutfak Bilet Detayı */}
      {selectedTicketDetail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 dark:bg-black/75 backdrop-blur-2xl p-4">
          <div className="w-full max-w-lg backdrop-blur-3xl dark:bg-[#121318]/95 bg-white/95 border dark:border-white/10 border-black/[0.08] rounded-3xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold dark:text-white text-zinc-900">
                  Mutfak Bileti #{selectedTicketDetail.orderNumber || selectedTicketDetail.id}
                </h3>
                <p className="text-xs dark:text-zinc-400 text-zinc-500">
                  {selectedTicketDetail.tableNumber || 'Paket / Genel Servis'}
                </p>
              </div>
              <button
                onClick={() => setSelectedTicketDetail(null)}
                className="p-1.5 rounded-full text-zinc-400 hover:dark:text-white hover:text-zinc-900 hover:dark:bg-white/10 hover:bg-black/5 transition-all"
              >
                ✕
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3 p-3.5 rounded-2xl dark:bg-white/[0.04] bg-black/[0.02] border dark:border-white/10 border-black/[0.08] text-xs">
              <div>
                <span className="dark:text-zinc-400 text-zinc-500 block">Durum:</span>
                <span className="font-bold dark:text-white text-zinc-900 uppercase">{selectedTicketDetail.status}</span>
              </div>
              <div>
                <span className="dark:text-zinc-400 text-zinc-500 block">Bekleme Süresi:</span>
                <span className="font-bold text-amber-500">{formatElapsed(selectedTicketDetail.createdAt)}</span>
              </div>
              <div>
                <span className="dark:text-zinc-400 text-zinc-500 block">Giriş Saati:</span>
                <span className="dark:text-zinc-300 text-zinc-700">{new Date(selectedTicketDetail.createdAt).toLocaleTimeString('tr-TR')}</span>
              </div>
              <div>
                <span className="dark:text-zinc-400 text-zinc-500 block">Öncelik:</span>
                <span className="font-semibold dark:text-zinc-200 text-zinc-800">{selectedTicketDetail.priority || 'Normal'}</span>
              </div>
            </div>

            {selectedTicketDetail.notes && (
              <div className="p-3 bg-amber-500/15 border border-amber-500/30 rounded-2xl text-xs text-amber-600 dark:text-amber-400">
                <strong>Sipariş Notu:</strong> {selectedTicketDetail.notes}
              </div>
            )}

            <div>
              <h5 className="text-xs font-bold uppercase tracking-wider dark:text-zinc-400 text-zinc-500 mb-2">Bilet Kalemleri</h5>
              <div className="max-h-60 overflow-y-auto space-y-2 p-1">
                {selectedTicketDetail.items?.map((item, idx) => (
                  <div key={item.id || idx} className="p-3 rounded-2xl dark:bg-white/[0.04] bg-black/[0.02] border dark:border-white/10 border-black/[0.08] flex items-start justify-between text-xs">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-[#007AFF]">{item.quantity || 1}x</span>
                        <span className="font-semibold dark:text-white text-zinc-900 text-sm">{item.product_name || 'Ürün'}</span>
                      </div>
                      {item.modifiers && <p className="dark:text-zinc-400 text-zinc-500 mt-1 pl-4">+ {item.modifiers}</p>}
                      {item.notes && <p className="text-amber-500 mt-0.5 pl-4">• {item.notes}</p>}
                    </div>
                    {item.station && (
                      <span className="px-2 py-0.5 rounded-full dark:bg-white/10 bg-black/[0.05] dark:text-zinc-300 text-zinc-700 text-[10px] font-medium">
                        {item.station}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-end pt-3 border-t dark:border-white/10 border-black/[0.08]">
              <button
                onClick={() => setSelectedTicketDetail(null)}
                className="px-4 py-2 dark:bg-white/[0.08] bg-black/[0.05] hover:dark:bg-white/[0.12] hover:bg-black/[0.08] dark:text-white text-zinc-800 rounded-2xl text-xs font-semibold transition-all cursor-pointer"
              >
                Kapat
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
