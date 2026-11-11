// Sürüm bilgisi yayınla birlikte elle güncellenir; adresler GitHub sürüm varlıklarının sabit yoludur.
const RELEASE_TAG = 'test-2026-11-12';
const BASE = `https://github.com/erenntokgoz/kasam360/releases/download/${RELEASE_TAG}`;

export const downloadRelease = { version: '0.2.0 test', dateLabel: '12 Kasım 2026' };

export const downloadItems = [
  {
    platform: 'Windows',
    requirement: 'Windows 10 veya 11, 64 bit. Kasa, garson ve mutfak bilgisayarları için.',
    fileName: 'kasam360-kurulum-test.exe',
    sizeLabel: '6,3 MB',
    sha256: 'd2e9b5445917d42f48d666b1f952c747b7ab218d64aee0e9d8552bc4a07d4ef5',
    url: `${BASE}/kasam360-kurulum-test.exe`,
    steps: [
      'Dosyayı indirip çalıştırın.',
      'Windows "bilinmeyen yayıncı" uyarısı gösterirse Ek bilgi, ardından Yine de çalıştır seçin.',
      'Kurulum bitince KASAM360\'ı açıp hesabınızla giriş yapın.',
    ],
  },
  {
    platform: 'Android',
    requirement: 'Android 7 veya üzeri, 64 bit (ARM64) telefon ve tablet.',
    fileName: 'kasam360-android-test.apk',
    sizeLabel: '47,3 MB',
    sha256: 'e4a669f77e69e8e5cab7ce2948b5b37a4e9c5337ca5cde968aacd0add261f05c',
    url: `${BASE}/kasam360-android-test.apk`,
    steps: [
      'Dosyayı telefonunuza indirin.',
      'Ayarlar içinde tarayıcınız veya Dosyalar uygulaması için "Bilinmeyen uygulamaları yükle" iznini açın.',
      'İndirilen dosyayı açıp Yükle\'ye dokunun. Kurulum sonrası izni kapatabilirsiniz.',
    ],
  },
];
