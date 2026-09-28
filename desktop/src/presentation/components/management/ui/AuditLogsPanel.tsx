import { useState, useEffect } from 'react';
import { tauriInvoke as invoke } from '../../../../data/ipc/tauriInvoke';
import { Shield, Activity, Clock, Hash, User } from 'lucide-react';

export interface AuditLogDto {
    id: string;
    sequence: number;
    timestamp: string;
    actor_id: string;
    action: string;
    resource_id: string;
    current_hash: string;
}

export function AuditLogsPanel() {
    const [logs, setLogs] = useState<AuditLogDto[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const fetchLogs = async () => {
        setIsLoading(true);
        setError(null);
        try {
            const data = await invoke<AuditLogDto[]>('get_audit_logs');
            setLogs(Array.isArray(data) ? data : []);
        } catch (err) {
            console.error('Failed to fetch audit logs:', err);
            setError('Denetim kayıtları yüklenemedi veya henüz kayıt oluşturulmadı.');
            setLogs([]);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchLogs();
    }, []);

    return (
        <div className="flex flex-1 flex-col overflow-hidden p-6 text-foreground">
            <div className="mb-6 flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <Shield className="text-[#007AFF]" size={28} />
                    <h1 className="text-2xl font-bold tracking-tight dark:text-white text-zinc-900">Sistem Logları (Immutable Ledger)</h1>
                </div>
                <button
                    onClick={fetchLogs}
                    className="rounded-2xl backdrop-blur-md dark:bg-white/5 bg-black/5 px-4 py-2 text-xs font-semibold dark:text-zinc-300 text-zinc-700 transition-all hover:dark:bg-white/10 hover:bg-black/10 active:scale-95 touch-manipulation border dark:border-white/10 border-black/[0.08] shadow-xs cursor-pointer"
                >
                    Yenile
                </button>
            </div>

            <div className="flex-1 overflow-auto rounded-3xl border dark:border-white/10 border-black/[0.08] backdrop-blur-xl dark:bg-white/[0.03] bg-white/80 shadow-sm custom-scrollbar">
                {isLoading ? (
                    <div className="flex h-full items-center justify-center dark:text-zinc-400 text-zinc-500">Yükleniyor...</div>
                ) : error ? (
                    <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center dark:text-zinc-400 text-zinc-500">
                        <p className="text-sm">{error}</p>
                        <button
                            onClick={fetchLogs}
                            className="text-xs text-[#007AFF] underline hover:text-[#007AFF]/80 cursor-pointer"
                        >
                            Yeniden dene
                        </button>
                    </div>
                ) : (
                    <table className="w-full text-left text-sm dark:text-zinc-300 text-zinc-700">
                        <thead className="sticky top-0 dark:bg-white/[0.04] bg-black/[0.02] backdrop-blur text-xs uppercase dark:text-zinc-400 text-zinc-600 border-b dark:border-white/10 border-black/[0.08]">
                            <tr>
                                <th className="px-6 py-4 font-semibold"><div className="flex items-center gap-2"><Activity size={14} /> Sequence</div></th>
                                <th className="px-6 py-4 font-semibold"><div className="flex items-center gap-2"><Clock size={14} /> Timestamp</div></th>
                                <th className="px-6 py-4 font-semibold"><div className="flex items-center gap-2"><User size={14} /> Actor</div></th>
                                <th className="px-6 py-4 font-semibold">Action</th>
                                <th className="px-6 py-4 font-semibold">Resource</th>
                                <th className="px-6 py-4 font-semibold"><div className="flex items-center gap-2"><Hash size={14} /> Hash</div></th>
                            </tr>
                        </thead>
                        <tbody className="divide-y dark:divide-white/10 divide-black/[0.06]">
                            {logs.length === 0 ? (
                                <tr><td colSpan={6} className="px-6 py-8 text-center dark:text-zinc-400 text-zinc-500">Kayıt bulunamadı.</td></tr>
                            ) : (
                                logs.map(log => (
                                    <tr key={log.id} className="transition-colors hover:dark:bg-white/[0.04] hover:bg-black/[0.02]">
                                        <td className="px-6 py-3 font-mono text-xs text-[#007AFF] font-semibold">#{log.sequence}</td>
                                        <td className="px-6 py-3 whitespace-nowrap dark:text-zinc-400 text-zinc-600 text-xs">{new Date(log.timestamp).toLocaleString()}</td>
                                        <td className="px-6 py-3 font-semibold dark:text-white text-zinc-900">{log.actor_id}</td>
                                        <td className="px-6 py-3">
                                            <span className="rounded-full dark:bg-white/5 bg-black/5 px-2.5 py-1 text-xs font-semibold dark:text-zinc-300 text-zinc-700 border dark:border-white/10 border-black/[0.08]">
                                                {log.action}
                                            </span>
                                        </td>
                                        <td className="px-6 py-3 font-mono text-xs dark:text-zinc-400 text-zinc-600">{log.resource_id}</td>
                                        <td className="px-6 py-3 font-mono text-[10px] dark:text-zinc-400 text-zinc-500 truncate max-w-[150px]" title={log.current_hash}>
                                            {log.current_hash}
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                )}
            </div>
        </div>
    );
}
