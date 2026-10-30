import { create } from 'zustand';
import { invokeIPC, isTauri } from '../services/tauriClient';
import { sessionArgs } from './cariStore';

export type SyncState = 'READY' | 'SYNCING' | 'NO_CONNECTION' | 'VERIFYING' | 'INTERVENTION';

export interface SyncMember {
  deviceId: string;
  name: string;
  connected: boolean;
  isAuthority: boolean;
  isLocal: boolean;
  acknowledgedIndex?: number | null;
  lastSeen?: string | null;
}

export interface SyncStatus {
  mode: 'SINGLE' | 'CLUSTER';
  state: SyncState;
  role?: 'FOLLOWER' | 'CANDIDATE' | 'LEADER' | null;
  term: number;
  commitIndex: number;
  detail?: string | null;
  members: SyncMember[];
}

interface SyncStore {
  status: SyncStatus | null;
  statusError: string | null;
  refresh: () => Promise<void>;
  createPairingCode: (deviceName: string) => Promise<{ code: string; expiresAt: string }>;
  joinCluster: (code: string, deviceName: string) => Promise<void>;
  setDevicePassive: (deviceId: string) => Promise<void>;
}

export const SYNC_STATE_LABEL: Record<SyncState, string> = {
  READY: 'Hazır',
  SYNCING: 'Eşitleniyor',
  NO_CONNECTION: 'Bağlantı yok',
  VERIFYING: 'İşlem sonucu doğrulanıyor',
  INTERVENTION: 'Müdahale gerekli',
};

export const useSyncStore = create<SyncStore>((set, get) => ({
  status: null,
  statusError: null,

  refresh: async () => {
    // Tarayıcı önizlemesinde eşitleme yoktur; sahte "hazır" gösterilmez.
    if (!isTauri()) return;
    try {
      const { actorRole } = sessionArgs();
      const status = await invokeIPC<SyncStatus>('get_sync_status', { actorRole });
      set({ status, statusError: null });
    } catch (error) {
      set({ status: null, statusError: String(error) });
    }
  },

  createPairingCode: async (deviceName) => {
    const { actorRole, tenantId } = sessionArgs();
    const result = await invokeIPC<{ code: string; expiresAt: string }>('create_pairing_code', {
      actorRole,
      tenantId,
      deviceName,
    });
    await get().refresh();
    return result;
  },

  joinCluster: async (code, deviceName) => {
    const { actorRole, tenantId } = sessionArgs();
    await invokeIPC('join_cluster', { actorRole, tenantId, code, deviceName });
    await get().refresh();
  },

  setDevicePassive: async (deviceId) => {
    const { actorRole, actorId, tenantId } = sessionArgs();
    await invokeIPC('set_device_passive', { actorRole, actorId, tenantId, deviceId });
    await get().refresh();
  },
}));
