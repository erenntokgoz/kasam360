import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { App } from './App';
import { LoginOverlay } from '../features/auth/LoginOverlay';
import { SetupGate } from '../features/setup/SetupGate';
import { canUseOperations } from './access';

describe('iş istasyonu erişimi', () => {
  it('kurulum durumu bilinmeden kimlik ekranı açmaz', () => {
    const html = renderToStaticMarkup(<App />);
    expect(html).not.toContain('Personel Girişi');
    expect(html).not.toContain('Ana Menü');
  });

  it('kurulmamış cihazda girişi değil kurulum seçimini gösterir', () => {
    const html = renderToStaticMarkup(<SetupGate phase="PENDING" error={null} onRetry={() => undefined} />);
    expect(html).toContain('Yeni işletme kur');
    expect(html).toContain('Mevcut işletmeye cihaz bağla');
    expect(html).not.toContain('Personel Girişi');
  });

  it('durum okunamazsa girişe düşmez', () => {
    const html = renderToStaticMarkup(<SetupGate phase="ERROR" error="disk" onRetry={() => undefined} />);
    expect(html).toContain('Kurulum durumu okunamadı');
    expect(html).not.toContain('Personel Girişi');
  });

  it('oturum yokken giriş ekranı açılır', () => {
    expect(renderToStaticMarkup(<LoginOverlay />)).toContain('Personel Girişi');
  });

  it('platform hesabına POS ekranlarını açmaz', () => {
    expect(canUseOperations('MASTER')).toBe(false);
    expect(canUseOperations('OWNER')).toBe(true);
  });
});
