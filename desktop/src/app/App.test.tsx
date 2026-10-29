import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { App } from './App';
import { useAuthStore } from '../stores/authStore';

describe('iş istasyonu erişimi', () => {
  it('girişsiz operasyon ekranlarını oluşturmaz', () => {
    useAuthStore.getState().logout();
    const html = renderToStaticMarkup(<App />);
    expect(html).toContain('Personel Girişi');
    expect(html).not.toContain('Ana Menü');
  });
});
