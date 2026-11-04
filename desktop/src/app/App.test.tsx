import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { App } from './App';
import { LoginOverlay } from '../features/auth/LoginOverlay';
import { SetupGate } from '../features/setup/SetupGate';
import { canUseOperations } from './access';

describe('iş istasyonu erişimi', () => {
  it('kurulum durumu bilinmeden kimlik ekranı açmaz', () => {
    const html = renderToStaticMarkup(<App />);
    expect(html).not.toContain('PIN kodunu gir');
    expect(html).not.toContain('Ana Menü');
  });

  it('kurulmamış cihazda personel girişi değil hesap girişini gösterir', () => {
    const html = renderToStaticMarkup(<SetupGate phase="PENDING" error={null} onRetry={() => undefined} />);
    expect(html).toContain('E-posta');
    expect(html).toContain('Kayıt Ol');
    expect(html).not.toContain('PIN kodunu gir');
  });

  it('durum okunamazsa girişe düşmez', () => {
    const html = renderToStaticMarkup(<SetupGate phase="ERROR" error="disk" onRetry={() => undefined} />);
    expect(html).toContain('Kurulum durumu okunamadı');
    expect(html).not.toContain('PIN kodunu gir');
  });

  it('oturum yokken giriş ekranı açılır', () => {
    expect(renderToStaticMarkup(<LoginOverlay />)).toContain('PIN kodunu gir');
  });

  it('platform hesabına POS ekranlarını açmaz', () => {
    expect(canUseOperations('MASTER')).toBe(false);
    expect(canUseOperations('OWNER')).toBe(true);
  });
});
