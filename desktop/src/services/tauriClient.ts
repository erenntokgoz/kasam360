import { invoke } from '@tauri-apps/api/core';

const SYNC_RETRY_LIMIT = 6;
const RETRYABLE = /^(SYNC_RETRY|QUORUM_LOST)/;
const SYNC_RETRY_DELAY_MS = 40;

// Tauri ortamında mıyız kontrolü
export const isTauri = (): boolean => {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
};

/**
 * Tek IPC kapısı. Tarayıcıda sahte yanıt üretilmez: sahte tutar gerçek ekrandaki
 * kablolama hatalarını saklıyordu.
 */
export async function invokeIPC<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
  if (!isTauri()) {
    throw new Error('Bu işlem için masaüstü uygulaması gerekli.');
  }
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await invoke<T>(command, args);
    } catch (error) {
      // İşlem hiç uygulanmadı: başka cihaz aynı anda yazdı ya da otorite el değiştiriyor.
      if (attempt < SYNC_RETRY_LIMIT && RETRYABLE.test(String(error))) {
        await new Promise((resolve) => setTimeout(resolve, attempt * SYNC_RETRY_DELAY_MS));
        continue;
      }
      console.warn(`[IPC ERROR] ${command}:`, error);
      throw error;
    }
  }
}
