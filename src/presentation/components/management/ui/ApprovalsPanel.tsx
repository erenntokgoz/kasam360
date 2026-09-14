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

export function ApprovalsPanel() {
  const [approvals, setApprovals] = useState<ApprovalDto[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  
  // PIN Modal State
  const [activeApproval, setActiveApproval] = useState<ApprovalDto | null>(null);
  const [pendingAction, setPendingAction] = useState<'APPROVE' | 'REJECT'>('APPROVE');
  const [managerPin, setManagerPin] = useState('');
  const [isPinModalOpen, setIsPinModalOpen] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);

  // Detay Modal State
  const [detailApproval, setDetailApproval] = useState<ApprovalDto | null>(null);

  const addToast = (msg: string, type: 'success' | 'error' | 'info') => useToast.add({ title: msg, type });

  const fetchApprovals = useCallback(async (showLoader = false) => {
    if (showLoader) setIsRefreshing(true);
    try {
      const data = await invoke<ApprovalDto[]>('get_pending_approvals');
      setApprovals(data || []);
    } catch (error) {
      console.error('Failed to fetch approvals:', error);
      addToast('Onay bekleyen işlemler yüklenemedi.', 'error');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchApprovals();
  }, [fetchApprovals]);

  const openPinModal = (approval: ApprovalDto, action: 'APPROVE' | 'REJECT') => {
    setActiveApproval(approval);
    setPendingAction(action);
    setManagerPin('');
    setPinError(null);
    setIsPinModalOpen(true);
  };

  const handleProcessSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeApproval) return;
    if (!managerPin || managerPin.length < 4) {
      setPinError('Lütfen 4 haneli müdür PIN kodunuzu eksiksiz girin.');
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
        `İşlem başarıyla ${pendingAction === 'APPROVE' ? 'onaylandı' : 'reddedildi'}.`,
        'success'
      );
      setIsPinModalOpen(false);
      setActiveApproval(null);
      await fetchApprovals(false);
    } catch (error) {
      console.error('Failed to process approval:', error);
      setPinError(String(error) || 'Yetkilendirme hatası veya geçersiz PIN kodu.');
    } finally {
      setIsProcessing(false);
    }
  };

  if (isLoading) {
    return <div className="p-8 text-center text-slate-400">Yükleniyor...</div>;
  }

  return (
    <div className="flex flex-col h-full space-y-6 text-slate-200">
      {/* Üst Başlık & Yenile Butonu */}
      <div className="flex items-center justify-between bg-slate-900/70 border border-slate-800 p-4 rounded-xl">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-amber-500/10 text-amber-400 rounded-xl">
            <ShieldCheck size={24} />
          </div>
          <div>
            <h3 className="text-lg font-bold text-white">Müdür Onay Paneli</h3>
            <p className="text-xs text-slate-400">
              İptal, iade, ikram ve iskonto gibi yetki gerektiren operasyonel onay talepleri
            </p>
          </div>
        </div>

        <button
          onClick={() => fetchApprovals(true)}
          disabled={isRefreshing}
          className="flex items-center gap-2 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-lg text-xs font-semibold transition-colors disabled:opacity-50"
        >
          <RefreshCw size={14} className={isRefreshing ? 'animate-spin' : ''} />
          Yenile
        </button>
      </div>

      {/* Bekleyen Onaylar Listesi */}
      <div className="flex-1 overflow-y-auto">
        {approvals.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 space-y-3 p-8 text-center bg-slate-900/40 rounded-2xl border border-slate-800">
            <div className="rounded-full bg-slate-800 p-4 text-emerald-400">
              <CheckCircle2 size={32} />
            </div>
            <h4 className="text-lg font-bold text-white">Bekleyen Onay Yok</h4>
            <p className="text-xs text-slate-400 max-w-sm">
              Şu anda onayınızı bekleyen herhangi bir iptal veya iskonto talebi bulunmuyor.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {approvals.map(approval => (
              <div
                key={approval.id}
                onClick={() => setDetailApproval(approval)}
                className="bg-slate-900 border border-slate-800 hover:border-slate-700 rounded-2xl p-5 flex flex-col justify-between cursor-pointer transition-all shadow-sm"
              >
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <span className="bg-amber-500/20 text-amber-400 border border-amber-500/30 px-2.5 py-0.5 rounded-full text-xs font-bold uppercase tracking-wider">
                      {approval.request_type}
                    </span>
                    <span className="text-xs text-slate-400 flex items-center gap-1">
                      <Clock size={12} />
                      {new Date(approval.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>

                  <h4 className="text-white font-semibold text-base mb-1">
                    Kaynak: {approval.resource_id}
                  </h4>

                  <p className="text-xs text-slate-400 flex items-center gap-1.5 mb-2">
                    <User size={13} className="text-slate-500" />
                    Talep Eden: <strong className="text-slate-300">{approval.requester_id}</strong>
                  </p>

                  <div className="p-3 bg-slate-950 rounded-xl border border-slate-800/80 text-xs text-slate-300">
                    <span className="text-slate-500 block text-[11px] mb-0.5">Talep Açıklaması:</span>
                    {approval.payload}
                  </div>
                </div>

                <div 
                  className="flex items-center justify-end gap-2 pt-4 mt-4 border-t border-slate-800"
                  onClick={e => e.stopPropagation()}
                >
                  <button
                    onClick={() => openPinModal(approval, 'REJECT')}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-red-950/40 hover:bg-red-900/60 border border-red-700/50 text-red-300 rounded-xl text-xs font-bold transition-colors"
                  >
                    <XCircle size={14} />
                    Reddet
                  </button>
                  <button
                    onClick={() => openPinModal(approval, 'APPROVE')}
                    className="flex items-center gap-1.5 px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold shadow-md shadow-emerald-900/30 transition-colors"
                  >
                    <CheckCircle2 size={14} />
                    Onayla
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* MODAL 1: Güvenli PIN Giriş Modalı */}
      {isPinModalOpen && activeApproval && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm bg-slate-900 border border-slate-700 rounded-2xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className={`p-2 rounded-xl ${pendingAction === 'APPROVE' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`}>
                  <Lock size={20} />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">Müdür Yetkilendirmesi</h3>
                  <p className="text-xs text-slate-400">
                    {pendingAction === 'APPROVE' ? 'İşlemi Onayla' : 'İşlemi Reddet'}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsPinModalOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 text-xs text-slate-300 space-y-1">
              <div><strong>Talep:</strong> {activeApproval.request_type}</div>
              <div><strong>Kaynak:</strong> {activeApproval.resource_id}</div>
              <div><strong>Gerekçe:</strong> {activeApproval.payload}</div>
            </div>

            <form onSubmit={handleProcessSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5 text-center">
                  Yetkili Müdür PIN Kodunuzu Girin
                </label>
                <input
                  type="password"
                  maxLength={4}
                  autoFocus
                  required
                  placeholder="••••"
                  value={managerPin}
                  onChange={e => setManagerPin(e.target.value.replace(/\D/g, ''))}
                  className="w-full px-4 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-white font-mono tracking-widest text-center text-xl focus:outline-none focus:border-indigo-500"
                />
              </div>

              {pinError && (
                <div className="p-2.5 bg-red-950/40 border border-red-800/50 rounded-xl text-xs text-red-300 text-center">
                  {pinError}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsPinModalOpen(false)}
                  disabled={isProcessing}
                  className="px-4 py-2 rounded-xl text-xs font-medium text-slate-300 hover:bg-slate-800"
                >
                  İptal
                </button>
                <button
                  type="submit"
                  disabled={isProcessing}
                  className={`px-5 py-2 rounded-xl text-xs font-bold text-white transition-colors disabled:opacity-50 ${
                    pendingAction === 'APPROVE'
                      ? 'bg-emerald-600 hover:bg-emerald-500 shadow-lg shadow-emerald-900/30'
                      : 'bg-red-600 hover:bg-red-500 shadow-lg shadow-red-900/30'
                  }`}
                >
                  {isProcessing ? 'İşleniyor...' : pendingAction === 'APPROVE' ? 'Onayla ve Tamamla' : 'Reddet'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: Talep Detayı Modalı */}
      {detailApproval && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-md bg-slate-900 border border-slate-700 rounded-2xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Info className="text-indigo-400" size={20} />
                <h3 className="text-base font-bold text-white">Onay Talebi Detayı</h3>
              </div>
              <button
                onClick={() => setDetailApproval(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 space-y-2">
                <div className="flex justify-between">
                  <span className="text-slate-400">Talep Türü:</span>
                  <span className="font-bold text-white">{detailApproval.request_type}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Kaynak / Adisyon:</span>
                  <span className="font-mono text-indigo-400">{detailApproval.resource_id}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Talep Eden:</span>
                  <span className="font-semibold text-slate-200">{detailApproval.requester_id}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Talep Tarihi:</span>
                  <span className="text-slate-300">{new Date(detailApproval.created_at).toLocaleString('tr-TR')}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Durum:</span>
                  <span className="font-bold text-amber-400">{detailApproval.status}</span>
                </div>
              </div>

              <div>
                <span className="text-slate-400 font-semibold block mb-1">Gerekçe / Ek Yük (Payload):</span>
                <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 text-slate-200 leading-relaxed font-mono text-xs break-all">
                  {detailApproval.payload}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-800">
              <button
                onClick={() => {
                  const item = detailApproval;
                  setDetailApproval(null);
                  openPinModal(item, 'REJECT');
                }}
                className="px-4 py-2 bg-red-950/40 hover:bg-red-900/60 border border-red-700/50 text-red-300 rounded-xl text-xs font-bold transition-colors"
              >
                Reddet
              </button>
              <button
                onClick={() => {
                  const item = detailApproval;
                  setDetailApproval(null);
                  openPinModal(item, 'APPROVE');
                }}
                className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-emerald-900/30 transition-colors"
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
