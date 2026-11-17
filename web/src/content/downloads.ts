// Adresler en son GitHub sürümünün sabit adlı varlıklarına gider; sürüm etiketi değişse de bağlantı bozulmaz.
const BASE = 'https://github.com/erenntokgoz/kasam360/releases/latest/download';

export const downloadRelease = { version: '0.3.2', dateLabel: '17 Kasım 2026' };

export const downloadItems = [
  {
    platform: 'Windows',
    requirement: 'Windows 10 veya 11, 64 bit. Kasa, garson ve mutfak bilgisayarları için.',
    fileName: 'kasam360-kurulum.exe',
    sizeLabel: '6,6 MB',
    sha256: 'beec37e85be3abc116f4da577901ef2cdf33b86b251b5b7223c33024961adf3d',
    url: `${BASE}/kasam360-kurulum.exe`,
    steps: [
      'Dosyayı indirip çalıştırın.',
      'Windows "bilinmeyen yayıncı" uyarısı gösterirse Ek bilgi, ardından Yine de çalıştır seçin.',
      'Kurulum bitince KASAM360\'ı açıp hesabınızla giriş yapın.',
    ],
  },
  {
    platform: 'Android',
    requirement: 'Android 7 veya üzeri, 64 bit (ARM64) telefon ve tablet.',
    fileName: 'kasam360-android.apk',
    sizeLabel: '23,6 MB',
    sha256: '7dfbf532512d5d234829e07afe27ff50732a58753626f16eaeecb0217244163f',
    url: `${BASE}/kasam360-android.apk`,
    steps: [
      'Dosyayı telefonunuza indirin.',
      'Ayarlar içinde tarayıcınız veya Dosyalar uygulaması için "Bilinmeyen uygulamaları yükle" iznini açın.',
      'İndirilen dosyayı açıp Yükle\'ye dokunun. Kurulum sonrası izni kapatabilirsiniz.',
    ],
  },
];
