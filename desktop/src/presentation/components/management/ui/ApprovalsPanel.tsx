import { useEffect, useState, useCallback } from 'react';
import { tauriInvoke as invoke } from '../../../../data/ipc/tauriInvoke';
import { toast as useToast } from '@core/components/ui/toast';
import { 
  ShieldCheck, 
  CheckCircle2, 
  XCircle, 
  Lock, 
  X, 
  Clock, 
  User, 
  Info,
  RefreshCw
} from 'lucide-react';

interface ApprovalDto {
  id: string;
  request_type: string;
  resource_id: string;
  requester_id: string;
  status: string;
  approver_id: string | null;
  payload: string;
  created_at: string;
  resolved_at: string | null;
}

// Apple Borsa / Sağlık tarzı mini trend çizgi grafiği
function MetricMiniLine({ color }: { color: string }) {
  return (
    <div className="h-6 w-16 overflow-hidden">
      <svg className="w-full h-full" viewBox="0 0 50 16">
        <path
          d="M 0,12 Q 15,2 25,10 T 50,4"
          fill="none"
          stroke={color}
          strokeWidth="1.75"
          strokeLinecap="round"
        />
      </svg>
    </div>
  );
}

export function ApprovalsPanel() {
  const [approvals, setApprovals] = useState<ApprovalDto[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  
  // PIN Giriş Dialog Durumu
  const [activeApproval, setActiveApproval] = useState<ApprovalDto | null>(null);
  const [pendingAction, setPendingAction] = useState<'APPROVE' | 'REJECT'>('APPROVE');
  const [managerPin, setManagerPin] = useState('');
  const [isPinModalOpen, setIsPinModalOpen] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);

  // Detay Dialog Durumu
  const [detailApproval, setDetailApproval] = useState<ApprovalDto | null>(null);

  const addToast = (msg: string, type: 'success' | 'error' | 'info') => useToast.add({ title: msg, type });

  // Bekleyen onay taleplerini çek
  const fetchApprovals = useCallback(async (showLoader = false) => {
    if (showLoader) setIsRefreshing(true);
    try {
      const data = await invoke<ApprovalDto[]>('get_pending_approvals');
      setApprovals(data || []);
    } catch (error) {
      console.error('Onay verisi yükleme hatası:', error);
      addToast('Onay talepleri yüklenemedi.', 'error');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchApprovals();
  }, [fetchApprovals]);

  // Escape tuşuna basıldığında açık onay veya PIN modalını kapat
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isPinModalOpen) setIsPinModalOpen(false);
        if (detailApproval) setDetailApproval(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isPinModalOpen, detailApproval]);

  const openPinModal = (approval: ApprovalDto, action: 'APPROVE' | 'REJECT') => {
    setActiveApproval(approval);
    setPendingAction(action);
    setManagerPin('');
    setPinError(null);
    setIsPinModalOpen(true);
  };

  // Müdür PIN doğrulamasıyla talebi onayla veya reddet
  const handleProcessSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeApproval) return;
    if (!managerPin || managerPin.length < 4 || managerPin.length > 8) {
      setPinError('Geçerli bir PIN giriniz.');
      return;
    }

    setIsProcessing(true);
    setPinError(null);
    try {
      await invoke('process_approval', {
        approvalId: activeApproval.id,
        managerPin: managerPin,
        action: pendingAction,
      });

      addToast(
        `İşlem ${pendingAction === 'APPROVE' ? 'onaylandı' : 'reddedildi'}.`,
        'success'
      );
      setIsPinModalOpen(false);
      setActiveApproval(null);
      await fetchApprovals(false);
    } catch (error) {
      console.error('Onay işleme hatası:', error);
      setPinError(String(error) || 'Yetkisiz işlem veya geçersiz PIN.');
      // Apple HIG dialog standardı: Hatalı PIN denemesinde alanı temizle
      setManagerPin('');
    } finally {
      setIsProcessing(false);
    }
  };

  if (isLoading) {
    return <div className="p-8 text-center text-xs text-zinc-500">Yükleniyor...</div>;
  }

  return (
    <div className="flex flex-col h-full space-y-5 dark:text-zinc-100 text-zinc-900 max-w-7xl mx-auto pb-12 select-none">
      {/* Üst Başlık & Yenile Butonu */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShieldCheck size={20} className="text-amber-400" />
          <h2 className="text-xl font-semibold tracking-tight dark:text-white text-zinc-900">Onaylar & Yetkilendirme</h2>
        </div>

        <button
          onClick={() => fetchApprovals(true)}
          disabled={isRefreshing}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-white/[0.04] hover:bg-white/[0.08] border border-white/5 rounded-xl text-xs font-medium text-zinc-300 transition-all disabled:opacity-50"
        >
          <RefreshCw size={13} className={isRefreshing ? 'animate-spin text-amber-400' : ''} />
          <span>Yenile</span>
        </button>
      </div>

      {/* Apple Sağlık / Borsa Tarzı Metrik Kartları */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="bg-white/[0.03] hover:bg-white/[0.05] border border-white/5 rounded-2xl p-5 transition-all">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium uppercase tracking-wider text-zinc-400">
              Bekleyen Onaylar
            </span>
            <MetricMiniLine color="#f59e0b" />
          </div>
          <div className="text-3xl font-semibold tracking-tight text-amber-400 mt-3">
            {approvals.length}
          </div>
        </div>

        <div className="bg-white/[0.03] hover:bg-white/[0.05] border border-white/5 rounded-2xl p-5 transition-all">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium uppercase tracking-wider text-zinc-400">
              Durum
            </span>
            <MetricMiniLine color="#34d399" />
          </div>
          <div className="text-sm font-medium text-emerald-400 mt-4 flex items-center gap-1.5">
            <CheckCircle2 size={15} />
            <span>Onay kuyruğu etkin</span>
          </div>
        </div>
      </div>

      {/* Bekleyen Onay Talepleri Listesi (1px white/5 ayırıcılar & ferah satırlar) */}
      <div className="flex-1 overflow-y-auto">
        {approvals.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 space-y-2 p-8 text-center bg-white/[0.02] rounded-2xl border border-white/5">
            <div className="w-10 h-10 rounded-full bg-emerald-500/10 text-emerald-400 flex items-center justify-center">
              <CheckCircle2 size={20} />
            </div>
            <h4 className="text-sm font-semibold text-white">Bekleyen Onay Yok</h4>
          </div>
        ) : (
          <div className="bg-white/[0.02] border border-white/5 rounded-2xl divide-y divide-white/5 overflow-hidden">
            {approvals.map(approval => (
              <div
                key={approval.id}
                onClick={() => setDetailApproval(approval)}
                className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-white/[0.03] cursor-pointer transition-colors"
              >
                <div className="space-y-1.5 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="bg-amber-500/10 text-amber-400 border border-amber-500/20 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider">
                      {approval.request_type}
                    </span>
                    <span className="text-[11px] text-zinc-500 flex items-center gap-1">
                      <Clock size={11} />
                      {new Date(approval.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>

                  <div className="flex items-center gap-3 text-xs">
                    <span className="font-semibold text-white">Kaynak: {approval.resource_id}</span>
                    <span className="text-zinc-500">•</span>
                    <span className="text-zinc-400 flex items-center gap-1">
                      <User size={12} className="text-zinc-500" />
                      {approval.requester_id}
                    </span>
                  </div>

                  <p className="text-xs text-zinc-400 line-clamp-1">
                    {approval.payload}
                  </p>
                </div>

                <div 
                  className="flex items-center gap-2 shrink-0"
                  onClick={e => e.stopPropagation()}
                >
                  <button
                    onClick={() => openPinModal(approval, 'REJECT')}
                    className="flex items-center gap-1 px-3 py-1.5 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-300 rounded-xl text-xs font-medium transition-colors"
                  >
                    <XCircle size={13} />
                    <span>Reddet</span>
                  </button>
                  <button
                    onClick={() => openPinModal(approval, 'APPROVE')}
                    className="flex items-center gap-1 px-3.5 py-1.5 bg-white hover:bg-zinc-200 text-black rounded-xl text-xs font-semibold transition-colors shadow-sm"
                  >
                    <CheckCircle2 size={13} />
                    <span>Onayla</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* iOS Dialog 1: Müdür Yetkilendirme / PIN Doğrulama */}
      {isPinModalOpen && activeApproval && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 dark:bg-black/70 backdrop-blur-md p-4 animate-in fade-in duration-150">
          <div className="w-full max-w-sm backdrop-blur-2xl dark:bg-[#121318]/90 bg-white/95 border dark:border-white/10 border-black/[0.08] rounded-3xl p-6 text-center shadow-2xl space-y-4 dark:text-zinc-100 text-zinc-900 animate-in zoom-in-95 duration-150">
            <div className={`w-12 h-12 rounded-full mx-auto flex items-center justify-center ${
              pendingAction === 'APPROVE'
                ? 'bg-emerald-500/15 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400'
                : 'bg-red-500/15 border border-red-500/30 text-red-600 dark:text-red-400'
            }`}>
              <Lock size={20} />
            </div>

            <div>
              <h3 className="text-base font-bold dark:text-white text-zinc-900">Müdür Yetkilendirmesi</h3>
              <p className="text-xs dark:text-zinc-400 text-zinc-600 mt-1">
                {pendingAction === 'APPROVE' ? 'Talebi onaylamak için PIN girin' : 'Talebi reddetmek için PIN girin'}
              </p>
            </div>

            <div className="backdrop-blur-md dark:bg-white/[0.04] bg-black/[0.03] rounded-2xl p-3.5 border dark:border-white/10 border-black/[0.08] text-xs text-left space-y-1">
              <div className="flex justify-between">
                <span className="dark:text-zinc-400 text-zinc-500">Talep:</span>
                <span className="font-semibold dark:text-white text-zinc-900">{activeApproval.request_type}</span>
              </div>
              <div className="flex justify-between">
                <span className="dark:text-zinc-400 text-zinc-500">Kaynak:</span>
                <span className="font-mono dark:text-zinc-300 text-zinc-700">{activeApproval.resource_id}</span>
              </div>
            </div>

            <form onSubmit={handleProcessSubmit} className="space-y-4">
              <div>
                <input
                  type="password"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={8}
                  autoFocus
                  required
                  placeholder="••••"
                  value={managerPin}
                  onChange={e => setManagerPin(e.target.value.replace(/\D/g, ''))}
                  className="w-full py-3 backdrop-blur-md dark:bg-white/[0.05] bg-black/[0.03] border dark:border-white/10 border-black/[0.08] rounded-2xl dark:text-white text-zinc-900 font-mono tracking-[0.5em] text-center text-2xl focus:outline-none focus:ring-1 focus:ring-[#007AFF]"
                />
              </div>

              {pinError && (
                <div className="p-2.5 bg-red-500/10 border border-red-500/20 rounded-xl text-xs text-red-600 dark:text-red-300 text-center">
                  {pinError}
                </div>
              )}

              <div className="flex gap-2 w-full pt-1">
                <button
                  type="button"
                  onClick={() => setIsPinModalOpen(false)}
                  disabled={isProcessing}
                  className="flex-1 py-2.5 dark:bg-white/[0.08] bg-black/[0.05] hover:dark:bg-white/[0.12] hover:bg-black/[0.08] dark:text-zinc-300 text-zinc-700 font-semibold rounded-2xl text-xs transition-all cursor-pointer"
                >
                  Vazgeç
                </button>
                <button
                  type="submit"
                  disabled={!managerPin.trim() || isProcessing}
                  className={`flex-1 py-2.5 rounded-2xl text-xs font-semibold text-white transition-all disabled:opacity-50 cursor-pointer active:scale-95 shadow-sm ${
                    pendingAction === 'APPROVE'
                      ? 'bg-emerald-600 hover:bg-emerald-500'
                      : 'bg-red-600 hover:bg-red-500'
                  }`}
                >
                  {isProcessing ? 'İşleniyor...' : pendingAction === 'APPROVE' ? 'Onayla' : 'Reddet'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* iOS Dialog 2: Talep Detayı */}
      {detailApproval && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 dark:bg-black/70 backdrop-blur-md p-4 animate-in fade-in duration-150">
          <div className="w-full max-w-sm backdrop-blur-2xl dark:bg-[#121318]/90 bg-white/95 border dark:border-white/10 border-black/[0.08] rounded-3xl p-6 shadow-2xl space-y-4 dark:text-zinc-100 text-zinc-900 animate-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Info className="text-[#007AFF]" size={18} />
                <h3 className="text-base font-bold dark:text-white text-zinc-900">Talep Detayı</h3>
              </div>
              <button
                onClick={() => setDetailApproval(null)}
                className="w-7 h-7 rounded-full dark:bg-white/10 bg-black/5 hover:dark:bg-white/20 hover:bg-black/10 flex items-center justify-center dark:text-zinc-400 text-zinc-600 hover:dark:text-white hover:text-zinc-900 transition-colors cursor-pointer"
              >
                <X size={14} />
              </button>
            </div>

            <div className="space-y-2.5 text-xs backdrop-blur-md dark:bg-white/[0.04] bg-black/[0.03] rounded-2xl p-4 border dark:border-white/10 border-black/[0.08]">
              <div className="flex justify-between py-1 border-b dark:border-white/10 border-black/[0.06]">
                <span className="dark:text-zinc-400 text-zinc-500">Tür</span>
                <span className="font-semibold dark:text-white text-zinc-900">{detailApproval.request_type}</span>
              </div>
              <div className="flex justify-between py-1 border-b dark:border-white/10 border-black/[0.06]">
                <span className="dark:text-zinc-400 text-zinc-500">Kaynak</span>
                <span className="font-mono dark:text-zinc-300 text-zinc-700">{detailApproval.resource_id}</span>
              </div>
              <div className="flex justify-between py-1 border-b dark:border-white/10 border-black/[0.06]">
                <span className="dark:text-zinc-400 text-zinc-500">Talep Eden</span>
                <span className="dark:text-zinc-300 text-zinc-700">{detailApproval.requester_id}</span>
              </div>
              <div className="flex justify-between py-1 border-b dark:border-white/10 border-black/[0.06]">
                <span className="dark:text-zinc-400 text-zinc-500">Tarih</span>
                <span className="dark:text-zinc-300 text-zinc-700">{new Date(detailApproval.created_at).toLocaleString('tr-TR')}</span>
              </div>
              <div className="pt-1">
                <span className="dark:text-zinc-400 text-zinc-500 block mb-1">Açıklama</span>
                <div className="p-2.5 backdrop-blur-md dark:bg-black/30 bg-black/[0.04] rounded-xl border dark:border-white/10 border-black/[0.06] dark:text-zinc-200 text-zinc-800 text-xs font-mono break-all">
                  {detailApproval.payload}
                </div>
              </div>
            </div>

            <div className="flex gap-2 pt-1">
              <button
                onClick={() => {
                  const item = detailApproval;
                  setDetailApproval(null);
                  openPinModal(item, 'REJECT');
                }}
                className="flex-1 py-2.5 bg-red-500/15 hover:bg-red-500/25 border border-red-500/30 text-red-600 dark:text-red-300 rounded-2xl text-xs font-semibold transition-all cursor-pointer"
              >
                Reddet
              </button>
              <button
                onClick={() => {
                  const item = detailApproval;
                  setDetailApproval(null);
                  openPinModal(item, 'APPROVE');
                }}
                className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-2xl text-xs font-semibold transition-all shadow-sm cursor-pointer"
              >
                Onayla
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
