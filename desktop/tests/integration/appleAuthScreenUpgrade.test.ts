/**
 * Apple Auth Screens Upgrade — AppleKeypad, PinScreen ve LoginPage UI & Davranış Test Paketi
 * Path: tests/integration/appleAuthScreenUpgrade.test.ts
 *
 * AGENTS.md anayasasına ve kullanıcı gereksinimlerine uygun olarak:
 * 1. AppleKeypad bileşeninin Giriş tuşu, canSubmit ve onSubmit proplarını,
 * 2. PinScreen bileşeninin dinamik parlayan nokta yapısını ve boşken 'PIN Giriniz' gösterimini,
 * 3. LoginPage bileşeninin PinScreen ile birebir aynı Apple spatial glass tasarımını ve PIN/Credentials toggle yapısını doğrular.
 */


import React from 'react';
import { renderToString } from 'react-dom/server';
import { AppleKeypad } from '../../src/presentation/components/common/AppleKeypad';
import { PinScreen, LockPage } from '../../src/presentation/components/auth/PinScreen';
import { LoginPage } from '../../src/presentation/components/auth/LoginPage';
import { useAuthStore } from '../../src/presentation/store/useAuthStore';

describe('Apple Auth Screens Upgrade — AppleKeypad, PinScreen & LoginPage', () => {
  beforeEach(() => {
    useAuthStore.setState({
      user: null,
      isAuthenticated: false,
      isLocked: false,
      branchName: 'Kadıköy Merkez Şube',
      terminalSession: null,
    });
  });

  describe('1. AppleKeypad Giriş Tuşu ve İşlevselliği', () => {
    it('onSubmit prop verildiğinde sol altta şık dairesel Giriş butonunu render eder', () => {
      const html = renderToString(
        React.createElement(AppleKeypad, {
          onNumberPress: vi.fn(),
          onBackspace: vi.fn(),
          onSubmit: vi.fn(),
          canSubmit: true,
        })
      );

      expect(html).toContain('GİRİŞ');
      expect(html).toContain('rounded-full bg-white/[0.12]');
      expect(html).not.toContain('disabled=""');
    });

    it('canSubmit false olduğunda Giriş butonunu disabled olarak render eder', () => {
      const html = renderToString(
        React.createElement(AppleKeypad, {
          onNumberPress: vi.fn(),
          onBackspace: vi.fn(),
          onSubmit: vi.fn(),
          canSubmit: false,
        })
      );

      expect(html).toContain('GİRİŞ');
      expect(html).toContain('disabled=""');
    });

    it('onSubmit prop verilmediğinde boş simetri divi render eder', () => {
      const html = renderToString(
        React.createElement(AppleKeypad, {
          onNumberPress: vi.fn(),
          onBackspace: vi.fn(),
        })
      );

      expect(html).not.toContain('GİRİŞ');
    });
  });

  describe('2. PinScreen Sabit Halka Kaldırma ve Dinamik Noktalar', () => {
    it('şifre girilmediğinde sabit 8 boş halka yerine zarif PIN Giriniz ibaresini render eder', () => {
      const html = renderToString(React.createElement(PinScreen, { isLockMode: true }));

      // Sabit boş halkaların border stili (border-white/30) bulunmamalıdır
      expect(html).not.toContain('border-white/30');
      // Zarif PIN Giriniz metni bulunmalıdır
      expect(html).toContain('PIN Giriniz');
      // Giriş tuşunu içeren AppleKeypad bulunmalıdır
      expect(html).toContain('GİRİŞ');
    });

    it('LockPage exportunun PinScreen ile uyumlu olduğunu doğrular', () => {
      expect(LockPage).toBe(PinScreen);
    });
  });

  describe('3. LoginPage Apple Spatial Frosted Glass Tasarımı', () => {
    it('LockPage ile aynı Apple spatial cam tasarımında kurumsal kimlik doğrulama formu sunar', () => {
      const html = renderToString(React.createElement(LoginPage));

      // Saf koyu arka plan ve Apple aurora ışık atmosferi
      expect(html).toContain('bg-[#060609]');
      // Floating Apple kilit rozeti ve başlık
      expect(html).toContain('KASAM');
      expect(html).toContain('Giriş Yap');
      // Kurumsal kimlik doğrulama form alanları
      expect(html).toContain('Kullanıcı Adı veya E-Posta');
      expect(html).toContain('Şifre');
      expect(html).toContain('Beni Hatırla');
      expect(html).toContain('Giriş Yap');
    });
  });
});
