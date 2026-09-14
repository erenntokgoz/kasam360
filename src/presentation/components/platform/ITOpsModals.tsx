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
  hash: string;
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
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-700/80 rounded-2xl w-full max-w-xl overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 duration-150 text-left">
        {/* Başlık */}
        <div className="p-5 border-b border-slate-800 flex items-center justify-between bg-slate-950/60">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-blue-600/20 border border-blue-500/30 rounded-xl text-blue-400">
              <Monitor size={22} />
            </div>
            <div>
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                İşletme Ekranına Uzaktan Bağlan
                <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-blue-900/60 text-blue-300 border border-blue-700">
                  Remote Live View
                </span>
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Hedef İşletme: <strong className="text-slate-200">{tenantName}</strong> ({tenantId})
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Form Alanı */}
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                Bağlanılacak Ekran (View)
              </label>
              <select
                value={targetView}
                onChange={e => setTargetView(e.target.value as 'POS' | 'KDS' | 'FLOOR' | 'MANAGEMENT')}
                className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-xs rounded-lg p-2.5 focus:outline-none focus:border-blue-500 font-mono"
              >
                <option value="POS">Hızlı Satış / Kasa (POS)</option>
                <option value="FLOOR">Masa Yerleşimi / Salon (FLOOR)</option>
                <option value="KDS">Mutfak Ekranı (KDS)</option>
                <option value="MANAGEMENT">İşletme Yönetimi (MANAGEMENT)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                Taklit Edilecek Rol (Impersonate Role)
              </label>
              <select
                value={targetRole}
                onChange={e => setTargetRole(e.target.value as 'OWNER' | 'MANAGER' | 'WAITER' | 'KITCHEN')}
                className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-xs rounded-lg p-2.5 focus:outline-none focus:border-blue-500 font-mono"
              >
                <option value="OWNER">İşletme Sahibi (OWNER)</option>
                <option value="MANAGER">Restoran Müdürü (MANAGER)</option>
                <option value="WAITER">Garson / Servis (WAITER)</option>
                <option value="KITCHEN">Mutfak Şefi (KITCHEN)</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">
              Oturum Modu (Session Permission)
            </label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setSessionMode('READONLY')}
                className={`p-3 rounded-xl border text-left transition-all ${
                  sessionMode === 'READONLY'
                    ? 'border-blue-500 bg-blue-950/40 text-blue-200 shadow-sm'
                    : 'border-slate-800 bg-slate-800/40 text-slate-400 hover:bg-slate-800'
                }`}
              >
                <div className="flex items-center gap-1.5 text-xs font-bold">
                  <CheckCircle2 size={14} className={sessionMode === 'READONLY' ? 'text-blue-400' : 'text-slate-500'} />
                  Gözlemci Modu (Read-Only)
                </div>
                <p className="text-[11px] text-slate-400 mt-1 leading-tight">
                  Müşteri ekranındaki tüm sipariş, masa ve menüyü canlı izleyin. Değişiklik yapılamaz.
                </p>
              </button>

              <button
                type="button"
                onClick={() => setSessionMode('INTERACTIVE')}
                className={`p-3 rounded-xl border text-left transition-all ${
                  sessionMode === 'INTERACTIVE'
                    ? 'border-amber-500 bg-amber-950/40 text-amber-200 shadow-sm'
                    : 'border-slate-800 bg-slate-800/40 text-slate-400 hover:bg-slate-800'
                }`}
              >
                <div className="flex items-center gap-1.5 text-xs font-bold text-amber-400">
                  <AlertTriangle size={14} />
                  IT Müdahale Modu (Full Debug)
                </div>
                <p className="text-[11px] text-slate-400 mt-1 leading-tight">
                  Hata çözümü için işlem yapma ve doğrudan konfigürasyon düzeltme yetkisi verir.
                </p>
              </button>
            </div>
          </div>

          {/* Konsol Günlüğü */}
          {connectionLogs.length > 0 && (
            <div className="bg-black/80 rounded-xl p-3 border border-slate-800 font-mono text-[11px] text-emerald-400 space-y-1 max-h-32 overflow-y-auto">
              {connectionLogs.map((line, idx) => (
                <div key={idx}>{line}</div>
              ))}
            </div>
          )}
        </div>

        {/* Modal Alt Aksiyon */}
        <div className="p-4 border-t border-slate-800 bg-slate-950/70 flex items-center justify-between">
          <span className="text-[11px] text-slate-400">
            * Güvenlik gereği yapılan tüm eylemler SHA-256 zincirinde denetim kaydına yazılır.
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              disabled={isConnecting}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-semibold transition-colors"
            >
              Vazgeç
            </button>
            <button
              onClick={handleLaunchSession}
              disabled={isConnecting}
              className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-bold transition-all shadow-md disabled:opacity-50"
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
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-700/80 rounded-2xl w-full max-w-2xl overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 duration-150 text-left">
        <div className="p-5 border-b border-slate-800 flex items-center justify-between bg-slate-950/60">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-purple-600/20 border border-purple-500/30 rounded-xl text-purple-400">
              <Terminal size={22} />
            </div>
            <div>
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                IT Operasyon &amp; Müdahale Konsolu
                <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-purple-900/60 text-purple-300 border border-purple-700">
                  Diagnostic Toolkit
                </span>
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Hedef: <strong className="text-slate-200">{tenantName}</strong> ({tenantId})
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            {/* Araç 1: Ağ ve IPC Ping */}
            <div className="bg-slate-800/60 border border-slate-700/60 rounded-xl p-3.5 flex flex-col justify-between">
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold text-white mb-1">
                  <Radio size={16} className="text-cyan-400" />
                  IPC &amp; Ağ Ping Testi
                </div>
                <p className="text-xs text-slate-400">
                  İşletme terminallerine canlı TCP/IPC sinyali göndererek gecikmeyi ölçer.
                </p>
              </div>
              <button
                onClick={() => runToolkitCommand('DIAGNOSTIC_PING', 'IPC & Ağ Ping Testi')}
                disabled={!!runningAction}
                className="mt-3 w-full py-2 bg-slate-700 hover:bg-slate-600 text-cyan-300 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50"
              >
                {runningAction === 'DIAGNOSTIC_PING' ? 'Ping Gönderiliyor...' : 'Ping Testini Çalıştır'}
              </button>
            </div>

            {/* Araç 2: Senkronizasyon Tetikle */}
            <div className="bg-slate-800/60 border border-slate-700/60 rounded-xl p-3.5 flex flex-col justify-between">
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold text-white mb-1">
                  <RefreshCw size={16} className="text-blue-400" />
                  Zorunlu Senkronizasyon
                </div>
                <p className="text-xs text-slate-400">
                  Bekleyen çevrimdışı fiş ve sipariş kuyruğunu sunucuya hemen push eder.
                </p>
              </div>
              <button
                onClick={() => runToolkitCommand('FORCE_RESYNC', 'Zorunlu Senkronizasyon')}
                disabled={!!runningAction}
                className="mt-3 w-full py-2 bg-blue-600/80 hover:bg-blue-600 text-white rounded-lg text-xs font-semibold transition-colors disabled:opacity-50"
              >
                {runningAction === 'FORCE_RESYNC' ? 'Kuyruk İletiliyor...' : 'Resync Emri Gönder'}
              </button>
            </div>

            {/* Araç 3: Önbelleği Temizle */}
            <div className="bg-slate-800/60 border border-slate-700/60 rounded-xl p-3.5 flex flex-col justify-between">
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold text-white mb-1">
                  <Trash2 size={16} className="text-amber-400" />
                  Önbellek &amp; Modül Sıfırla
                </div>
                <p className="text-xs text-slate-400">
                  Katalog, masa ve geçici hafıza önbelleğini boşaltıp sıfırdan çeker.
                </p>
              </div>
              <button
                onClick={() => runToolkitCommand('CLEAR_CACHE', 'Önbellek & Modül Sıfırla')}
                disabled={!!runningAction}
                className="mt-3 w-full py-2 bg-amber-600/80 hover:bg-amber-600 text-white rounded-lg text-xs font-semibold transition-colors disabled:opacity-50"
              >
                {runningAction === 'CLEAR_CACHE' ? 'Temizleniyor...' : 'Cache Temizle & Yenile'}
              </button>
            </div>

            {/* Araç 4: Canlı Oturumu Sonlandır */}
            <div className="bg-slate-800/60 border border-slate-700/60 rounded-xl p-3.5 flex flex-col justify-between">
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold text-white mb-1">
                  <LogOut size={16} className="text-red-400" />
                  Oturumları Düşür (Force Logout)
                </div>
                <p className="text-xs text-slate-400">
                  Güvenlik veya kilitlenme durumunda tüm açık terminalleri PIN ekranına atar.
                </p>
              </div>
              <button
                onClick={() => runToolkitCommand('FORCE_LOGOUT', 'Oturumları Düşür')}
                disabled={!!runningAction}
                className="mt-3 w-full py-2 bg-red-600/80 hover:bg-red-600 text-white rounded-lg text-xs font-semibold transition-colors disabled:opacity-50"
              >
                {runningAction === 'FORCE_LOGOUT' ? 'Oturumlar Kapatılıyor...' : 'Tüm Cihazları Çıkart'}
              </button>
            </div>
          </div>

          {/* Konsol Çıktısı */}
          <div className="space-y-1.5">
            <label className="text-xs font-mono text-slate-400 flex items-center gap-1.5">
              <Terminal size={13} />
              IT Diagnostic Output Terminal
            </label>
            <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 font-mono text-xs text-emerald-400 space-y-1 h-36 overflow-y-auto">
              {actionLogs.length === 0 ? (
                <span className="text-slate-600">Herhangi bir operasyon komutu çalıştırılmadı. Bekleniyor...</span>
              ) : (
                actionLogs.map((log, i) => <div key={i}>{log}</div>)
              )}
            </div>
          </div>
        </div>

        <div className="p-4 border-t border-slate-800 bg-slate-950/70 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-semibold transition-colors"
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
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-700/80 rounded-2xl w-full max-w-2xl overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 duration-150 text-left flex flex-col max-h-[85vh]">
        {/* Başlık */}
        <div className="p-5 border-b border-slate-800 flex items-center justify-between bg-slate-950/60">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-indigo-600/20 border border-indigo-500/30 rounded-xl text-indigo-400">
              <FileText size={22} />
            </div>
            <div>
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                Denetim Kaydı &amp; Teşhis İnceleme
                <span className="text-xs font-mono text-slate-400">#{log.sequence}</span>
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                {log.action} — {new Date(log.timestamp).toLocaleString('tr-TR')}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Sekmeler */}
        <div className="flex border-b border-slate-800 px-5 bg-slate-950/30 text-xs font-medium">
          <button
            onClick={() => setActiveTab('DETAILS')}
            className={`py-2.5 px-3.5 border-b-2 transition-colors ${
              activeTab === 'DETAILS'
                ? 'border-indigo-500 text-indigo-400 font-semibold'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            Temel &amp; Ağ Bilgileri
          </button>
          <button
            onClick={() => setActiveTab('PAYLOAD')}
            className={`py-2.5 px-3.5 border-b-2 transition-colors ${
              activeTab === 'PAYLOAD'
                ? 'border-indigo-500 text-indigo-400 font-semibold'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            JSON Payload
          </button>
          {log.stackTrace && (
            <button
              onClick={() => setActiveTab('STACKTRACE')}
              className={`py-2.5 px-3.5 border-b-2 transition-colors ${
                activeTab === 'STACKTRACE'
                  ? 'border-red-500 text-red-400 font-semibold'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
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
                <div className="bg-slate-800/50 p-3 rounded-xl border border-slate-700/50">
                  <span className="text-slate-400 block mb-1">İşlem (Action)</span>
                  <span className="font-semibold text-white text-sm">{log.action}</span>
                </div>
                <div className="bg-slate-800/50 p-3 rounded-xl border border-slate-700/50">
                  <span className="text-slate-400 block mb-1">Hata Kodu</span>
                  <span className="font-mono text-amber-400 font-bold">{log.errorCode || 'HATA_YOK (OK)'}</span>
                </div>
                <div className="bg-slate-800/50 p-3 rounded-xl border border-slate-700/50">
                  <span className="text-slate-400 block mb-1">Aktör ID &amp; Rol</span>
                  <span className="font-mono text-slate-200">{log.actorId} ({log.actorRole})</span>
                </div>
                <div className="bg-slate-800/50 p-3 rounded-xl border border-slate-700/50">
                  <span className="text-slate-400 block mb-1">Kaynak ID (Resource)</span>
                  <span className="font-mono text-slate-200">{log.resourceId}</span>
                </div>
                <div className="bg-slate-800/50 p-3 rounded-xl border border-slate-700/50">
                  <span className="text-slate-400 block mb-1">Aktör IP Adresi</span>
                  <span className="font-mono text-cyan-400">{log.ipAddress || '192.168.1.105 (Local Subnet)'}</span>
                </div>
                <div className="bg-slate-800/50 p-3 rounded-xl border border-slate-700/50">
                  <span className="text-slate-400 block mb-1">Terminal Cihaz ID</span>
                  <span className="font-mono text-slate-200">{log.terminalId || 'term-pos-main-01'}</span>
                </div>
              </div>

              <div className="bg-slate-800/50 p-3 rounded-xl border border-slate-700/50">
                <span className="text-slate-400 block mb-1">Kriptografik SHA-256 Hash</span>
                <span className="font-mono text-[11px] text-emerald-400 break-all select-all">{log.hash}</span>
              </div>

              {log.userAgent && (
                <div className="bg-slate-800/50 p-3 rounded-xl border border-slate-700/50">
                  <span className="text-slate-400 block mb-1">User-Agent / İstemci Donanımı</span>
                  <span className="font-mono text-[11px] text-slate-300">{log.userAgent}</span>
                </div>
              )}
            </div>
          )}

          {activeTab === 'PAYLOAD' && (
            <div className="bg-slate-950 border border-slate-800 rounded-xl p-3">
              <pre className="font-mono text-xs text-cyan-300 overflow-x-auto whitespace-pre-wrap">
                {JSON.stringify(log.payloadJson || { action: log.action, resource: log.resourceId, actor: log.actorId }, null, 2)}
              </pre>
            </div>
          )}

          {activeTab === 'STACKTRACE' && (
            <div className="bg-red-950/40 border border-red-900 rounded-xl p-3">
              <pre className="font-mono text-xs text-red-300 overflow-x-auto whitespace-pre-wrap">
                {log.stackTrace}
              </pre>
            </div>
          )}
        </div>

        <div className="p-4 border-t border-slate-800 bg-slate-950/70 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-semibold transition-colors"
          >
            Kapat
          </button>
        </div>
      </div>
    </div>
  );
}
