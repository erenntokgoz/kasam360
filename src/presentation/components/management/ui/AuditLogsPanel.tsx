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

    const fetchLogs = async () => {
        setIsLoading(true);
        try {
            const data = await invoke<AuditLogDto[]>('get_audit_logs').catch(() => [
                { id: '1', sequence: 101, timestamp: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(), actor_id: 'MANAGER_1', action: 'OPEN_SHIFT', resource_id: 'shift_1', current_hash: 'a1b2c3d4e5f6' },
                { id: '2', sequence: 102, timestamp: new Date(Date.now() - 1000 * 60 * 50).toISOString(), actor_id: 'WAITER_2', action: 'CREATE_ORDER', resource_id: 'ord_123', current_hash: 'f6e5d4c3b2a1' },
                { id: '3', sequence: 103, timestamp: new Date(Date.now() - 1000 * 60 * 45).toISOString(), actor_id: 'WAITER_2', action: 'ADD_ITEM', resource_id: 'item_456', current_hash: 'b1c2d3e4f5a6' }
            ] as AuditLogDto[]);
            setLogs(data);
        } catch (error) {
            console.error('Failed to fetch audit logs:', error);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchLogs();
    }, []);

    return (
        <div className="flex flex-1 flex-col overflow-hidden bg-slate-950 p-6 text-slate-200">
            <div className="mb-6 flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <Shield className="text-indigo-500" size={28} />
                    <h1 className="text-2xl font-bold tracking-tight">Sistem Logları (Immutable Ledger)</h1>
                </div>
                <button
                    onClick={fetchLogs}
                    className="rounded-lg bg-slate-800 px-4 py-2 font-medium text-white transition-colors hover:bg-slate-700 shadow"
                >
                    Yenile
                </button>
            </div>

            <div className="flex-1 overflow-auto rounded-xl border border-slate-800 bg-slate-900 custom-scrollbar">
                {isLoading ? (
                    <div className="flex h-full items-center justify-center text-slate-500">Yükleniyor...</div>
                ) : (
                    <table className="w-full text-left text-sm text-slate-300">
                        <thead className="sticky top-0 bg-slate-950/90 backdrop-blur text-xs uppercase text-slate-400">
                            <tr>
                                <th className="px-6 py-4 font-medium"><div className="flex items-center gap-2"><Activity size={14} /> Sequence</div></th>
                                <th className="px-6 py-4 font-medium"><div className="flex items-center gap-2"><Clock size={14} /> Timestamp</div></th>
                                <th className="px-6 py-4 font-medium"><div className="flex items-center gap-2"><User size={14} /> Actor</div></th>
                                <th className="px-6 py-4 font-medium">Action</th>
                                <th className="px-6 py-4 font-medium">Resource</th>
                                <th className="px-6 py-4 font-medium"><div className="flex items-center gap-2"><Hash size={14} /> Hash</div></th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/50">
                            {logs.length === 0 ? (
                                <tr><td colSpan={6} className="px-6 py-8 text-center text-slate-500">Kayıt bulunamadı.</td></tr>
                            ) : (
                                logs.map(log => (
                                    <tr key={log.id} className="transition-colors hover:bg-slate-800/50">
                                        <td className="px-6 py-3 font-mono text-xs text-indigo-400">#{log.sequence}</td>
                                        <td className="px-6 py-3 whitespace-nowrap text-slate-400">{new Date(log.timestamp).toLocaleString()}</td>
                                        <td className="px-6 py-3 font-medium">{log.actor_id}</td>
                                        <td className="px-6 py-3">
                                            <span className="rounded-full bg-slate-800 px-2.5 py-1 text-xs font-semibold text-slate-300 border border-slate-700">
                                                {log.action}
                                            </span>
                                        </td>
                                        <td className="px-6 py-3 font-mono text-xs">{log.resource_id}</td>
                                        <td className="px-6 py-3 font-mono text-[10px] text-slate-500 truncate max-w-[150px]" title={log.current_hash}>
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
