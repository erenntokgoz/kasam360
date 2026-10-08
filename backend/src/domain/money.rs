//! Para tutarı domain newtype'ı.
//!
//! Neden newtype: `i64` ile `f64` aynı fonksiyon
//! imzasında karşılıklı yerine kullanılabilir;
//! `Cents` ise float'ı imzaya almaz. Finansal
//! alanlara float sızması böylece **derleme
//! zamanında** engellenir (AGENTS.md §2: para
//! INTEGER kuruş, float YASAK).
//!
//! `Cents` kuruş cinsinden tam sayıdır; ondalık
//! temsil yoktur. KDV oranları basis-point
//! (binde) olarak `i64` üzerinden taşınır.

/// Kuruş cinsinden para tutarı.
///
/// İç alan `pub`dur: IPC sözleşmesi `i64`
/// taşıdığı için serrize/serrize çözme
/// doğrudan `Cents(..)` üzerinden yapılır;
/// `i64` geçişi `From`/`Into` ile yapılır.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct Cents(pub i64);

impl Cents {
    /// Sıfır tutar.
    pub const SIFIR: Cents = Cents(0);

    /// Tutar negatif mi?
    ///
    /// Neden metot: finansal alanlarda negatif
    /// tutar kontrolü bir yerden yazılır; newtype
    /// üstünde tutulursa kural dağılmaz.
    pub fn negatif_mi(&self) -> bool {
        self.0 < 0
    }
}

impl From<i64> for Cents {
    fn from(deger: i64) -> Self {
        Cents(deger)
    }
}

impl From<Cents> for i64 {
    fn from(tutar: Cents) -> Self {
        tutar.0
    }
}

impl std::ops::Add for Cents {
    type Output = Cents;

    fn add(self, sag: Cents) -> Cents {
        Cents(self.0 + sag.0)
    }
}

impl std::ops::Sub for Cents {
    type Output = Cents;

    fn sub(self, sag: Cents) -> Cents {
        Cents(self.0 - sag.0)
    }
}

/// Sayı ile çarpma (adet × birim fiyat).
impl std::ops::Mul<i64> for Cents {
    type Output = Cents;

    fn mul(self, faktor: i64) -> Cents {
        Cents(self.0 * faktor)
    }
}

/// Sayıya bölme (paylaştırma).
impl std::ops::Div<i64> for Cents {
    type Output = Cents;

    fn div(self, payda: i64) -> Cents {
        Cents(self.0 / payda)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// i64 ↔ Cents dönüşümleri kayıpsızdır.
    #[test]
    fn i64_donusumu_geridonusumlu() {
        let tutar = Cents::from(12_345_i64);
        assert_eq!(i64::from(tutar), 12_345);
        assert_eq!(Cents::SIFIR.0, 0);
    }

    /// Toplama/çıkarma doğru sonuçlar üretir.
    #[test]
    fn add_sub_dogru() {
        let a = Cents(3_400);
        let b = Cents(6_800);
        assert_eq!(a + b, Cents(10_200));
        assert_eq!(b - a, Cents(3_400));
        // Negatiflik denetimi.
        assert!((a - b).negatif_mi());
        assert!(!(a + b).negatif_mi());
    }

    /// Çarpma (adet × fiyat) ve bölme doğru sonuçlar
    /// üretir.
    #[test]
    fn mul_div_dogru() {
        let birim = Cents(3_333);
        assert_eq!(birim * 3, Cents(9_999));
        assert_eq!(Cents(10_000) / 4, Cents(2_500));
    }

    /// Sıralama tutarlıdır (raporlama ve eşik
    /// karşılaştırmaları için).
    #[test]
    fn sirala_dogru() {
        let kucuk = Cents(100);
        let buyuk = Cents(1_000);
        assert!(kucuk < buyuk);
        assert_eq!(kucuk.min(buyuk), kucuk);
        assert_eq!(kucuk.max(buyuk), buyuk);
    }

    /// Float geçirmez: hesaplama tam sayı
    /// aritmetiğiyle yapılır — ondalık kaydırma
    /// oluşmaz.
    ///
    /// Senaryo: 3 × 3.333 kuruş birim fiyat +
    /// %10 KDV (1000 basis-point). Ondalık
    /// hesaplamada 3 × 3,333 = 9,999 → kuruş
    /// yuvarlaması kaydırma üretir; `Cents`
    /// tam sayı olduğu için sonuç kesin:
    /// 9.999 + 999 KDV = 10.998 kuruş.
    #[test]
    fn float_kaydirma_olmaz() {
        let birim = Cents(3_333);
        let adet = 3_i64;
        let kdv_bp = 1_000_i64; // %10 = 1000 bp

        let ara_toplam = birim * adet;
        let kdv = Cents((ara_toplam.0 * kdv_bp) / 10_000);
        let toplam = ara_toplam + kdv;

        assert_eq!(ara_toplam, Cents(9_999));
        assert_eq!(kdv, Cents(999));
        assert_eq!(toplam, Cents(10_998));
    }

    /// Basis-point KDV hesabı: %10 → 1000 bp,
    /// %20 → 2000 bp; payda 10.000'dür.
    #[test]
    fn basis_point_kdv_dogru() {
        let matrah = Cents(10_000);
        let on_puan = Cents((matrah.0 * 1_000) / 10_000);
        let yirmi_puan = Cents((matrah.0 * 2_000) / 10_000);
        assert_eq!(on_puan, Cents(1_000));
        assert_eq!(yirmi_puan, Cents(2_000));
    }
}
