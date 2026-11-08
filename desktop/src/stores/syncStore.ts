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
  setDevicePassive: (deviceId: string) => Promise<void>;
  takeOver: (pin: string) => Promise<void>;
}

export const SYNC_STATE_LABEL: Record<SyncState, string> = {
  READY: 'Hazır',
  SYNCING: 'Eşitleniyor',
  NO_CONNECTION: 'Bağlantı yok',
  VERIFYING: 'İşlem sonucu doğrulanıyor',
  INTERVENTION: 'Müdahale gerekli',
};

type DeviceOutcome = { status: 'APPLIED' | 'PENDING' | 'REJECTED' | 'UNKNOWN'; error?: string | null };

function requireApplied(outcome: DeviceOutcome) {
  if (outcome.status !== 'APPLIED') {
    throw new Error(outcome.error || 'İşlem doğrulanamadı. Yeniden denemeden önce cihaz listesini yenileyin.');
  }
}

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

  setDevicePassive: async (deviceId) => {
    const { actorRole, actorId, tenantId } = sessionArgs();
    const outcome = await invokeIPC<DeviceOutcome>('set_device_passive', { actorRole, actorId, tenantId, deviceId });
    await get().refresh();
    requireApplied(outcome);
  },

  takeOver: async (pin) => {
    const { tenantId } = sessionArgs();
    const outcome = await invokeIPC<DeviceOutcome>('take_over_device', { pin, tenantId });
    await get().refresh();
    requireApplied(outcome);
  },
}));
