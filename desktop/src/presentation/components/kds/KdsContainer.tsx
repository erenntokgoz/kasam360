import { useEffect, useState, useCallback, useRef } from 'react';
import {
  ChefHat,
  CheckCircle,
  Play,
  Bell,
  BellOff,
  RefreshCw,
  WifiOff,
  CheckCheck,
  Utensils,
  Check,
  Undo2,
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
import { TicketTimer } from './ui/TicketTimer';
import { LiveClock } from './ui/LiveClock';

// --- Çevrimdışı Kuyruk Yardımcıları ---
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

// --- Ses Bildirim Yardımcıları ---
const MUTE_KEY = 'kds_sound_muted';

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  try {
    const AudioCtxClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtxClass) return null;
    if (!audioCtx || audioCtx.state === 'closed') {
      audioCtx = new AudioCtxClass();
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
    }
    return audioCtx;
  } catch (e) {
    console.warn('AudioContext kullanılamıyor:', e);
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
    console.warn('Ses bildirimi çalınamadı:', e);
  }
}

function playChime(freqs: number[], durationPerTone = 0.18): void {
  freqs.forEach((freq, idx) => {
    setTimeout(() => {
      playBeep(freq, durationPerTone, 0.25);
    }, idx * (durationPerTone * 1000 * 0.85));
  });
}

// Masa numarasını temiz formatlama yardımcısı ("Masa: Masa 4" tekrarını önler)
function formatTableLabel(tableNumber?: string | number): string {
  if (!tableNumber) return 'PAKET';
  const str = String(tableNumber).trim();
  if (/^masa/i.test(str)) return str;
  return `Masa ${str}`;
}

// --- Apple Spatial Neon Hairline ve Kart Stilleri ---
function getTicketSpatialStyle(status: KitchenTicketStatus, elapsedMinutesOrCreatedAt: number | string = 0) {
  const elapsedMinutes = typeof elapsedMinutesOrCreatedAt === 'string'
    ? Math.floor(Math.max(0, Date.now() - new Date(elapsedMinutesOrCreatedAt).getTime()) / 60000)
    : elapsedMinutesOrCreatedAt;
  const s = (status || '').toUpperCase();
  const isPendingOverdue = s === 'PENDING' && elapsedMinutes >= 15;
  const isPrepOverdue = s === 'PREPARING' && elapsedMinutes >= 20;
  const isReadyOverdue = s === 'READY' && elapsedMinutes >= 25;

  if (isPendingOverdue || isPrepOverdue || isReadyOverdue) {
    return {
      card: 'dark:bg-rose-950/25 bg-rose-500/10 border-rose-500/50 shadow-lg dark:shadow-[0_8px_32px_rgba(0,0,0,0.5),0_0_20px_rgba(244,63,94,0.22)] ring-1 ring-rose-500/30 before:bg-rose-400/30',
      timeText: 'text-rose-500 dark:text-rose-400 font-bold animate-pulse',
      isOverdue: true,
    };
  }

  if (s === 'PENDING') {
    const isWarning = elapsedMinutes >= 10;
    return {
      card: isWarning
        ? 'dark:bg-amber-950/25 bg-amber-500/10 border-amber-500/40 shadow-lg ring-1 ring-amber-500/30 before:bg-amber-400/40'
        : 'dark:bg-white/[0.04] bg-white/80 border-amber-500/30 shadow-md hover:border-amber-500/50 before:bg-amber-400/25',
      timeText: isWarning ? 'text-amber-500 dark:text-amber-400 font-semibold' : 'dark:text-white/90 text-zinc-800',
      isOverdue: false,
    };
  }

  if (s === 'PREPARING') {
    return {
      card: 'dark:bg-blue-950/25 bg-blue-500/10 border-[#007AFF]/40 shadow-lg hover:border-[#007AFF]/60 ring-1 ring-[#007AFF]/20 before:bg-[#007AFF]/35',
      timeText: 'text-[#007AFF] dark:text-white/90 font-semibold',
      isOverdue: false,
    };
  }

  if (s === 'READY') {
    return {
      card: 'dark:bg-emerald-950/25 bg-emerald-500/10 border-emerald-500/40 shadow-lg hover:border-emerald-500/60 ring-1 ring-emerald-500/20 before:bg-emerald-400/35',
      timeText: 'text-emerald-600 dark:text-emerald-400 font-semibold',
      isOverdue: false,
    };
  }

  return {
    card: 'dark:bg-white/[0.04] bg-white/80 dark:border-white/[0.08] border-black/10 shadow-md before:bg-white/20',
    timeText: 'dark:text-white/70 text-zinc-600',
    isOverdue: false,
  };
}

// --- Ana KDS Bileşeni ---
export function KdsContainer(): JSX.Element {
  const [orders, setOrders] = useState<KdsOrder[]>([]);
  const [selectedStation, setSelectedStation] = useState<KdsStationFilter | 'ALL'>('ALL');
  const [stations, setStations] = useState<KdsStationDto[]>([]);
  const [muted, setMuted] = useState<boolean>(() => localStorage.getItem(MUTE_KEY) === 'true');
  const [queueCount, setQueueCount] = useState<number>(() => readQueue().length);
  const [isOnline, setIsOnline] = useState<boolean>(() => (typeof navigator !== 'undefined' ? navigator.onLine : true));
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [serviceReadyNotice, setServiceReadyNotice] = useState<string | null>(null);
  const [lastBumpedOrder, setLastBumpedOrder] = useState<{
    order: KdsOrder;
    previousStatus: KitchenTicketStatus;
  } | null>(null);

  const prevOrdersRef = useRef<Map<string, string>>(new Map());
  const isInitialLoadRef = useRef<boolean>(true);
  const isSyncingRef = useRef<boolean>(false);

  const refreshQueueCount = useCallback(() => {
    setQueueCount(readQueue().length);
  }, []);

  const fetchTicketsRef = useRef<() => Promise<void>>(async () => {});

  // Çevrimdışı kuyruğu işleme ve sunucuya iletme
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
        console.warn('Çevrimdışı işlem başarısız oldu, kuyrukta bekletiliyor:', err);
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

  // İstasyon listesini çekme
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
      console.error('İstasyonlar alınamadı:', err);
      setStations([
        { id: 'st_sicak', name: 'Sıcak' },
        { id: 'st_soguk', name: 'Soğuk' },
        { id: 'st_icecek', name: 'İçecek' },
        { id: 'st_izgara', name: 'Izgara' },
        { id: 'st_tatli', name: 'Tatlı' },
      ]);
    }
  }, []);

  // Aktif biletleri çekme ve ses bildirimlerini yönetme
  const fetchTickets: () => Promise<void> = useCallback(async () => {
    try {
      const result = await invoke<KdsOrder[]>('get_active_tickets');
      const safeResult = Array.isArray(result) ? result : [];

      if (!muted) {
        if (!isInitialLoadRef.current) {
          safeResult.forEach((order) => {
            const prevStatus = prevOrdersRef.current.get(order.id);
            if (!prevStatus) {
              // Yeni sipariş geldiğinde çift ses tonu
              playChime([880, 1175], 0.2);
            } else {
              const pUp = prevStatus.toUpperCase();
              const curUp = (order.status || '').toUpperCase();
              if (pUp !== 'READY' && curUp === 'READY') {
                // Sipariş servise hazır olduğunda başarı tonu
                playChime([1046, 1318], 0.25);
              }
            }
          });
        }
      }

      isInitialLoadRef.current = false;
      prevOrdersRef.current = new Map(safeResult.map((o) => [o.id, o.status]));
      setOrders(safeResult);

      if (typeof navigator !== 'undefined' && navigator.onLine) {
        await processOfflineQueue();
      }
    } catch (err) {
      console.error('Aktif biletler alınamadı:', err);
    }
  }, [muted, processOfflineQueue]);

  useEffect(() => {
    fetchTicketsRef.current = fetchTickets;
  }, [fetchTickets]);

  // Çevrimdışı ve çevrimiçi ağ dinleyicileri
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

  // Periyodik bilet yoklaması (Polling)
  useEffect(() => {
    fetchStations();
    fetchTickets();
    const interval = setInterval(fetchTickets, 3000);
    return () => clearInterval(interval);
  }, [fetchTickets, fetchStations]);

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

  // Bilet durumunu ilerletme (PENDING -> PREPARING -> READY -> SERVED)
  const handleAdvanceStatus = async (orderId: string, currentStatus: KitchenTicketStatus) => {
    getAudioContext();
    const norm = (currentStatus || 'Pending').toUpperCase();
    let nextStatus: KitchenTicketStatus | undefined;

    if (norm === 'PENDING') nextStatus = 'Preparing';
    else if (norm === 'PREPARING') nextStatus = 'Ready';
    else if (norm === 'READY') nextStatus = 'SERVED';

    if (!nextStatus) return;

    const orderObj = orders.find((o) => o.id === orderId);
    const tableLabel = formatTableLabel(orderObj?.tableNumber);

    if (orderObj) {
      setLastBumpedOrder({ order: orderObj, previousStatus: currentStatus });
    }

    const payload = {
      orderId,
      fromStatus: currentStatus,
      toStatus: nextStatus,
      timestamp: new Date().toISOString(),
      actorId: 'system',
      actorRole: 'Kitchen',
    };

    if (nextStatus === 'Ready') {
      if (!muted) playChime([1046, 1318], 0.25);
      setServiceReadyNotice(`${tableLabel} (#${orderObj?.orderNumber}) servise hazır!`);
      setTimeout(() => setServiceReadyNotice(null), 5000);
    }

    // Anlık iyimser UI güncellemesi (Apple HIG akıcılığı)
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
                    : nextStatus === 'Preparing' && (it.status || '').toUpperCase() === 'PENDING'
                    ? { ...it, status: 'Preparing' as KitchenTicketStatus }
                    : nextStatus === 'SERVED'
                    ? { ...it, status: 'Completed' as KitchenTicketStatus }
                    : it
                ),
              }
            : o
        )
        .filter((o) => (nextStatus === 'SERVED' ? o.id !== orderId : true))
    );

    try {
      await invoke('kds_update_ticket_status', { payload });
      await fetchTickets();
    } catch (err) {
      console.warn('Bilet durumu güncellenemedi, kuyruğa alınıyor:', err);
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
    }
  };

  // Son tamamlanan veya ilerletilen bileti geri alma (Undo)
  const handleUndo = async () => {
    if (!lastBumpedOrder) return;
    const { order, previousStatus } = lastBumpedOrder;
    try {
      await invoke('kds_update_ticket_status', {
        payload: {
          orderId: order.id,
          fromStatus: order.status,
          toStatus: previousStatus,
          timestamp: new Date().toISOString(),
          actorId: 'system',
          actorRole: 'Kitchen',
        },
      });
      await fetchTickets();
    } catch (err) {
      console.warn('Geri alma işlemi başarısız oldu:', err);
    }

    setOrders((prev) => {
      const exists = prev.some((o) => o.id === order.id);
      if (exists) {
        return prev.map((o) => (o.id === order.id ? { ...o, status: previousStatus } : o));
      } else {
        return [{ ...order, status: previousStatus }, ...prev];
      }
    });
    setLastBumpedOrder(null);
  };

  // Kalem bazlı durum güncellemesi (update_kds_item_status)
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

    // İyimser UI güncellemesi: Kalem ve bilet durumunu eşzamanlı güncelle
    setOrders((prev) =>
      prev.map((ord) => {
        if (ord.id !== orderId) return ord;
        const updatedItems = ord.items.map((it) =>
          it.id === item.id ? { ...it, status: nextItemStatus } : it
        );
        const allReady =
          updatedItems.length > 0 &&
          updatedItems.every((it) => {
            const s = (it.status || '').toUpperCase();
            return s === 'READY' || s === 'COMPLETED' || s === 'SERVED';
          });
        const anyPreparing = updatedItems.some(
          (it) => (it.status || '').toUpperCase() === 'PREPARING'
        );
        let derivedStatus = ord.status;
        if (allReady) {
          derivedStatus = 'Ready' as KitchenTicketStatus;
        } else if ((ord.status || '').toUpperCase() === 'READY') {
          derivedStatus = 'Preparing' as KitchenTicketStatus;
        } else if (anyPreparing && (ord.status || '').toUpperCase() === 'PENDING') {
          derivedStatus = 'Preparing' as KitchenTicketStatus;
        }
        return {
          ...ord,
          status: derivedStatus,
          items: updatedItems,
        };
      })
    );

    try {
      await invoke('update_kds_item_status', {
        payload: {
          itemId: item.id,
          status: nextItemStatus,
        },
      });
      await fetchTickets();
    } catch (err) {
      console.warn('Kalem durumu güncellenemedi, kuyruğa alınıyor:', err);
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
    }
  };

  // İstasyon eşleştirme yardımcısı
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

  // Kısayol tuşları (Bump bar ve klavye)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName)) return;

      if (e.key === 'u' || e.key === 'U') {
        e.preventDefault();
        handleUndo();
        return;
      }
      if (e.key === 'm' || e.key === 'M') {
        e.preventDefault();
        toggleMute();
        return;
      }
      if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault();
        const firstPending = filteredOrders.find(
          (o) => (o.status || '').toUpperCase() === 'PENDING'
        );
        if (firstPending) {
          handleAdvanceStatus(firstPending.id, firstPending.status);
          return;
        }
        const firstPrep = filteredOrders.find(
          (o) => (o.status || '').toUpperCase() === 'PREPARING'
        );
        if (firstPrep) {
          handleAdvanceStatus(firstPrep.id, firstPrep.status);
          return;
        }
      }
      const num = parseInt(e.key, 10);
      if (!isNaN(num) && num >= 1 && num <= 8) {
        const activeOrders = filteredOrders.filter(
          (o) => (o.status || '').toUpperCase() !== 'SERVED'
        );
        const targetOrder = activeOrders[num - 1];
        if (targetOrder) {
          e.preventDefault();
          handleAdvanceStatus(targetOrder.id, targetOrder.status);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [filteredOrders, lastBumpedOrder, muted]);

  return (
    <div className="flex h-full w-full flex-col bg-transparent dark:text-white text-zinc-900 p-4 sm:p-5 overflow-hidden select-none">
      {/* Servis Hazır Bildirim Kapsülü (VisionOS Dynamic Island Tarzı) */}
      {serviceReadyNotice && (
        <div className="mb-3 flex items-center justify-between gap-3 bg-[#34C759]/15 border border-[#34C759]/30 dark:text-emerald-200 text-emerald-800 px-5 py-2.5 rounded-2xl shadow-2xl backdrop-blur-2xl animate-in fade-in slide-in-from-top-2 duration-200 shrink-0">
          <div className="flex items-center gap-2.5 font-semibold text-sm">
            <Utensils size={18} className="text-[#34C759]" />
            <span>{serviceReadyNotice}</span>
          </div>
          <button
            onClick={() => setServiceReadyNotice(null)}
            className="text-emerald-700 dark:text-emerald-300 hover:text-emerald-950 hover:dark:text-white font-medium text-xs bg-black/[0.05] dark:bg-white/[0.08] hover:bg-black/[0.1] hover:dark:bg-white/[0.15] px-3 py-1 rounded-full transition-colors cursor-pointer"
          >
            Tamam
          </button>
        </div>
      )}

      {/* Apple Spatial Glass Üst Kontrol Çubuğu */}
      <div className="flex items-center justify-between mb-4 shrink-0 dark:bg-white/[0.04] bg-white/75 backdrop-blur-2xl p-3 rounded-2xl border dark:border-white/10 border-black/10 shadow-sm dark:shadow-2xl">
        <div className="flex items-center gap-3.5">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-2xl dark:bg-white/[0.06] bg-black/[0.05] border dark:border-white/10 border-black/10 flex items-center justify-center dark:text-white text-zinc-900 shadow-inner">
              <ChefHat size={20} />
            </div>
            <div>
              <h2 className="text-base font-semibold dark:text-white text-zinc-900 tracking-tight leading-tight">MUTFAK KDS</h2>
            </div>
          </div>

          {/* Ağ Durumu */}
          {!isOnline && (
            <span className="flex items-center gap-1.5 bg-[#FF3B30]/15 text-[#FF3B30] border border-[#FF3B30]/30 text-xs font-semibold px-2.5 py-1 rounded-full">
              <WifiOff size={13} /> Çevrimdışı
            </span>
          )}

          {/* Çevrimdışı Kuyruk Durumu */}
          {queueCount > 0 && (
            <button
              onClick={processOfflineQueue}
              disabled={isSyncing}
              className="flex items-center gap-1.5 bg-[#FF9500]/15 hover:bg-[#FF9500]/25 text-[#FF9500] border border-[#FF9500]/30 text-xs font-semibold px-2.5 py-1 rounded-full transition-all cursor-pointer"
            >
              <RefreshCw size={13} className={isSyncing ? 'animate-spin' : ''} />
              <span>{queueCount} Kuyrukta</span>
            </button>
          )}
        </div>

        <div className="flex items-center gap-2.5">
          {/* İstasyon Filtreleme Segmentleri (iOS Pill Bar) */}
          <div className="flex items-center gap-1 dark:bg-black/40 bg-black/[0.04] p-1 rounded-full border dark:border-white/10 border-black/10 backdrop-blur-md">
            <button
              type="button"
              onClick={() => setSelectedStation('ALL')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all touch-manipulation cursor-pointer ${
                selectedStation === 'ALL'
                  ? 'dark:bg-white/[0.15] bg-white text-[#007AFF] dark:text-white shadow-sm font-bold'
                  : 'dark:text-white/60 text-zinc-600 hover:dark:text-white hover:text-zinc-900 hover:dark:bg-white/[0.04] hover:bg-black/[0.04]'
              }`}
            >
              TÜMÜ
            </button>
            {stations
              .filter((st) => st.id.toUpperCase() !== 'ALL')
              .map((st) => (
                <button
                  key={st.id}
                  type="button"
                  onClick={() => setSelectedStation(st.id as KdsStationFilter)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all touch-manipulation cursor-pointer ${
                    selectedStation === st.id
                      ? 'bg-white/[0.15] text-white shadow-sm font-bold'
                      : 'text-white/60 hover:text-white hover:bg-white/[0.04]'
                  }`}
                >
                  {st.name}
                </button>
              ))}
          </div>

          {/* Geri Al (Undo Buffer) */}
          {lastBumpedOrder && (
            <button
              type="button"
              onClick={handleUndo}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/[0.08] hover:bg-white/[0.14] text-white border border-white/10 text-xs font-semibold transition-all cursor-pointer active:scale-95"
            >
              <Undo2 size={14} />
              <span>Geri Al (#{lastBumpedOrder.order.orderNumber})</span>
            </button>
          )}

          {/* Ses Kontrolü */}
          <button
            onClick={toggleMute}
            className={`flex items-center justify-center w-9 h-9 rounded-xl border transition-all cursor-pointer active:scale-95 ${
              muted
                ? 'bg-white/[0.04] border-white/[0.08] text-white/40 hover:text-white'
                : 'bg-amber-500/15 border-amber-500/30 text-amber-300 hover:bg-amber-500/25'
            }`}
          >
            {muted ? <BellOff size={16} /> : <Bell size={16} />}
          </button>

          {/* Saat */}
          <LiveClock />
        </div>
      </div>

      {/* Kanban Sütunları */}
      <div className="flex-1 overflow-x-auto no-scrollbar">
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

            const statusDotColor =
              colStatusUpper === 'PENDING'
                ? 'bg-amber-400 shadow-[0_0_8px_rgba(245,158,11,0.6)]'
                : colStatusUpper === 'PREPARING'
                ? 'bg-[#007AFF] shadow-[0_0_8px_rgba(0,122,255,0.6)]'
                : 'bg-[#34C759] shadow-[0_0_8px_rgba(52,199,89,0.6)]';

            return (
              <div
                key={colStatus}
                className="flex flex-col w-[380px] min-w-[340px] max-w-[540px] flex-1 max-h-full dark:bg-black/20 bg-white/60 backdrop-blur-xl rounded-3xl border dark:border-white/[0.08] border-black/10 p-3 shadow-md dark:shadow-2xl"
              >
                {/* Sütun Başlığı */}
                <div className="flex justify-between items-center mb-3 px-2 py-1 shrink-0">
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${statusDotColor}`} />
                    <h3 className="text-xs font-bold tracking-wider dark:text-white/90 text-zinc-900 uppercase">
                      {columnTitle}
                    </h3>
                  </div>
                  <span className="dark:bg-white/[0.06] bg-black/[0.05] dark:text-white/90 text-zinc-800 px-2.5 py-0.5 rounded-full font-semibold text-xs border dark:border-white/[0.08] border-black/10">
                    {columnOrders.length}
                  </span>
                </div>

                {/* Bilet Listesi */}
                <div className="flex flex-col gap-3 overflow-y-auto pr-1 flex-1 pb-2">
                  {columnOrders.map((order) => {
                    const style = getTicketSpatialStyle(order.status, order.createdAt);

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
                        className={`relative flex flex-col rounded-2xl border p-4 transition-all shrink-0 backdrop-blur-xl overflow-hidden before:absolute before:inset-x-0 before:top-0 before:h-px before:bg-gradient-to-r before:from-transparent before:to-transparent ${style.card}`}
                      >
                        {/* Bilet Başlığı (Masa No, Fiş No, Süre) */}
                        <div className="flex justify-between items-start mb-3">
                          <div className="flex flex-col gap-0.5">
                            <div className="font-extrabold text-2xl dark:text-white text-zinc-900 tracking-tight">
                              #{order.orderNumber}
                            </div>
                            <div className="dark:text-white/80 text-zinc-700 font-semibold text-sm">
                              {formatTableLabel(order.tableNumber)}
                            </div>
                          </div>

                          <div className="flex flex-col items-end gap-1">
                            <TicketTimer
                              createdAt={order.createdAt}
                              status={order.status}
                              priority={order.priority}
                            />
                            <div className="flex items-center gap-1">
                              {order.priority === 'RUSH' && (
                                <span className="px-2 py-0.5 rounded-md bg-rose-500/20 text-rose-500 dark:text-rose-300 border border-rose-500/40 text-[10px] font-bold uppercase tracking-wider">
                                  ACİL
                                </span>
                              )}
                              {order.priority === 'VIP' && (
                                <span className="px-2 py-0.5 rounded-md bg-purple-500/20 text-purple-600 dark:text-purple-300 border border-purple-500/40 text-[10px] font-bold uppercase tracking-wider">
                                  VIP
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Kalem Listesi (Apple HIG Minimalist Çizgiler ve Sınırlandırılmış Kaydırma) */}
                        <div className="flex-1 max-h-[300px] overflow-y-auto pr-1 dark:bg-black/30 bg-black/[0.03] rounded-xl p-2.5 space-y-1 mb-3 border dark:border-white/[0.04] border-black/5">
                          {visibleItems.map((item, idx) => {
                            const itStatus = (item.status || 'Pending').toUpperCase();
                            const isItemReady = itStatus === 'READY' || itStatus === 'COMPLETED';
                            const isItemPreparing = itStatus === 'PREPARING';

                            return (
                              <div
                                key={`${order.id}-${item.id || idx}`}
                                onClick={(e) => handleUpdateItemStatus(order.id, item, e)}
                                className={`flex flex-col border-b border-white/[0.05] pb-2 last:border-0 last:pb-0 cursor-pointer rounded-lg p-1.5 transition-all select-none active:scale-[0.99] ${
                                  isItemReady
                                    ? 'bg-emerald-500/[0.08] hover:bg-emerald-500/[0.12]'
                                    : isItemPreparing
                                    ? 'bg-[#007AFF]/[0.08] hover:bg-[#007AFF]/[0.12]'
                                    : 'hover:bg-white/[0.04]'
                                }`}
                              >
                                <div className="flex justify-between items-start gap-2">
                                  <div className="flex items-center gap-2.5 flex-1 min-w-0">
                                    {/* Durum Gösterge Dairesi */}
                                    <div
                                      className={`w-7 h-7 min-w-[28px] min-h-[28px] rounded-full flex items-center justify-center shrink-0 border transition-all ${
                                        isItemReady
                                          ? 'bg-[#34C759] border-[#34C759] text-white shadow-sm'
                                          : isItemPreparing
                                          ? 'bg-[#007AFF] border-[#007AFF] text-white'
                                          : 'border-white/20 bg-white/[0.02] text-transparent hover:border-white/40'
                                      }`}
                                    >
                                      {isItemReady ? <Check size={14} strokeWidth={3} /> : <Play size={11} />}
                                    </div>

                                    <div className="min-w-0 flex-1">
                                      <span
                                        className={`font-semibold text-sm leading-snug break-words ${
                                          isItemReady ? 'line-through text-white/40' : 'text-white'
                                        }`}
                                      >
                                        <span className="text-amber-400 font-bold mr-1.5">
                                          {item.quantity}x
                                        </span>
                                        {item.name}
                                      </span>
                                    </div>
                                  </div>

                                  <div className="flex items-center gap-1 shrink-0">
                                    {item.station && (
                                      <span className="text-[10px] font-medium text-white/50 bg-white/[0.05] px-1.5 py-0.5 rounded uppercase">
                                        {item.station}
                                      </span>
                                    )}
                                  </div>
                                </div>

                                {item.modifiers && item.modifiers.length > 0 && (
                                  <div className="text-xs font-medium text-sky-400/90 pl-9 mt-0.5">
                                    + {item.modifiers.join(', ')}
                                  </div>
                                )}
                                {item.notes && (
                                  <div className="text-xs font-semibold text-amber-300/90 pl-9 mt-0.5">
                                    Not: {item.notes}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>

                        {/* Bilet Aksiyon Butonu */}
                        <div className="mt-auto">
                          <button
                            type="button"
                            onClick={() => handleAdvanceStatus(order.id, order.status)}
                            className={`w-full h-12 flex items-center justify-center gap-2 px-4 rounded-xl font-bold text-sm tracking-wide transition-all active:scale-[0.98] uppercase touch-manipulation cursor-pointer ${
                              colStatusUpper === 'PENDING'
                                ? 'bg-[#007AFF] hover:bg-[#0071E3] text-white shadow-lg shadow-[#007AFF]/25'
                                : colStatusUpper === 'PREPARING'
                                ? allTicketItemsReady
                                  ? 'bg-[#34C759] hover:bg-[#30B74E] text-white shadow-lg shadow-[#34C759]/25 ring-2 ring-emerald-400/50 animate-pulse'
                                  : 'bg-[#34C759] hover:bg-[#30B74E] text-white shadow-lg shadow-[#34C759]/25'
                                : 'bg-[#34C759]/20 hover:bg-[#34C759]/30 text-[#34C759] border border-[#34C759]/40 shadow-lg'
                            }`}
                          >
                            {colStatusUpper === 'PENDING' ? (
                              <>
                                <Play size={18} /> BAŞLA
                              </>
                            ) : colStatusUpper === 'PREPARING' ? (
                              <>
                                <CheckCircle size={18} /> HAZIR
                              </>
                            ) : (
                              <>
                                <CheckCheck size={18} /> SERVİS EDİLDİ
                              </>
                            )}
                          </button>
                        </div>
                      </div>
                    );
                  })}

                  {columnOrders.length === 0 && (
                    <div className="h-36 flex flex-col items-center justify-center border border-dashed border-white/[0.08] rounded-2xl text-white/30 bg-white/[0.01]">
                      <ChefHat size={28} className="mb-1.5 opacity-25" />
                      <span className="font-semibold text-xs tracking-wider uppercase text-white/40">
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
