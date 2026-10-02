
import React from 'react';
import { renderToString } from 'react-dom/server';
import { GlobalNav } from '../../src/presentation/components/layout/GlobalNav';
import { AppShell } from '../../src/presentation/components/layout/AppShell';
import { TopHeader } from '../../src/presentation/components/layout/TopHeader';
import { useAuthStore } from '../../src/presentation/store/useAuthStore';
import { useCartStore } from '../../src/presentation/store/useCartStore';

/**
 * Milestone 1 — Global Navigasyon & Shell & macOS Glassmorphism Tasarım Doğrulama Testi
 */
// Node/SSR ortamında Zustand 5 snapshot'larının güncel state ile çalışması için
// @ts-expect-error React useSyncExternalStore mock for SSR testing
React.useSyncExternalStore = (subscribe: any, getSnapshot: any) => getSnapshot();

describe('Milestone 1 — Global Navigasyon & macOS Frosted Glass UI', () => {
  beforeEach(() => {
    // Zustand 5 SSR senkronizasyonu: renderToString sırasında getState verilerinin okunması için getInitialState bağlanır
    (useAuthStore as any).getInitialState = () => useAuthStore.getState();
    (useCartStore as any).getInitialState = () => useCartStore.getState();

    useAuthStore.setState({
      user: {
        userId: 'usr_waiter_test',
        role: 'WAITER',
        name: 'Garson Test',
        tenantId: 'test_tenant',
        branchId: 'test_branch',
        branchName: 'Kadıköy Şubesi',
      },
      isAuthenticated: true,
      isLocked: false,
    });
    useCartStore.setState({
      currentView: 'FLOOR',
      activeTableId: null,
    });
  });

  it('1. GlobalNav dikeyde ortalanmış, bağımsız süzülen (my-auto, self-center, z-40) rounded-3xl lüks cam kapsül sınıflarını içerir', () => {
    const html = renderToString(React.createElement(GlobalNav));
    expect(html).toBeDefined();

    // macOS Frosted Glass & Floating Pill sınıfları
    expect(html).toContain('backdrop-blur-2xl');
    expect(html).toContain('dark:bg-white/[0.04]');
    expect(html).toContain('bg-white/80');
    expect(html).toContain('dark:border-white/10');
    expect(html).toContain('rounded-3xl');
    expect(html).toContain('my-auto');
    expect(html).toContain('self-center');
    expect(html).toContain('z-40');
    expect(html).toContain('max-h-[calc(100vh-theme(spacing.20))]');
  });

  it('2. Bağımsız POS sekmesi GlobalNav menüsünden tamamen kaldırılmıştır', () => {
    const html = renderToString(React.createElement(GlobalNav));
    expect(html).toBeDefined();

    // HTML çıktısında bağımsız POS butonu ve etiketi olmamalıdır
    expect(html).not.toContain('>POS<');
    expect(html).not.toContain('aria-label="POS"');

    // Masalar sekmesi mevcut olmalıdır
    expect(html).toContain('Masalar');
    expect(html).toContain('aria-label="Masalar"');
  });

  it('3. TopHeader macOS frosted glass sınıflarını (backdrop-blur-2xl dark:bg-white/[0.03] bg-white/80 rounded-2xl) ve ferah ölçekleri (h-14 px-5) içerir', () => {
    const html = renderToString(React.createElement(TopHeader));
    expect(html).toBeDefined();

    expect(html).toContain('backdrop-blur-2xl');
    expect(html).toContain('dark:bg-white/[0.03]');
    expect(html).toContain('bg-white/80');
    expect(html).toContain('rounded-2xl');
    expect(html).toContain('mx-3.5');
    expect(html).toContain('mt-3.5');
    expect(html).toContain('h-14');
    expect(html).toContain('px-5');
  });

  it('4. AppShell esnek dikey mimariyi (items-center, p-3.5 gap-3.5) ve yüzen cam ada yapısını sağlar', () => {
    const shell = AppShell({
      children: React.createElement('div', { id: 'test-content' }, 'Main Content'),
    });
    expect(shell).toBeDefined();

    const innerDiv = shell.props.children[1];
    expect(innerDiv.props.className).toContain('items-center');
    expect(innerDiv.props.className).toContain('p-3.5');
    expect(innerDiv.props.className).toContain('gap-3.5');

    const mainElement = innerDiv.props.children[1];
    expect(mainElement.props.className).toContain('self-stretch');
    expect(mainElement.props.className).toContain('h-full');
    expect(mainElement.props.className).toContain('rounded-3xl');
  });

  it('5. POS ekranındayken Masalar sekmesi aktif olarak işaretlenir (Sipariş sürecinin Masalar ile bağı)', () => {
    // Garson masadan sipariş oluşturma (POS) görünümündeyken
    useCartStore.setState({ currentView: 'POS' });
    const html = renderToString(React.createElement(GlobalNav));

    // Masalar NavItem bileşeni active=true olmalı ve sayfa olarak aria-current işaretlenmeli
    expect(html).toContain('aria-label="Masalar" aria-current="page"');
    // Aktif Apple vurgulama çizgisi bulunmalı
    expect(html).toContain('rounded-r-full bg-[#007AFF]');
  });

  it('6. TopHeader POS ekranındayken Masalara dönüş butonu görüntüler, normalde gizler', () => {
    // 1. FLOOR görünümünde Masalar dönüş butonu olmamalıdır
    useCartStore.setState({ currentView: 'FLOOR' });
    let headerHtml = renderToString(React.createElement(TopHeader));
    expect(headerHtml).not.toContain('Masalar Ekranına Dön');

    // 2. POS görünümüne geçildiğinde sol tarafta Masalar dönüş butonu belirmelidir
    useCartStore.setState({ currentView: 'POS' });
    headerHtml = renderToString(React.createElement(TopHeader));
    expect(headerHtml).toContain('Masalar Ekranına Dön');
    expect(headerHtml).toContain('Masalar');
  });

  it('7. NavItem butonları geçersiz w-13 yerine tam genişlikli w-full ve tutarlı Apple pill stili kullanır', () => {
    const html = renderToString(React.createElement(GlobalNav));
    // Geçersiz sınıfın tamamen temizlendiğini doğrula
    expect(html).not.toContain('w-13');
    // Standart genişlik sınıfının uygulandığını doğrula
    expect(html).toContain('w-full');
  });

  it('8. Farklı roller için GlobalNav menü görünürlüğü AGENTS.md yetki matrisine uyar', () => {
    // OWNER rolü: Masalar, Kasa, KDS, Hesap Defteri ve İşletme (Yönetim doğrudan İşletme içine konsolide edilmiştir).
    // Faz 7: ayrı "Fişler" ekranı kaldırıldı; fiş, Hesap Defteri içindeki tahsilat satırından açılır.
    useAuthStore.setState({
      user: {
        userId: 'usr_owner',
        role: 'OWNER',
        name: 'Patron',
        tenantId: 'test_tenant',
        branchId: 'test_branch',
      },
    });
    let html = renderToString(React.createElement(GlobalNav));
    expect(html).toContain('Masalar');
    expect(html).toContain('Kasa');
    // Faz 7: ayrı "Fişler" ekranı kaldırıldı; fiş, Hesap Defteri içindeki
    // tahsilat satırından açılan penceredir.
    expect(html).not.toContain('Fişler');
    expect(html).toContain('KDS');
    expect(html).toContain('Hesap Defteri');
    expect(html).toContain('İşletme');
    expect(html).not.toContain('Yönetim');
    expect(html).not.toContain('>POS<');

    // MANAGER rolü: Yönetim menüsünü görür, İşletme menüsünü görmez
    useAuthStore.setState({
      user: {
        userId: 'usr_manager',
        role: 'MANAGER',
        name: 'Müdür',
        tenantId: 'test_tenant',
        branchId: 'test_branch',
      },
    });
    html = renderToString(React.createElement(GlobalNav));
    expect(html).toContain('Yönetim');
    expect(html).not.toContain('İşletme');

    // KITCHEN rolü: Sadece KDS
    useAuthStore.setState({
      user: {
        userId: 'usr_kitchen',
        role: 'KITCHEN',
        name: 'Mutfak',
        tenantId: 'test_tenant',
        branchId: 'test_branch',
      },
    });
    html = renderToString(React.createElement(GlobalNav));
    expect(html).toContain('KDS');
    expect(html).not.toContain('Masalar');
    expect(html).not.toContain('Kasa');
    expect(html).not.toContain('İşletme');
  });
});
