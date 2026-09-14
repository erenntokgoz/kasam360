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
    <div className="flex flex-col h-full space-y-6 text-slate-200">
      {/* Üst İstatistik Kartları */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
        <div
          onClick={() => setStatusFilter('ALL')}
          className={`cursor-pointer transition-all bg-slate-900 border rounded-xl p-4 flex items-center justify-between hover:bg-slate-800/80 ${
            statusFilter === 'ALL' ? 'border-indigo-500 ring-1 ring-indigo-500' : 'border-slate-800'
          }`}
        >
          <div>
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Aktif Mutfak Biletleri</span>
            <p className="text-3xl font-bold text-white mt-1">{tickets.length}</p>
          </div>
          <div className="p-3 bg-indigo-500/10 text-indigo-400 rounded-xl">
            <UtensilsCrossed size={24} />
          </div>
        </div>

        <div
          onClick={() => setStatusFilter(statusFilter === 'PENDING' ? 'ALL' : 'PENDING')}
          className={`cursor-pointer transition-all bg-slate-900 border rounded-xl p-4 flex items-center justify-between hover:bg-slate-800/80 ${
            statusFilter === 'PENDING' ? 'border-amber-500 ring-1 ring-amber-500' : 'border-slate-800'
          }`}
        >
          <div>
            <span className="text-xs font-semibold text-amber-400 uppercase tracking-wider">Hazırlık Bekleyen</span>
            <p className="text-3xl font-bold text-amber-300 mt-1">{pendingCount}</p>
          </div>
          <div className="p-3 bg-amber-500/10 text-amber-400 rounded-xl">
            <Clock size={24} />
          </div>
        </div>

        <div
          onClick={() => setStatusFilter(statusFilter === 'IN_PROGRESS' ? 'ALL' : 'IN_PROGRESS')}
          className={`cursor-pointer transition-all bg-slate-900 border rounded-xl p-4 flex items-center justify-between hover:bg-slate-800/80 ${
            statusFilter === 'IN_PROGRESS' ? 'border-blue-500 ring-1 ring-blue-500' : 'border-slate-800'
          }`}
        >
          <div>
            <span className="text-xs font-semibold text-blue-400 uppercase tracking-wider">Ocakta / Hazırlanıyor</span>
            <p className="text-3xl font-bold text-blue-300 mt-1">{inProgressCount}</p>
          </div>
          <div className="p-3 bg-blue-500/10 text-blue-400 rounded-xl">
            <Flame size={24} />
          </div>
        </div>

        <div
          onClick={() => setStatusFilter(statusFilter === 'READY' ? 'ALL' : 'READY')}
          className={`cursor-pointer transition-all bg-slate-900 border rounded-xl p-4 flex items-center justify-between hover:bg-slate-800/80 ${
            statusFilter === 'READY' ? 'border-emerald-500 ring-1 ring-emerald-500' : 'border-slate-800'
          }`}
        >
          <div>
            <span className="text-xs font-semibold text-emerald-400 uppercase tracking-wider">Servise Hazır</span>
            <p className="text-3xl font-bold text-emerald-300 mt-1">{readyCount}</p>
          </div>
          <div className="p-3 bg-emerald-500/10 text-emerald-400 rounded-xl">
            <CheckCircle2 size={24} />
          </div>
        </div>
      </div>

      {/* İstasyon Filtre Çubuğu */}
      <div className="flex flex-wrap items-center justify-between gap-4 bg-slate-900/70 border border-slate-800 p-3 rounded-xl">
        <div className="flex items-center gap-2 overflow-x-auto custom-scrollbar pb-1 sm:pb-0">
          <button
            onClick={() => setSelectedStation('ALL')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
              selectedStation === 'ALL'
                ? 'bg-indigo-600 text-white shadow'
                : 'text-slate-400 hover:text-white hover:bg-slate-800'
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
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap flex items-center gap-1.5 transition-colors ${
                  selectedStation === st.name
                    ? 'bg-indigo-600 text-white shadow'
                    : 'text-slate-400 hover:text-white hover:bg-slate-800'
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
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
            <input
              type="text"
              placeholder="Bilet no, masa veya ürün ara..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-4 py-2 rounded-lg bg-slate-950 border border-slate-700 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
            />
          </div>

          <button
            onClick={() => fetchData(true)}
            disabled={isRefreshing}
            className="p-2 rounded-lg bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700 transition-colors disabled:opacity-50"
            title="Yenile"
          >
            <RefreshCw size={16} className={isRefreshing ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Bilet Kartları Izgarası */}
      <div className="flex-1 overflow-y-auto">
        {filteredTickets.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 bg-slate-900/40 border border-slate-800 rounded-2xl text-slate-500 p-8">
            <CheckCircle2 size={40} className="text-slate-600 mb-2" />
            <p className="text-base font-medium text-slate-400">Şu anda bekleyen mutfak bileti bulunmuyor.</p>
            <p className="text-xs text-slate-500 mt-1">Sipariş girildiğinde mutfak istasyonlarında burada anlık listelenecektir.</p>
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
                  className={`rounded-2xl border flex flex-col justify-between overflow-hidden transition-all cursor-pointer ${
                    isReady
                      ? 'bg-emerald-950/20 border-emerald-800/60 shadow-md hover:border-emerald-500'
                      : isUrgent
                      ? 'bg-red-950/25 border-red-700/70 shadow-lg hover:border-red-500'
                      : isWarning
                      ? 'bg-amber-950/20 border-amber-700/60 hover:border-amber-500'
                      : 'bg-slate-900 border-slate-800 hover:border-slate-700 hover:shadow-lg'
                  }`}
                >
                  {/* Bilet Üst Başlık */}
                  <div className="p-4 border-b border-slate-800/80 bg-slate-950/40 flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm font-bold text-white">
                          #{ticket.orderNumber || ticket.id}
                        </span>
                        <span className="text-xs px-2 py-0.5 rounded font-semibold bg-slate-800 text-slate-300">
                          {ticket.tableNumber || 'Paket / Genel'}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 text-xs text-slate-400 mt-1">
                        <Clock size={12} />
                        <span>Süre: </span>
                        <span className={`font-bold ${isUrgent ? 'text-red-400 animate-pulse' : isWarning ? 'text-amber-400' : 'text-slate-300'}`}>
                          {formatElapsed(ticket.createdAt)}
                        </span>
                      </div>
                    </div>

                    <div className="flex flex-col items-end gap-1">
                      <span
                        className={`text-xs px-2.5 py-0.5 rounded-full font-bold uppercase tracking-wider ${
                          isReady
                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                            : isInProgress
                            ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                            : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                        }`}
                      >
                        {isReady ? 'HAZIR' : isInProgress ? 'PİŞİYOR' : 'BEKLİYOR'}
                      </span>

                      {isUrgent && (
                        <span className="text-[10px] font-bold text-red-400 flex items-center gap-1">
                          <AlertCircle size={10} />
                          ÖNCELİKLİ
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Bilet İçi Kalemler */}
                  <div className="p-4 flex-1 space-y-2.5">
                    {ticket.notes && (
                      <div className="p-2 bg-amber-950/30 border border-amber-700/30 rounded-lg text-xs text-amber-200">
                        <strong>Not:</strong> {ticket.notes}
                      </div>
                    )}

                    <div className="divide-y divide-slate-800/60">
                      {ticket.items?.map((item, idx) => (
                        <div key={item.id || idx} className="py-2 first:pt-0 last:pb-0 flex items-start justify-between gap-2">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-sm text-indigo-400 min-w-[24px]">
                                {item.quantity || 1}x
                              </span>
                              <span className="text-sm font-semibold text-white">
                                {item.product_name || 'Ürün'}
                              </span>
                            </div>

                            {item.modifiers && (
                              <p className="text-xs text-slate-400 pl-8 mt-0.5">
                                + {item.modifiers}
                              </p>
                            )}

                            {item.notes && (
                              <p className="text-xs text-amber-300/90 pl-8 mt-0.5">
                                • {item.notes}
                              </p>
                            )}
                          </div>

                          {item.station && (
                            <span className="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-slate-400 font-medium whitespace-nowrap">
                              {item.station}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Alt Bilgi */}
                  <div className="px-4 py-2.5 bg-slate-950/50 border-t border-slate-800/80 text-xs text-slate-500 flex justify-between items-center">
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg bg-slate-900 border border-slate-700 rounded-2xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-white">
                  Mutfak Bileti #{selectedTicketDetail.orderNumber || selectedTicketDetail.id}
                </h3>
                <p className="text-xs text-slate-400">
                  {selectedTicketDetail.tableNumber || 'Paket / Genel Servis'}
                </p>
              </div>
              <button
                onClick={() => setSelectedTicketDetail(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
              >
                ✕
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3 p-3 bg-slate-950 rounded-xl border border-slate-800 text-xs">
              <div>
                <span className="text-slate-500 block">Durum:</span>
                <span className="font-bold text-white uppercase">{selectedTicketDetail.status}</span>
              </div>
              <div>
                <span className="text-slate-500 block">Bekleme Süresi:</span>
                <span className="font-bold text-amber-400">{formatElapsed(selectedTicketDetail.createdAt)}</span>
              </div>
              <div>
                <span className="text-slate-500 block">Giriş Saati:</span>
                <span className="text-slate-300">{new Date(selectedTicketDetail.createdAt).toLocaleTimeString('tr-TR')}</span>
              </div>
              <div>
                <span className="text-slate-500 block">Öncelik:</span>
                <span className="font-semibold text-slate-200">{selectedTicketDetail.priority || 'Normal'}</span>
              </div>
            </div>

            {selectedTicketDetail.notes && (
              <div className="p-3 bg-amber-950/30 border border-amber-800/40 rounded-xl text-xs text-amber-200">
                <strong>Sipariş Notu:</strong> {selectedTicketDetail.notes}
              </div>
            )}

            <div>
              <h5 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">Bilet Kalemleri</h5>
              <div className="max-h-60 overflow-y-auto space-y-2 p-1">
                {selectedTicketDetail.items?.map((item, idx) => (
                  <div key={item.id || idx} className="p-3 bg-slate-950 rounded-xl border border-slate-800 flex items-start justify-between text-xs">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-indigo-400">{item.quantity || 1}x</span>
                        <span className="font-semibold text-white text-sm">{item.product_name || 'Ürün'}</span>
                      </div>
                      {item.modifiers && <p className="text-slate-400 mt-1 pl-4">+ {item.modifiers}</p>}
                      {item.notes && <p className="text-amber-300 mt-0.5 pl-4">• {item.notes}</p>}
                    </div>
                    {item.station && (
                      <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 text-[10px] font-medium">
                        {item.station}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-end pt-3 border-t border-slate-800">
              <button
                onClick={() => setSelectedTicketDetail(null)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-semibold transition-colors"
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
