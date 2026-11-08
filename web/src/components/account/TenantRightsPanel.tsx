'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { tenantRequest, TenantRequestError } from '@/lib/tenantApi';
import { FormError } from './FormParts';

interface Entitlement {
  tenantId: string;
  status: 'active' | 'inactive' | 'conflict';
  source: 'subscription' | 'manual' | 'none';
  packageId: string | null;
  packageVersion: number | null;
  featureKeys: string[];
  deviceLimit: number;
  validFrom: string | null;
  validUntil: string | null;
}

interface Device {
  deviceId: string;
  label: string;
  platform: 'windows';
  status: 'active' | 'revoked';
  registeredAt: string;
}

const FEATURE_NAMES: Record<string, string> = {
  feat_kds: 'Mutfak ekranı',
  feat_qr_menu: 'QR menü',
  feat_delivery: 'Paket servis',
  feat_caller_id: 'Arayan numara',
  feat_table_order: 'Masa siparişi',
  feat_seat_split: 'Sandalye bazlı bölme',
  feat_recipe_bom: 'Reçete ve stok maliyeti',
  feat_dynamic_pricing: 'Dinamik fiyat',
  feat_ledger_cari: 'Cari hesap',
  feat_multi_branch: 'Çoklu şube',
  feat_loss_radar: 'Fire ve iptal radarı',
};

const SOURCE_NAMES = { subscription: 'Abonelik', manual: 'Manuel hak (pilot)', none: 'Hak yok' } as const;

function date(value: string | null) {
  return value ? new Date(value).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' }) : '—';
}

function failureText(caught: unknown, fallback: string) {
  if (caught instanceof TenantRequestError && caught.status === 401) return 'Oturumunuz sona erdi. Tekrar giriş yapın.';
  if (caught instanceof TenantRequestError && caught.status === 404) return 'Bu işletme için yetkiniz yok veya kayıt bulunamadı.';
  return caught instanceof Error ? caught.message : fallback;
}

export function TenantRightsPanel({ tenantId }: { tenantId: string }) {
  const [rights, setRights] = useState<Entitlement | null>(null);
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [rightsError, setRightsError] = useState('');
  const [devicesError, setDevicesError] = useState('');
  const [confirmId, setConfirmId] = useState('');
  const [revokingId, setRevokingId] = useState('');
  const [notice, setNotice] = useState('');

  // Yalnız son isteğin cevabı ekrana yazılır; işletme değişince veya tekrar yüklenince eski cevap
  // yeni durumun üzerine hata ya da başka işletmenin hakkı olarak düşmez.
  const requestId = useRef(0);
  const load = useCallback(async () => {
    const id = ++requestId.current;
    const current = () => id === requestId.current;
    const base = `/v1/tenants/${encodeURIComponent(tenantId)}`;
    setRights(null); setDevices(null); setRightsError(''); setDevicesError('');
    await Promise.all([
      tenantRequest<Entitlement>(`${base}/entitlement`).then((value) => { if (current()) setRights(value); })
        .catch((caught: unknown) => { if (current()) setRightsError(failureText(caught, 'İşletme hakları alınamadı.')); }),
      tenantRequest<{ devices: Device[] }>(`${base}/devices`).then((result) => { if (current()) setDevices(result.devices); })
        .catch((caught: unknown) => { if (current()) setDevicesError(failureText(caught, 'Cihaz kayıtları alınamadı.')); }),
    ]);
  }, [tenantId]);

  useEffect(() => { setNotice(''); setConfirmId(''); void load(); }, [load]);

  const revoke = async (device: Device) => {
    setRevokingId(device.deviceId); setDevicesError(''); setNotice('');
    try {
      await tenantRequest(`/v1/tenants/${encodeURIComponent(tenantId)}/devices/${encodeURIComponent(device.deviceId)}/revoke`, { method: 'POST' });
      setNotice(`${device.label} iptal edildi. Bu kasa yeni işlem gönderemez; yerindeki kayıtlar silinmez.`);
      setConfirmId('');
      await load();
    } catch (caught) {
      setDevicesError(failureText(caught, 'Cihaz iptal edilemedi.'));
    } finally { setRevokingId(''); }
  };

  const activeDevices = devices?.filter((device) => device.status === 'active').length ?? 0;

  return (
    <section className="k-stack" aria-labelledby="rights-heading">
      <h3 id="rights-heading" className="k-section-title" style={{ marginBottom: 0 }}>Paket ve cihazlar</h3>
      {!rights && !rightsError && <p className="k-muted" role="status">Haklar yükleniyor…</p>}
      {rightsError && (
        <div className="k-stack">
          <FormError message={rightsError} />
          <div className="k-row"><button type="button" className="k-btn k-btn-line" onClick={() => void load()}>Tekrar dene</button></div>
        </div>
      )}
      {rights && rights.status !== 'active' && (
        <p className="k-alert" role="note">
          {rights.status === 'conflict'
            ? 'Bu işletmenin hak kaydında çakışma var. Kasalar yeni lisans alamaz; destek ekibine yazın.'
            : 'Bu işletmenin etkin paketi yok. Kasalar etkinleştirilemez ve lisans yenilenemez.'}
        </p>
      )}
      {rights && rights.status === 'active' && (
        <dl className="k-stack" style={{ margin: 0 }}>
          <div><dt className="k-field-hint">Kaynak</dt><dd style={{ margin: 0 }}><strong>{SOURCE_NAMES[rights.source]}</strong></dd></div>
          <div><dt className="k-field-hint">Geçerlilik</dt><dd style={{ margin: 0 }} className="tabular-nums">{date(rights.validFrom)} – {date(rights.validUntil)}</dd></div>
          <div><dt className="k-field-hint">Cihaz</dt><dd style={{ margin: 0 }} className="tabular-nums">{devices ? `${activeDevices} / ${rights.deviceLimit} etkin` : `${rights.deviceLimit} cihaz sınırı`}</dd></div>
          <div>
            <dt className="k-field-hint">Açık özellikler</dt>
            <dd style={{ margin: 0 }}>
              {rights.featureKeys.length === 0 ? 'Ek özellik yok'
                : rights.featureKeys.map((key) => FEATURE_NAMES[key] ?? key).join(' · ')}
            </dd>
          </div>
        </dl>
      )}
      {rights?.status === 'active' && (
        <p className="k-field-hint">Değişiklikler kasa lisansını yenilediğinde uygulanır. İnternetsiz kasa mevcut lisansını süresi bitene kadar kullanır.</p>
      )}

      {!devices && !devicesError && <p className="k-muted" role="status">Cihazlar yükleniyor…</p>}
      {devicesError && <FormError message={devicesError} />}
      {devices && devices.length === 0 && <p className="k-empty">Bu işletmede etkinleştirilmiş kasa yok. Kasa uygulamasında bu hesapla giriş yapıp işletmeyi seçin.</p>}
      {devices && devices.length > 0 && (
        <ul className="k-stack" style={{ listStyle: 'none', padding: 0, margin: 0 }} aria-label="Kasalar">
          {devices.map((device) => (
            <li key={device.deviceId} className="k-panel k-stack">
              <p style={{ margin: 0 }}><strong>{device.label}</strong> · {device.status === 'active' ? 'Etkin' : 'İptal edildi'}</p>
              <p className="k-field-hint" style={{ margin: 0 }}>Kayıt: {date(device.registeredAt)} · {device.deviceId}</p>
              {device.status === 'active' && confirmId !== device.deviceId && (
                <div className="k-row"><button type="button" className="k-btn k-btn-line" onClick={() => setConfirmId(device.deviceId)}>Cihazı iptal et</button></div>
              )}
              {confirmId === device.deviceId && (
                <div className="k-stack" role="group" aria-label={`${device.label} iptal onayı`}>
                  <p className="k-alert" role="note">İptal edilen kasa yeniden etkinleştirilene kadar satış verisi gönderemez.</p>
                  <div className="k-row">
                    <button type="button" className="k-btn k-btn-ink" disabled={revokingId !== ''} onClick={() => void revoke(device)}>
                      {revokingId === device.deviceId ? 'İptal ediliyor…' : 'İptali onayla'}
                    </button>
                    <button type="button" className="k-btn k-btn-line" disabled={revokingId !== ''} onClick={() => setConfirmId('')}>Vazgeç</button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {notice && <p className="k-notice" role="status">{notice}</p>}
    </section>
  );
}
