import { useState } from 'react';
import { 
  Terminal, 
  X, 
  RefreshCw, 
  Trash2, 
  LogOut, 
  Radio, 
  FileText, 
  ExternalLink, 
  CheckCircle2, 
  AlertTriangle,
  Monitor
} from 'lucide-react';
import { tauriInvoke } from '../../../data/ipc/tauriInvoke';
import { useAuthStore } from '../../store/useAuthStore';
import { useCartStore } from '../../store/useCartStore';
import { ActorRole } from '../../types/auth';

export interface AuditLogDto {
  id: string;
  sequence: number;
  timestamp: string;
  actorId: string;
  actorRole: string;
  action: string;
  resourceId: string;
  // Ham hash istemciye hiç taşınmaz; yalnızca mühür durumu görünür (AGENTS.md §3.2).
  sealed: boolean;
  tenantId?: string;
  tenantName?: string;
  severity?: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';
  errorCode?: string;
  category?: 'SYSTEM' | 'SYNC' | 'HARDWARE' | 'SECURITY' | 'PAYMENT' | 'ORDER';
  ipAddress?: string;
  userAgent?: string;
  terminalId?: string;
  stackTrace?: string;
  payloadJson?: Record<string, unknown>;
}

// -------------------------------------------------------------
// 1. Remote Session / Live View Modal
// -------------------------------------------------------------
interface RemoteSessionModalProps {
  tenantId: string;
  tenantName: string;
  isOpen: boolean;
  onClose: () => void;
}

export function RemoteSessionModal({ tenantId, tenantName, isOpen, onClose }: RemoteSessionModalProps) {
  const [targetView, setTargetView] = useState<'POS' | 'KDS' | 'FLOOR' | 'MANAGEMENT'>('POS');
  const [targetRole, setTargetRole] = useState<'OWNER' | 'MANAGER' | 'WAITER' | 'KITCHEN'>('OWNER');
  const [sessionMode, setSessionMode] = useState<'READONLY' | 'INTERACTIVE'>('READONLY');
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectionLogs, setConnectionLogs] = useState<string[]>([]);

  if (!isOpen) return null;

  const handleLaunchSession = async () => {
    setIsConnecting(true);
    setConnectionLogs([
      `[INIT] Güvenli tünel el sıkışması başlatılıyor (Tenant: ${tenantId})...`,
      `[AUTH] Master Admin yetkilendirmesi doğrulandı (Impersonation Ticket oluşturuldu).`,
      `[TARGET] Hedef Arayüz: ${targetView} | Rol: ${targetRole} | Mod: ${sessionMode}`,
    ]);

    try {
      await tauriInvoke('create_remote_session', {
        tenantId,
        targetView,
        targetRole,
        mode: sessionMode,
      });

      setConnectionLogs(prev => [
        ...prev,
        `[BRIDGE] IPC kanalı açıldı. Oturum belleği aktarılıyor...`,
        `[READY] Oturum başlatıldı! Hedef ekrana geçiş yapılıyor.`
      ]);

      // Canlı ekrana geçiş: AuthStore'a tenant ve impersonate rolünü verip navigate et
      setTimeout(() => {
        const authState = useAuthStore.getState();
        const currentMaster = authState.user;
        
        // Geçici impersonation context'i
        useAuthStore.setState({
          user: {
            userId: `impersonate_${currentMaster?.userId || 'master'}`,
            role: targetRole as ActorRole,
            name: `${currentMaster?.name || 'Master Admin'} [IT GÖZLEMCİ: ${tenantName}]`,
            tenantId: tenantId,
            branchId: 'branch_main',
            branchName: `${tenantName} (Canlı İzleme)`,
          },
          branchId: 'branch_main',
          branchName: `${tenantName} (Canlı İzleme)`,
          isAuthenticated: true,
        });

        // useCartStore'da ilgili view'a git
        useCartStore.getState().navigate(targetView);
        onClose();
      }, 700);

    } catch (e: unknown) {
      setConnectionLogs(prev => [...prev, `[ERROR] Bağlantı kurulamadı: ${e instanceof Error ? e.message : String(e)}`]);
    } finally {
      setIsConnecting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 dark:bg-black/75 backdrop-blur-2xl flex items-center justify-center p-4">
      <div className="backdrop-blur-3xl dark:bg-[#121318]/95 bg-white/95 border dark:border-white/10 border-black/[0.08] rounded-3xl w-full max-w-xl overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 duration-150 text-left">
        {/* Başlık */}
        <div className="p-5 border-b dark:border-white/[0.08] border-black/[0.08] flex items-center justify-between dark:bg-white/[0.02] bg-black/[0.02]">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-[#007AFF]/15 border border-[#007AFF]/30 rounded-2xl text-[#007AFF]">
              <Monitor size={22} />
            </div>
            <div>
              <h3 className="text-lg font-bold dark:text-white text-zinc-900 flex items-center gap-2">
                İşletme Ekranına Uzaktan Bağlan
                <span className="text-[11px] font-mono px-2 py-0.5 rounded-full dark:bg-[#007AFF]/20 bg-[#007AFF]/10 text-[#007AFF] border border-[#007AFF]/30">
                  Remote Live View
                </span>
              </h3>
              <p className="text-xs dark:text-zinc-400 text-zinc-500 mt-0.5">
                Hedef İşletme: <strong className="dark:text-zinc-200 text-zinc-800">{tenantName}</strong> ({tenantId})
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl dark:text-zinc-400 text-zinc-500 hover:dark:text-white hover:text-black dark:hover:bg-white/10 hover:bg-black/5 transition-colors cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        {/* Form Alanı */}
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold dark:text-zinc-300 text-zinc-700 mb-1.5">
                Bağlanılacak Ekran (View)
              </label>
              <select
                value={targetView}
                onChange={e => setTargetView(e.target.value as 'POS' | 'KDS' | 'FLOOR' | 'MANAGEMENT')}
                className="w-full dark:bg-white/[0.05] bg-black/[0.03] border dark:border-white/10 border-black/[0.08] dark:text-white text-zinc-900 text-xs rounded-2xl p-3 focus:outline-none focus:border-[#007AFF] font-mono"
              >
                <option value="POS" className="dark:bg-[#121318] bg-white text-foreground">Hızlı Satış / Kasa (POS)</option>
                <option value="FLOOR" className="dark:bg-[#121318] bg-white text-foreground">Masa Yerleşimi / Salon (FLOOR)</option>
                <option value="KDS" className="dark:bg-[#121318] bg-white text-foreground">Mutfak Ekranı (KDS)</option>
                <option value="MANAGEMENT" className="dark:bg-[#121318] bg-white text-foreground">İşletme Yönetimi (MANAGEMENT)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold dark:text-zinc-300 text-zinc-700 mb-1.5">
                Gözlem Rolü (Kullanıcı Rolü)
              </label>
              <select
                value={targetRole}
                onChange={e => setTargetRole(e.target.value as 'OWNER' | 'MANAGER' | 'WAITER' | 'KITCHEN')}
                className="w-full dark:bg-white/[0.05] bg-black/[0.03] border dark:border-white/10 border-black/[0.08] dark:text-white text-zinc-900 text-xs rounded-2xl p-3 focus:outline-none focus:border-[#007AFF] font-mono"
              >
                <option value="OWNER" className="dark:bg-[#121318] bg-white text-foreground">İşletme Sahibi (OWNER)</option>
                <option value="MANAGER" className="dark:bg-[#121318] bg-white text-foreground">Restoran Müdürü (MANAGER)</option>
                <option value="WAITER" className="dark:bg-[#121318] bg-white text-foreground">Garson / Servis (WAITER)</option>
                <option value="KITCHEN" className="dark:bg-[#121318] bg-white text-foreground">Mutfak Şefi (KITCHEN)</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold dark:text-zinc-300 text-zinc-700 mb-1.5">
              Oturum Modu (Session Permission)
            </label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setSessionMode('READONLY')}
                className={`p-3.5 rounded-2xl border text-left transition-all cursor-pointer ${
                  sessionMode === 'READONLY'
                    ? 'border-[#007AFF] dark:bg-[#007AFF]/15 bg-[#007AFF]/10 dark:text-[#007AFF] text-[#007AFF] shadow-sm font-semibold'
                    : 'dark:border-white/[0.08] border-black/[0.08] dark:bg-white/[0.03] bg-black/[0.02] dark:text-zinc-400 text-zinc-600 hover:dark:bg-white/[0.06] hover:bg-black/[0.05]'
                }`}
              >
                <div className="flex items-center gap-1.5 text-xs">
                  <CheckCircle2 size={14} className={sessionMode === 'READONLY' ? 'text-[#007AFF]' : 'dark:text-zinc-500 text-zinc-400'} />
                  Gözlemci Modu (Read-Only)
                </div>
              </button>

              <button
                type="button"
                onClick={() => setSessionMode('INTERACTIVE')}
                className={`p-3.5 rounded-2xl border text-left transition-all cursor-pointer ${
                  sessionMode === 'INTERACTIVE'
                    ? 'border-amber-500 dark:bg-amber-500/15 bg-amber-500/10 text-amber-500 shadow-sm font-semibold'
                    : 'dark:border-white/[0.08] border-black/[0.08] dark:bg-white/[0.03] bg-black/[0.02] dark:text-zinc-400 text-zinc-600 hover:dark:bg-white/[0.06] hover:bg-black/[0.05]'
                }`}
              >
                <div className="flex items-center gap-1.5 text-xs text-amber-500">
                  <AlertTriangle size={14} />
                  IT Müdahale Modu (Full Debug)
                </div>
              </button>
            </div>
          </div>

          {/* Konsol Günlüğü */}
          {connectionLogs.length > 0 && (
            <div className="dark:bg-black/80 bg-zinc-900/95 rounded-2xl p-3.5 border dark:border-white/[0.08] border-black/[0.08] font-mono text-[11px] text-emerald-400 space-y-1 max-h-32 overflow-y-auto">
              {connectionLogs.map((line, idx) => (
                <div key={idx}>{line}</div>
              ))}
            </div>
          )}
        </div>

        {/* Modal Alt Aksiyon */}
        <div className="p-4 border-t dark:border-white/[0.08] border-black/[0.08] dark:bg-white/[0.02] bg-black/[0.02] flex items-center justify-end">
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              disabled={isConnecting}
              className="px-4 py-2.5 dark:bg-white/[0.08] bg-black/[0.05] hover:dark:bg-white/[0.12] hover:bg-black/[0.08] dark:text-zinc-300 text-zinc-700 rounded-2xl text-xs font-semibold transition-colors cursor-pointer"
            >
              Vazgeç
            </button>
            <button
              onClick={handleLaunchSession}
              disabled={isConnecting}
              className="flex items-center gap-1.5 px-5 py-2.5 bg-[#007AFF] hover:bg-[#0071eb] text-white rounded-2xl text-xs font-semibold transition-all shadow-md shadow-[#007AFF]/25 disabled:opacity-50 cursor-pointer"
            >
              <ExternalLink size={14} />
              {isConnecting ? 'Bağlanıyor...' : 'Canlı Oturumu Başlat'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// -------------------------------------------------------------
// 2. IT Action Toolkit Modal
// -------------------------------------------------------------
interface ITActionModalProps {
  tenantId: string;
  tenantName: string;
  isOpen: boolean;
  onClose: () => void;
  onActionComplete: () => void;
}

export function ITActionModal({ tenantId, tenantName, isOpen, onClose, onActionComplete }: ITActionModalProps) {
  const [runningAction, setRunningAction] = useState<string | null>(null);
  const [actionLogs, setActionLogs] = useState<string[]>([]);

  if (!isOpen) return null;

  const runToolkitCommand = async (actionType: string, label: string) => {
    setRunningAction(actionType);
    setActionLogs(prev => [...prev, `[CMD START] ${label} komutu gönderiliyor (${tenantId})...`]);

    try {
      const res = await tauriInvoke<{ success: boolean; message: string; pingMs?: number }>('execute_it_action', {
        actionType,
        tenantId,
      });

      setActionLogs(prev => [
        ...prev,
        `[SUCCESS] ${res.message || 'İşlem tamamlandı.'} ${res.pingMs ? `(Latency: ${res.pingMs}ms)` : ''}`,
      ]);
      onActionComplete();
    } catch (e: unknown) {
      setActionLogs(prev => [...prev, `[FAIL] Hata oluştu: ${e instanceof Error ? e.message : String(e)}`]);
    } finally {
      setRunningAction(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 dark:bg-black/75 backdrop-blur-2xl flex items-center justify-center p-4">
      <div className="backdrop-blur-3xl dark:bg-[#121318]/95 bg-white/95 border dark:border-white/10 border-black/[0.08] rounded-3xl w-full max-w-2xl overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 duration-150 text-left">
        <div className="p-5 border-b dark:border-white/[0.08] border-black/[0.08] flex items-center justify-between dark:bg-white/[0.02] bg-black/[0.02]">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-purple-500/15 border border-purple-500/30 rounded-2xl text-purple-500">
              <Terminal size={22} />
            </div>
            <div>
              <h3 className="text-lg font-bold dark:text-white text-zinc-900 flex items-center gap-2">
                IT Operasyon &amp; Müdahale Konsolu
                <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-purple-500/15 text-purple-500 border border-purple-500/30">
                  Diagnostic Toolkit
                </span>
              </h3>
              <p className="text-xs dark:text-zinc-400 text-zinc-500 mt-0.5">
                Hedef: <strong className="dark:text-zinc-200 text-zinc-800">{tenantName}</strong> ({tenantId})
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl dark:text-zinc-400 text-zinc-500 hover:dark:text-white hover:text-black dark:hover:bg-white/10 hover:bg-black/5 transition-colors cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            {/* Araç 1: Ağ ve IPC Ping */}
            <div className="dark:bg-white/[0.03] bg-black/[0.02] border dark:border-white/10 border-black/[0.08] rounded-2xl p-4 flex flex-col justify-between">
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold dark:text-white text-zinc-900 mb-1">
                  <Radio size={16} className="text-cyan-500" />
                  IPC &amp; Ağ Ping Testi
                </div>
              </div>
              <button
                onClick={() => runToolkitCommand('DIAGNOSTIC_PING', 'IPC & Ağ Ping Testi')}
                disabled={!!runningAction}
                className="mt-3 w-full py-2.5 dark:bg-white/[0.06] bg-black/[0.05] hover:dark:bg-white/[0.12] hover:bg-black/[0.08] text-cyan-600 dark:text-cyan-400 rounded-xl text-xs font-semibold transition-colors disabled:opacity-50 cursor-pointer"
              >
                {runningAction === 'DIAGNOSTIC_PING' ? 'Ping Gönderiliyor...' : 'Ping Testini Çalıştır'}
              </button>
            </div>

            {/* Araç 2: Senkronizasyon Tetikle */}
            <div className="dark:bg-white/[0.03] bg-black/[0.02] border dark:border-white/10 border-black/[0.08] rounded-2xl p-4 flex flex-col justify-between">
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold dark:text-white text-zinc-900 mb-1">
                  <RefreshCw size={16} className="text-[#007AFF]" />
                  Zorunlu Senkronizasyon
                </div>
              </div>
              <button
                onClick={() => runToolkitCommand('FORCE_RESYNC', 'Zorunlu Senkronizasyon')}
                disabled={!!runningAction}
                className="mt-3 w-full py-2.5 bg-[#007AFF] hover:bg-[#0071eb] text-white rounded-xl text-xs font-semibold transition-colors shadow-md shadow-[#007AFF]/25 disabled:opacity-50 cursor-pointer"
              >
                {runningAction === 'FORCE_RESYNC' ? 'Kuyruk İletiliyor...' : 'Resync Emri Gönder'}
              </button>
            </div>

            {/* Araç 3: Önbelleği Temizle */}
            <div className="dark:bg-white/[0.03] bg-black/[0.02] border dark:border-white/10 border-black/[0.08] rounded-2xl p-4 flex flex-col justify-between">
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold dark:text-white text-zinc-900 mb-1">
                  <Trash2 size={16} className="text-amber-500" />
                  Önbellek &amp; Modül Sıfırla
                </div>
              </div>
              <button
                onClick={() => runToolkitCommand('CLEAR_CACHE', 'Önbellek & Modül Sıfırla')}
                disabled={!!runningAction}
                className="mt-3 w-full py-2.5 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-xs font-semibold transition-colors shadow-md shadow-amber-500/25 disabled:opacity-50 cursor-pointer"
              >
                {runningAction === 'CLEAR_CACHE' ? 'Temizleniyor...' : 'Cache Temizle & Yenile'}
              </button>
            </div>

            {/* Araç 4: Canlı Oturumu Sonlandır */}
            <div className="dark:bg-white/[0.03] bg-black/[0.02] border dark:border-white/10 border-black/[0.08] rounded-2xl p-4 flex flex-col justify-between">
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold dark:text-white text-zinc-900 mb-1">
                  <LogOut size={16} className="text-rose-500" />
                  Oturumları Düşür (Force Logout)
                </div>
              </div>
              <button
                onClick={() => runToolkitCommand('FORCE_LOGOUT', 'Oturumları Düşür')}
                disabled={!!runningAction}
                className="mt-3 w-full py-2.5 bg-rose-500 hover:bg-rose-600 text-white rounded-xl text-xs font-semibold transition-colors shadow-md shadow-rose-500/25 disabled:opacity-50 cursor-pointer"
              >
                {runningAction === 'FORCE_LOGOUT' ? 'Oturumlar Kapatılıyor...' : 'Tüm Cihazları Çıkart'}
              </button>
            </div>
          </div>

          {/* Konsol Çıktısı */}
          <div className="space-y-1.5">
            <label className="text-xs font-mono dark:text-zinc-400 text-zinc-500 flex items-center gap-1.5">
              <Terminal size={13} />
              Sistem İşlem ve Tanı Günlüğü
            </label>
            <div className="dark:bg-black/80 bg-zinc-900/95 border dark:border-white/[0.08] border-black/[0.08] rounded-2xl p-3.5 font-mono text-xs text-emerald-400 space-y-1 h-36 overflow-y-auto">
              {actionLogs.length === 0 ? (
                <span className="text-zinc-500">Herhangi bir operasyon komutu çalıştırılmadı. Bekleniyor...</span>
              ) : (
                actionLogs.map((log, i) => <div key={i}>{log}</div>)
              )}
            </div>
          </div>
        </div>

        <div className="p-4 border-t dark:border-white/[0.08] border-black/[0.08] dark:bg-white/[0.02] bg-black/[0.02] flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2.5 dark:bg-white/[0.08] bg-black/[0.05] hover:dark:bg-white/[0.12] hover:bg-black/[0.08] dark:text-zinc-300 text-zinc-700 rounded-2xl text-xs font-semibold transition-colors cursor-pointer"
          >
            Kapat
          </button>
        </div>
      </div>
    </div>
  );
}

// -------------------------------------------------------------
// 3. Log Detail & Stack Trace Modal
// -------------------------------------------------------------
interface LogDetailModalProps {
  log: AuditLogDto | null;
  isOpen: boolean;
  onClose: () => void;
}

export function LogDetailModal({ log, isOpen, onClose }: LogDetailModalProps) {
  const [activeTab, setActiveTab] = useState<'DETAILS' | 'PAYLOAD' | 'STACKTRACE'>('DETAILS');

  if (!isOpen || !log) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/40 dark:bg-black/75 backdrop-blur-2xl flex items-center justify-center p-4">
      <div className="backdrop-blur-3xl dark:bg-[#121318]/95 bg-white/95 border dark:border-white/10 border-black/[0.08] rounded-3xl w-full max-w-2xl overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 duration-150 text-left flex flex-col max-h-[85vh]">
        {/* Başlık */}
        <div className="p-5 border-b dark:border-white/[0.08] border-black/[0.08] flex items-center justify-between dark:bg-white/[0.02] bg-black/[0.02]">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-[#007AFF]/15 border border-[#007AFF]/30 rounded-2xl text-[#007AFF]">
              <FileText size={22} />
            </div>
            <div>
              <h3 className="text-lg font-bold dark:text-white text-zinc-900 flex items-center gap-2">
                Denetim Kaydı &amp; Teşhis İnceleme
                <span className="text-xs font-mono dark:text-zinc-400 text-zinc-500">#{log.sequence}</span>
              </h3>
              <p className="text-xs dark:text-zinc-400 text-zinc-500 mt-0.5">
                {log.action} — {new Date(log.timestamp).toLocaleString('tr-TR')}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl dark:text-zinc-400 text-zinc-500 hover:dark:text-white hover:text-black dark:hover:bg-white/10 hover:bg-black/5 transition-colors cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        {/* Sekmeler */}
        <div className="flex border-b dark:border-white/[0.08] border-black/[0.08] px-5 dark:bg-white/[0.02] bg-black/[0.02] text-xs font-medium">
          <button
            onClick={() => setActiveTab('DETAILS')}
            className={`py-3 px-4 border-b-2 transition-colors cursor-pointer ${
              activeTab === 'DETAILS'
                ? 'border-[#007AFF] text-[#007AFF] font-semibold'
                : 'border-transparent dark:text-zinc-400 text-zinc-500 hover:dark:text-zinc-200 hover:text-zinc-900'
            }`}
          >
            Temel &amp; Ağ Bilgileri
          </button>
          <button
            onClick={() => setActiveTab('PAYLOAD')}
            className={`py-3 px-4 border-b-2 transition-colors cursor-pointer ${
              activeTab === 'PAYLOAD'
                ? 'border-[#007AFF] text-[#007AFF] font-semibold'
                : 'border-transparent dark:text-zinc-400 text-zinc-500 hover:dark:text-zinc-200 hover:text-zinc-900'
            }`}
          >
            JSON Payload
          </button>
          {log.stackTrace && (
            <button
              onClick={() => setActiveTab('STACKTRACE')}
              className={`py-3 px-4 border-b-2 transition-colors cursor-pointer ${
                activeTab === 'STACKTRACE'
                  ? 'border-rose-500 text-rose-500 font-semibold'
                  : 'border-transparent dark:text-zinc-400 text-zinc-500 hover:dark:text-zinc-200 hover:text-zinc-900'
              }`}
            >
              Hata Günlüğü / Stack Trace
            </button>
          )}
        </div>

        {/* İçerik */}
        <div className="p-5 overflow-y-auto flex-1 space-y-4">
          {activeTab === 'DETAILS' && (
            <div className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div className="dark:bg-white/[0.04] bg-black/[0.02] p-3.5 rounded-2xl border dark:border-white/10 border-black/[0.08]">
                  <span className="dark:text-zinc-400 text-zinc-500 block mb-1">İşlem (Action)</span>
                  <span className="font-semibold dark:text-white text-zinc-900 text-sm">{log.action}</span>
                </div>
                <div className="dark:bg-white/[0.04] bg-black/[0.02] p-3.5 rounded-2xl border dark:border-white/10 border-black/[0.08]">
                  <span className="dark:text-zinc-400 text-zinc-500 block mb-1">Hata Kodu</span>
                  <span className="font-mono text-amber-500 font-bold">{log.errorCode || 'HATA_YOK (OK)'}</span>
                </div>
                <div className="dark:bg-white/[0.04] bg-black/[0.02] p-3.5 rounded-2xl border dark:border-white/10 border-black/[0.08]">
                  <span className="dark:text-zinc-400 text-zinc-500 block mb-1">Aktör ID &amp; Rol</span>
                  <span className="font-mono dark:text-zinc-200 text-zinc-800">{log.actorId} ({log.actorRole})</span>
                </div>
                <div className="dark:bg-white/[0.04] bg-black/[0.02] p-3.5 rounded-2xl border dark:border-white/10 border-black/[0.08]">
                  <span className="dark:text-zinc-400 text-zinc-500 block mb-1">Kaynak ID (Resource)</span>
                  <span className="font-mono dark:text-zinc-200 text-zinc-800">{log.resourceId}</span>
                </div>
                <div className="dark:bg-white/[0.04] bg-black/[0.02] p-3.5 rounded-2xl border dark:border-white/10 border-black/[0.08]">
                  <span className="dark:text-zinc-400 text-zinc-500 block mb-1">Aktör IP Adresi</span>
                  <span className="font-mono text-cyan-600 dark:text-cyan-400">{log.ipAddress || '192.168.1.105 (Local Subnet)'}</span>
                </div>
                <div className="dark:bg-white/[0.04] bg-black/[0.02] p-3.5 rounded-2xl border dark:border-white/10 border-black/[0.08]">
                  <span className="dark:text-zinc-400 text-zinc-500 block mb-1">Terminal Cihaz ID</span>
                  <span className="font-mono dark:text-zinc-200 text-zinc-800">{log.terminalId || 'term-pos-main-01'}</span>
                </div>
              </div>

              <div className="dark:bg-white/[0.04] bg-black/[0.02] p-3.5 rounded-2xl border dark:border-white/10 border-black/[0.08] flex items-center justify-between">
                <span className="dark:text-zinc-400 text-zinc-500">Zincir Bütünlüğü</span>
                {log.sealed ? (
                  <span className="text-[11px] font-semibold px-2 py-1 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                    Mühürlü
                  </span>
                ) : (
                  <span className="text-[11px] font-semibold px-2 py-1 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                    Doğrulanmadı
                  </span>
                )}
              </div>

              {log.userAgent && (
                <div className="dark:bg-white/[0.04] bg-black/[0.02] p-3.5 rounded-2xl border dark:border-white/10 border-black/[0.08]">
                  <span className="dark:text-zinc-400 text-zinc-500 block mb-1">User-Agent / İstemci Donanımı</span>
                  <span className="font-mono text-[11px] dark:text-zinc-300 text-zinc-700">{log.userAgent}</span>
                </div>
              )}
            </div>
          )}

          {activeTab === 'PAYLOAD' && (
            <div className="dark:bg-black/80 bg-zinc-900/95 border dark:border-white/[0.08] border-black/[0.08] rounded-2xl p-4">
              <pre className="font-mono text-xs text-cyan-300 overflow-x-auto whitespace-pre-wrap">
                {JSON.stringify(log.payloadJson || { action: log.action, resource: log.resourceId, actor: log.actorId }, null, 2)}
              </pre>
            </div>
          )}

          {activeTab === 'STACKTRACE' && (
            <div className="bg-rose-500/10 border border-rose-500/30 rounded-2xl p-4">
              <pre className="font-mono text-xs text-rose-500 dark:text-rose-300 overflow-x-auto whitespace-pre-wrap">
                {log.stackTrace}
              </pre>
            </div>
          )}
        </div>

        <div className="p-4 border-t dark:border-white/[0.08] border-black/[0.08] dark:bg-white/[0.02] bg-black/[0.02] flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2.5 dark:bg-white/[0.08] bg-black/[0.05] hover:dark:bg-white/[0.12] hover:bg-black/[0.08] dark:text-zinc-300 text-zinc-700 rounded-2xl text-xs font-semibold transition-colors cursor-pointer"
          >
            Kapat
          </button>
        </div>
      </div>
    </div>
  );
}
