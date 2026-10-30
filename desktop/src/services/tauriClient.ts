import { invoke } from '@tauri-apps/api/core';

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
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    console.warn(`[IPC ERROR] ${command}:`, error);
    throw error;
  }
}
