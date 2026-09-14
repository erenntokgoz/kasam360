import { useEffect, useState, useCallback, useRef } from 'react';
import {
  ChefHat,
  CheckCircle,
  Play,
  AlertTriangle,
  Filter,
  Bell,
  BellOff,
  RefreshCw,
  WifiOff,
  Clock,
  CheckCheck,
  Utensils,
  Check,
} from 'lucide-react';
import { tauriInvoke as invoke } from '../../../data/ipc/tauriInvoke';
import {
  KdsOrder,
  KitchenTicketStatus,
  KdsStationFilter,
  StationQueueItem,
  KdsStationDto,
  KdsOfflineQueuedAction,
} from '../../types';

// --- Offline queue helpers ---
const OFFLINE_QUEUE_KEY = 'kds_offline_queue';

function readQueue(): KdsOfflineQueuedAction[] {
  try {
    return JSON.parse(localStorage.getItem(OFFLINE_QUEUE_KEY) || '[]');
  } catch {
    return [];
  }
}

function writeQueue(queue: KdsOfflineQueuedAction[]): void {
  localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
}

function enqueueAction(action: Omit<KdsOfflineQueuedAction, 'queuedAt'>): void {
  const queue = readQueue();
  queue.push({
    ...action,
    id: action.id || `act_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    queuedAt: Date.now(),
  });
  writeQueue(queue);
}

// --- Audio helpers ---
const MUTE_KEY = 'kds_sound_muted';

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  try {
    if (!audioCtx || audioCtx.state === 'closed') {
      const AudioCtxClass =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      audioCtx = new AudioCtxClass();
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
    }
    return audioCtx;
  } catch (e) {
    console.warn('AudioContext not available:', e);
    return null;
  }
}

function playBeep(frequency = 880, duration = 0.35, volume = 0.25): void {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();
    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);
    oscillator.frequency.value = frequency;
    oscillator.type = 'sine';
    gainNode.gain.setValueAtTime(volume, ctx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    oscillator.start(ctx.currentTime);
    oscillator.stop(ctx.currentTime + duration);
  } catch (e) {
    console.warn('Audio notification failed:', e);
  }
}

function playChime(freqs: number[], durationPerTone = 0.18): void {
  freqs.forEach((freq, idx) => {
    setTimeout(() => {
      playBeep(freq, durationPerTone, 0.25);
    }, idx * (durationPerTone * 1000 * 0.85));
  });
}

// --- Main Component ---
export function KdsContainer(): JSX.Element {
  const [orders, setOrders] = useState<KdsOrder[]>([]);
  const [now, setNow] = useState(Date.now());
  const [selectedStation, setSelectedStation] = useState<KdsStationFilter | 'ALL'>('ALL');
  const [stations, setStations] = useState<KdsStationDto[]>([]);
  const [muted, setMuted] = useState<boolean>(() => localStorage.getItem(MUTE_KEY) === 'true');
  const [queueCount, setQueueCount] = useState<number>(() => readQueue().length);
  const [isOnline, setIsOnline] = useState<boolean>(() => (typeof navigator !== 'undefined' ? navigator.onLine : true));
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [serviceReadyNotice, setServiceReadyNotice] = useState<string | null>(null);

  const prevOrdersRef = useRef<Map<string, string>>(new Map());
  const isInitialLoadRef = useRef<boolean>(true);
  const isSyncingRef = useRef<boolean>(false);

  const refreshQueueCount = useCallback(() => {
    setQueueCount(readQueue().length);
  }, []);

  const fetchTicketsRef = useRef<() => Promise<void>>(async () => {});

  // Offline Kuyruk İşleme
  const processOfflineQueue: () => Promise<void> = useCallback(async () => {
    if (isSyncingRef.current) return;
    const queue = readQueue();
    if (queue.length === 0) return;

    isSyncingRef.current = true;
    setIsSyncing(true);

    const remaining: KdsOfflineQueuedAction[] = [];

    for (const action of queue) {
      try {
        if (action.type === 'ITEM_STATUS' || action.itemId) {
          await invoke('update_kds_item_status', {
            payload: {
              itemId: action.itemId,
              status: action.status || action.toStatus,
            },
          });
        } else {
          await invoke('kds_update_ticket_status', {
            payload: {
              orderId: action.orderId,
              fromStatus: action.fromStatus,
              toStatus: action.toStatus,
              timestamp: action.timestamp,
              actorId: action.actorId || 'system',
              actorRole: action.actorRole || 'Kitchen',
            },
          });
        }
      } catch (err) {
        console.warn('Offline queue item execution failed, retaining in queue:', err);
        remaining.push({
          ...action,
          retryCount: (action.retryCount || 0) + 1,
        });
      }
    }

    writeQueue(remaining);
    setQueueCount(remaining.length);
    isSyncingRef.current = false;
    setIsSyncing(false);
    if (fetchTicketsRef.current) {
      await fetchTicketsRef.current();
    }
  }, []);

  // İstasyonları Çekme (get_stations)
  const fetchStations = useCallback(async () => {
    try {
      const result = await invoke<KdsStationDto[]>('get_stations');
      if (Array.isArray(result) && result.length > 0) {
        setStations(result);
      } else {
        setStations([
          { id: 'st_sicak', name: 'Sıcak' },
          { id: 'st_soguk', name: 'Soğuk' },
          { id: 'st_icecek', name: 'İçecek' },
          { id: 'st_izgara', name: 'Izgara' },
          { id: 'st_tatli', name: 'Tatlı' },
        ]);
      }
    } catch (err) {
      console.error('Failed to fetch stations:', err);
      setStations([
        { id: 'st_sicak', name: 'Sıcak' },
        { id: 'st_soguk', name: 'Soğuk' },
        { id: 'st_icecek', name: 'İçecek' },
        { id: 'st_izgara', name: 'Izgara' },
        { id: 'st_tatli', name: 'Tatlı' },
      ]);
    }
  }, []);

  // Aktif Biletleri Çekme (get_active_tickets)
  const fetchTickets: () => Promise<void> = useCallback(async () => {
    try {
      const result = await invoke<KdsOrder[]>('get_active_tickets');
      const safeResult = Array.isArray(result) ? result : [];

      if (!muted) {
        if (!isInitialLoadRef.current) {
          safeResult.forEach((order) => {
            const prevStatus = prevOrdersRef.current.get(order.id);
            if (!prevStatus) {
              // Yeni sipariş geldi: Çift ton (880Hz -> 1175Hz)
              playChime([880, 1175], 0.2);
            } else {
              const pUp = prevStatus.toUpperCase();
              const curUp = (order.status || '').toUpperCase();
              if (pUp !== 'READY' && curUp === 'READY') {
                // Sipariş hazır oldu: Başarı tonu (1046Hz -> 1318Hz)
                playChime([1046, 1318], 0.25);
              }
            }
          });
        }
      }

      isInitialLoadRef.current = false;
      prevOrdersRef.current = new Map(safeResult.map((o) => [o.id, o.status]));
      setOrders(safeResult);

      // Ağ geri geldiyse bekleyen kuyruğu ilet
      if (typeof navigator !== 'undefined' && navigator.onLine) {
        await processOfflineQueue();
      }
    } catch (err) {
      console.error('Failed to fetch active tickets:', err);
    }
  }, [muted, processOfflineQueue]);

  useEffect(() => {
    fetchTicketsRef.current = fetchTickets;
  }, [fetchTickets]);

  // Online / Offline Olay Dinleyicileri
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      processOfflineQueue();
      fetchTickets();
    };

    const handleOffline = () => {
      setIsOnline(false);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [processOfflineQueue, fetchTickets]);

  // İlk yükleme ve periyodik yoklama
  useEffect(() => {
    fetchStations();
    fetchTickets();
    const interval = setInterval(fetchTickets, 3000);
    return () => clearInterval(interval);
  }, [fetchTickets, fetchStations]);

  // Saat sayacı
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const toggleMute = useCallback(() => {
    setMuted((prev) => {
      const next = !prev;
      localStorage.setItem(MUTE_KEY, String(next));
      if (!next) {
        playBeep(988, 0.15, 0.2);
      }
      return next;
    });
  }, []);

  // Bilet Durumu İlerletme (PENDING -> PREPARING -> READY -> SERVED)
  const handleAdvanceStatus = async (orderId: string, currentStatus: KitchenTicketStatus) => {
    getAudioContext();
    const norm = (currentStatus || 'Pending').toUpperCase();
    let nextStatus: KitchenTicketStatus | undefined;

    if (norm === 'PENDING') nextStatus = 'Preparing';
    else if (norm === 'PREPARING') nextStatus = 'Ready';
    else if (norm === 'READY') nextStatus = 'SERVED';

    if (!nextStatus) return;

    const orderObj = orders.find((o) => o.id === orderId);
    const tableLabel = orderObj?.tableNumber ? `Masa ${orderObj.tableNumber}` : 'Paket Sipariş';

    const payload = {
      orderId,
      fromStatus: currentStatus,
      toStatus: nextStatus,
      timestamp: new Date().toISOString(),
      actorId: 'system',
      actorRole: 'Kitchen',
    };

    // Ready'ye geçtiğinde bildirim bannerı göster ve ses çal
    if (nextStatus === 'Ready') {
      if (!muted) playChime([1046, 1318], 0.25);
      setServiceReadyNotice(`${tableLabel} (#${orderObj?.orderNumber}) servise hazır!`);
      setTimeout(() => setServiceReadyNotice(null), 5000);
    }

    try {
      await invoke('kds_update_ticket_status', { payload });
      await fetchTickets();
    } catch (err) {
      console.warn('Failed to update ticket status -- queuing offline:', err);
      enqueueAction({
        type: 'TICKET_STATUS',
        orderId,
        fromStatus: currentStatus,
        toStatus: nextStatus,
        timestamp: payload.timestamp,
        actorId: 'system',
        actorRole: 'Kitchen',
      });
      refreshQueueCount();

      // İyimser UI güncellemesi
      setOrders((prev) =>
        prev
          .map((o) =>
            o.id === orderId
              ? {
                  ...o,
                  status: nextStatus as KitchenTicketStatus,
                  items: o.items.map((it) =>
                    nextStatus === 'Ready'
                      ? { ...it, status: 'Ready' as KitchenTicketStatus }
                      : nextStatus === 'SERVED'
                      ? { ...it, status: 'Completed' as KitchenTicketStatus }
                      : it
                  ),
                }
              : o
          )
          .filter((o) => (nextStatus === 'SERVED' ? o.id !== orderId : true))
      );
    }
  };

  // Kalem Durumu Güncelleme (update_kds_item_status)
  const handleUpdateItemStatus = async (
    orderId: string,
    item: StationQueueItem,
    e?: React.MouseEvent
  ) => {
    if (e) e.stopPropagation();
    getAudioContext();

    const currentItemStatus = (item.status || 'Pending').toUpperCase();
    let nextItemStatus: KitchenTicketStatus = 'Preparing';

    if (currentItemStatus === 'PENDING') nextItemStatus = 'Preparing';
    else if (currentItemStatus === 'PREPARING') nextItemStatus = 'Ready';
    else if (currentItemStatus === 'READY') nextItemStatus = 'Pending';

    if (!muted) playBeep(700, 0.1, 0.2);

    try {
      await invoke('update_kds_item_status', {
        payload: {
          itemId: item.id,
          status: nextItemStatus,
        },
      });
      await fetchTickets();
    } catch (err) {
      console.warn('Failed to update item status -- queuing offline:', err);
      enqueueAction({
        type: 'ITEM_STATUS',
        itemId: item.id,
        status: nextItemStatus,
        orderId,
        timestamp: new Date().toISOString(),
        actorId: 'system',
        actorRole: 'Kitchen',
      });
      refreshQueueCount();

      // İyimser UI güncellemesi
      setOrders((prev) =>
        prev.map((ord) => {
          if (ord.id !== orderId) return ord;
          const updatedItems = ord.items.map((it) =>
            it.id === item.id ? { ...it, status: nextItemStatus } : it
          );
          const allReady = updatedItems.every((it) => {
            const s = (it.status || '').toUpperCase();
            return s === 'READY' || s === 'COMPLETED' || s === 'SERVED';
          });
          return {
            ...ord,
            status: allReady ? ('Ready' as KitchenTicketStatus) : ord.status,
            items: updatedItems,
          };
        })
      );
    }
  };

  const getElapsedTime = (createdAt: string) => {
    const elapsedMs = Math.max(0, now - new Date(createdAt).getTime());
    const minutes = Math.floor(elapsedMs / 60000);
    const seconds = Math.floor((elapsedMs % 60000) / 1000);
    return { minutes, seconds, elapsedMs };
  };

  const formatTime = (minutes: number, seconds: number) =>
    `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

  const getTicketColorClass = (status: KitchenTicketStatus, elapsedMinutes: number) => {
    const s = (status || '').toUpperCase();
    if (s === 'PENDING') {
      if (elapsedMinutes >= 15) return 'bg-red-950/90 border-red-500 shadow-[0_0_20px_rgba(239,68,68,0.4)]';
      if (elapsedMinutes >= 10) return 'bg-orange-950/80 border-orange-500';
      return 'bg-slate-900 border-slate-700';
    }
    if (s === 'PREPARING') {
      if (elapsedMinutes >= 20) return 'bg-red-950/90 border-red-500 shadow-[0_0_20px_rgba(239,68,68,0.4)]';
      return 'bg-blue-950/80 border-blue-500/80';
    }
    if (s === 'READY') return 'bg-emerald-950/90 border-emerald-500 shadow-[0_0_15px_rgba(16,185,129,0.3)]';
    return 'bg-slate-800 border-slate-700';
  };

  // İstasyon Eşleştirme Yardımcısı (Ad ve ID ile case-insensitive eşleşme)
  const matchesStation = (itemStation?: string, itemStationId?: string) => {
    if (selectedStation === 'ALL') return true;

    const sel = selectedStation.trim().toLowerCase();
    const stationObj = stations.find(
      (s) => s.id.toLowerCase() === sel || s.name.toLowerCase() === sel
    );

    const targetId = stationObj?.id.toLowerCase() || sel;
    const targetName = stationObj?.name.toLowerCase() || sel;

    const itSt = (itemStation || '').trim().toLowerCase();
    const itStId = (itemStationId || '').trim().toLowerCase();

    return (
      itSt === targetId ||
      itSt === targetName ||
      itStId === targetId ||
      itStId === targetName ||
      (itSt !== '' && targetName.includes(itSt)) ||
      (targetName !== '' && itSt.includes(targetName))
    );
  };

  const filteredOrders = orders.filter((o) => {
    if (selectedStation === 'ALL') return true;
    return o.items.some((item) => matchesStation(item.station, item.stationId));
  });

  return (
    <div className="flex h-full w-full flex-col bg-slate-950 p-4 overflow-hidden select-none">
      {/* Servis Hazır Bildirim Bannerı */}
      {serviceReadyNotice && (
        <div className="mb-3 flex items-center justify-between gap-3 bg-emerald-600 text-white px-5 py-3 rounded-xl shadow-lg animate-fade-in shrink-0">
          <div className="flex items-center gap-2 font-black text-lg">
            <Utensils size={24} className="animate-bounce" />
            <span>{serviceReadyNotice}</span>
          </div>
          <button
            onClick={() => setServiceReadyNotice(null)}
            className="text-emerald-100 hover:text-white font-bold text-sm bg-emerald-700/50 px-3 py-1 rounded-lg"
          >
            Tamam
          </button>
        </div>
      )}

      {/* Üst Bar / Kontroller */}
      <div className="flex items-center justify-between mb-4 shrink-0 bg-slate-900 p-4 rounded-xl border border-slate-800 shadow-md">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-3">
            <ChefHat size={32} className="text-amber-400" />
            <h2 className="text-2xl font-black text-white tracking-widest uppercase">Mutfak KDS</h2>
          </div>

          {/* Ağ ve Senkronizasyon Durumu */}
          {!isOnline && (
            <span className="flex items-center gap-1.5 bg-rose-900/80 text-rose-200 border border-rose-600 text-xs font-bold px-3 py-1.5 rounded-lg">
              <WifiOff size={14} /> Çevrimdışı
            </span>
          )}

          {queueCount > 0 && (
            <button
              onClick={processOfflineQueue}
              disabled={isSyncing}
              title="Kuyruğu Sunucuya Eşitle"
              className="flex items-center gap-2 bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold px-3 py-1.5 rounded-lg border border-amber-400 transition-colors shadow-sm"
            >
              <RefreshCw size={14} className={isSyncing ? 'animate-spin' : ''} />
              <span>{queueCount} bekleyen senkronizasyon</span>
            </button>
          )}
        </div>

        <div className="flex items-center gap-4">
          {/* İstasyon Filtreleme */}
          <div className="flex items-center gap-2 bg-slate-800 px-4 py-2 rounded-lg border border-slate-700 hover:border-slate-600 transition-colors">
            <Filter size={18} className="text-slate-400" />
            <select
              className="bg-transparent text-white font-bold outline-none cursor-pointer text-sm"
              value={selectedStation}
              onChange={(e) => setSelectedStation(e.target.value as KdsStationFilter | 'ALL')}
            >
              <option value="ALL" className="bg-slate-900 text-white">Tüm İstasyonlar</option>
              {stations
                .filter((st) => st.id.toUpperCase() !== 'ALL')
                .map((st) => (
                  <option key={st.id} value={st.id} className="bg-slate-900 text-white">
                    {st.name}
                  </option>
                ))}
            </select>
          </div>

          {/* Ses Bildirim Toggle */}
          <button
            onClick={toggleMute}
            title={muted ? 'Sesi Aç' : 'Sesi Kapat'}
            className={`flex items-center justify-center w-10 h-10 rounded-lg border transition-colors ${
              muted
                ? 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'
                : 'bg-amber-500/20 border-amber-500/40 text-amber-300 hover:bg-amber-500/30'
            }`}
          >
            {muted ? <BellOff size={20} /> : <Bell size={20} />}
          </button>

          {/* Saat */}
          <div className="flex items-center gap-2 text-slate-300 font-mono text-xl font-bold bg-slate-800/80 px-3 py-1.5 rounded-lg border border-slate-700">
            <Clock size={18} className="text-slate-400" />
            {new Date(now).toLocaleTimeString('tr-TR')}
          </div>
        </div>
      </div>

      {/* Kanban Sütunları */}
      <div className="flex-1 overflow-x-auto">
        <div className="flex gap-4 h-full min-w-max pb-2">
          {(['Pending', 'Preparing', 'Ready'] as KitchenTicketStatus[]).map((colStatus) => {
            const colStatusUpper = (colStatus || '').toUpperCase();
            const columnOrders = filteredOrders.filter(
              (o) => (o.status || '').toUpperCase() === colStatusUpper
            );

            const columnTitle =
              colStatusUpper === 'PENDING'
                ? 'YENİ SİPARİŞLER'
                : colStatusUpper === 'PREPARING'
                ? 'HAZIRLANIYOR'
                : 'HAZIR & SERVİS BEKLEYEN';

            const columnColor =
              colStatusUpper === 'PENDING'
                ? 'text-amber-400 border-amber-500'
                : colStatusUpper === 'PREPARING'
                ? 'text-blue-400 border-blue-500'
                : 'text-emerald-400 border-emerald-500';

            return (
              <div
                key={colStatus}
                className="flex flex-col w-[420px] max-h-full bg-slate-900/60 rounded-2xl border border-slate-800 p-3 shadow-xl"
              >
                <div
                  className={`flex justify-between items-center mb-3 px-2 pb-3 border-b-2 ${columnColor} shrink-0`}
                >
                  <h3 className="text-lg font-black tracking-wider text-white flex items-center gap-2">
                    {columnTitle}
                  </h3>
                  <span className="bg-slate-800 text-white px-3 py-0.5 rounded-full font-bold text-sm border border-slate-700">
                    {columnOrders.length}
                  </span>
                </div>

                {/* Bilet Listesi */}
                <div className="flex flex-col gap-3 overflow-y-auto pr-1 flex-1 pb-2">
                  {columnOrders.map((order) => {
                    const time = getElapsedTime(order.createdAt);
                    const isOverdue =
                      (colStatusUpper === 'PENDING' && time.minutes >= 15) ||
                      (colStatusUpper === 'PREPARING' && time.minutes >= 20);

                    const visibleItems =
                      selectedStation === 'ALL'
                        ? order.items
                        : order.items.filter((it) => matchesStation(it.station, it.stationId));

                    const allTicketItemsReady =
                      order.items.length > 0 &&
                      order.items.every((it) => {
                        const s = (it.status || '').toUpperCase();
                        return s === 'READY' || s === 'COMPLETED' || s === 'SERVED';
                      });

                    return (
                      <div
                        key={order.id}
                        className={`flex flex-col rounded-xl border-2 p-4 transition-all shrink-0 ${getTicketColorClass(
                          order.status,
                          time.minutes
                        )}`}
                      >
                        {/* Bilet Başlığı */}
                        <div className="flex justify-between items-start mb-3">
                          <div className="flex flex-col gap-0.5">
                            <div className="font-black text-3xl text-white tracking-tight">
                              #{order.orderNumber}
                            </div>
                            <div className="text-slate-200 font-bold text-base flex items-center gap-2">
                              <span>Masa: {order.tableNumber || 'PAKET'}</span>
                              {colStatusUpper === 'READY' && (
                                <span className="flex items-center gap-1 text-[11px] font-black bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded-full border border-emerald-500 animate-pulse">
                                  <Utensils size={12} /> SERVİSE HAZIR
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="flex flex-col items-end gap-1.5">
                            <div
                              className={`font-mono text-2xl font-black flex items-center gap-1 ${
                                isOverdue ? 'text-red-400 animate-pulse' : 'text-white'
                              }`}
                            >
                              {isOverdue && <AlertTriangle size={20} className="text-red-500" />}
                              {formatTime(time.minutes, time.seconds)}
                            </div>
                            <div className="flex items-center gap-1">
                              {order.priority === 'RUSH' && (
                                <span className="px-2.5 py-0.5 rounded bg-red-600 text-white text-xs font-black tracking-wider uppercase animate-bounce">
                                  ACİL
                                </span>
                              )}
                              {order.priority === 'VIP' && (
                                <span className="px-2.5 py-0.5 rounded bg-purple-600 text-white text-xs font-black tracking-wider uppercase">
                                  VIP
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Kalem Listesi (Tıklanabilir Durum Güncellemesi) */}
                        <div className="flex-1 bg-black/30 rounded-lg p-3 space-y-2.5 mb-3 border border-white/5">
                          {selectedStation !== 'ALL' && order.items.length !== visibleItems.length && (
                            <div className="text-xs font-semibold text-slate-400 mb-1">
                              Bu istasyona ait: {visibleItems.length} / {order.items.length} kalem
                            </div>
                          )}

                          {visibleItems.map((item, idx) => {
                            const itStatus = (item.status || 'Pending').toUpperCase();
                            const isItemReady = itStatus === 'READY' || itStatus === 'COMPLETED';
                            const isItemPreparing = itStatus === 'PREPARING';

                            return (
                              <div
                                key={`${order.id}-${item.id || idx}`}
                                onClick={(e) => handleUpdateItemStatus(order.id, item, e)}
                                title="Durumu değiştirmek için tıklayın"
                                className={`flex flex-col border-b border-white/10 pb-2.5 last:border-0 last:pb-0 cursor-pointer rounded p-1.5 transition-colors ${
                                  isItemReady
                                    ? 'bg-emerald-950/40 hover:bg-emerald-900/50'
                                    : isItemPreparing
                                    ? 'bg-blue-950/40 hover:bg-blue-900/50'
                                    : 'hover:bg-white/5'
                                }`}
                              >
                                <div className="flex justify-between items-start">
                                  <div className="flex items-center gap-2 flex-1">
                                    <button
                                      type="button"
                                      className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 border transition-all ${
                                        isItemReady
                                          ? 'bg-emerald-500 border-emerald-400 text-white'
                                          : isItemPreparing
                                          ? 'bg-blue-600 border-blue-400 text-white'
                                          : 'border-slate-500 text-transparent hover:border-slate-300'
                                      }`}
                                    >
                                      {isItemReady ? <Check size={14} strokeWidth={3} /> : <Play size={10} />}
                                    </button>

                                    <span
                                      className={`font-bold text-lg leading-tight ${
                                        isItemReady ? 'line-through text-slate-400' : 'text-white'
                                      }`}
                                    >
                                      <span className="text-amber-400 font-black mr-2">
                                        {item.quantity}x
                                      </span>
                                      {item.name}
                                    </span>
                                  </div>

                                  <div className="flex items-center gap-1 shrink-0 ml-2">
                                    <span className="text-[10px] font-bold text-slate-300 bg-black/40 px-2 py-0.5 rounded uppercase tracking-wider">
                                      {item.station}
                                    </span>
                                    {isItemReady && (
                                      <span className="text-[10px] font-bold text-emerald-300 bg-emerald-950 border border-emerald-600 px-1.5 py-0.5 rounded">
                                        HAZIR
                                      </span>
                                    )}
                                  </div>
                                </div>

                                {item.modifiers && item.modifiers.length > 0 && (
                                  <div className="text-xs font-semibold text-sky-300 mt-1 pl-8">
                                    + {item.modifiers.join(', ')}
                                  </div>
                                )}
                                {item.notes && (
                                  <div className="text-xs font-bold text-amber-300 mt-1 pl-8">
                                    Not: {item.notes}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>

                        {/* Bilet Seviyesi Aksiyon Butonu */}
                        <div className="mt-auto flex justify-between items-center gap-2">
                          <button
                            onClick={() => handleAdvanceStatus(order.id, order.status)}
                            className={`flex-1 flex items-center justify-center gap-2 px-5 py-3 rounded-xl font-black text-base transition-transform active:scale-95 uppercase tracking-wider shadow-md ${
                              colStatusUpper === 'PENDING'
                                ? 'bg-blue-600 hover:bg-blue-500 text-white'
                                : colStatusUpper === 'PREPARING'
                                ? allTicketItemsReady
                                  ? 'bg-emerald-600 hover:bg-emerald-500 text-white ring-2 ring-emerald-400 animate-pulse'
                                  : 'bg-emerald-600 hover:bg-emerald-500 text-white'
                                : 'bg-slate-700 hover:bg-slate-600 text-emerald-300 border border-emerald-500/50'
                            }`}
                          >
                            {colStatusUpper === 'PENDING' ? (
                              <>
                                <Play size={20} /> BAŞLA
                              </>
                            ) : colStatusUpper === 'PREPARING' ? (
                              <>
                                <CheckCircle size={20} /> HAZIR
                              </>
                            ) : (
                              <>
                                <CheckCheck size={20} /> SERVİS EDİLDİ
                              </>
                            )}
                          </button>
                        </div>
                      </div>
                    );
                  })}

                  {columnOrders.length === 0 && (
                    <div className="h-44 flex flex-col items-center justify-center border-2 border-dashed border-slate-800 rounded-2xl text-slate-500 bg-slate-900/20">
                      <ChefHat size={36} className="mb-2 opacity-30" />
                      <span className="font-bold text-sm tracking-widest uppercase text-slate-500">
                        Sipariş Yok
                      </span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
