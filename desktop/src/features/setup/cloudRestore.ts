import { listen } from '@tauri-apps/api/event';
import { invokeIPC } from '../../services/tauriClient';
import { useDeviceSessionStore } from '../../stores/deviceSessionStore';
import { useLicenseStore } from '../../stores/licenseStore';
import { useSetupStore } from '../../stores/setupStore';

interface RestoreOutcome {
  restored: boolean;
  tenantId: string | null;
  rows: number;
  skippedAuditRows: number;
}

interface RestoreProgress {
  phase: 'DOWNLOADING' | 'WRITING' | 'DONE';
  rows: number;
}

/** Geri yükleme aşamasının hatası `KOD: mesaj` biçimindedir; bağlama hatası düz metindir. */
const RESTORE_STAGE_ERROR = /^[A-Z][A-Z_]+: /;

/**
 * Boş kasada hesapla giriş: işletme buluttaysa indirilir ve kasa açılır (`true`).
 * Hesabın buluta yazılmış işletmesi yoksa `false` döner, kurulum sürer. Bağlama aşaması
 * düşerse (şifre, doğrulanmamış e-posta) kurulum akışı kendi mesajıyla devam eder; indirme
 * yarıda kalırsa hata yükselir: buluttaki işletmenin üstüne yeni işletme kurulmamalı.
 */
export async function restoreFromCloud(
  email: string,
  password: string,
  onRows: (rows: number) => void,
): Promise<boolean> {
  const stop = await listen<RestoreProgress>('cloud-restore-progress', (event) => onRows(event.payload.rows));
  try {
    const outcome = await invokeIPC<RestoreOutcome>('cloud_restore', { email, password });
    if (!outcome.restored) return false;
    await Promise.all([
      useSetupStore.getState().load(),
      useDeviceSessionStore.getState().load(),
      useLicenseStore.getState().load(),
    ]);
    return true;
  } catch (caught) {
    if (RESTORE_STAGE_ERROR.test(String(caught).replace(/^Error: /, ''))) throw caught;
    return false;
  } finally {
    stop();
  }
}

export interface CloudTenant {
  tenantId: string;
  name: string;
}

/** Boş kasada, bağlanan hesabın sahibi olduğu işletmeler; liste sunucudan gelir. */
export const listCloudTenants = () => invokeIPC<CloudTenant[]>('list_cloud_tenants');

/**
 * Seçilen mevcut işletmeye bu kasayı bağlar ve verisini indirir (`true`). Bulutta henüz kasa
 * verisi yoksa `false` döner; kurulum aynı işletme adına sürer. Hata yükselir: cihaz sınırı,
 * yetki veya yarım indirme kurulumu sessizce yeni işletmeye çevirmez.
 */
export async function restoreTenant(tenantId: string, email: string, onRows: (rows: number) => void): Promise<boolean> {
  const stop = await listen<RestoreProgress>('cloud-restore-progress', (event) => onRows(event.payload.rows));
  try {
    const outcome = await invokeIPC<RestoreOutcome>('cloud_restore_tenant', { tenantId, email });
    if (!outcome.restored) return false;
    await Promise.all([
      useSetupStore.getState().load(),
      useDeviceSessionStore.getState().load(),
      useLicenseStore.getState().load(),
    ]);
    return true;
  } finally {
    stop();
  }
}
