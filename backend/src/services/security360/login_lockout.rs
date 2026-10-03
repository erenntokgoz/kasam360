//! Kaba kuvvet kilidi.
//!
//! Kapsam anahtarı iki biçimde kurulur:
//!   * `hesap:<kimlik>` — e-posta/kullanıcı adıyla giriş,
//!   * `pin:<tenant_id>` — PIN ile giriş.
//!
//! Neden ayrı fonksiyonlar: kimlik metni küçük harfe indirgenmeden
//! `Ahmet@` ile `ahmet@` iki ayrı hesap gibi sayılır ve kilit birinden
//! kaçılır. Aynı sebeple PIN kapsamı **PIN'in kendisi değil**, PIN'in ait
//! olduğu kiracıdır; PIN değeri kapsam anahtarına girerse saldırgan
//! kapsamları sayarak varlık keşfedebilir.

use sqlx::{Row, SqliteConnection};

use super::{simdi_sn, KILIT_SURESI_SN, MAX_HESAP_HATASI, UYARI_ESIGI};

/// Kimlik bilgisi (e-posta/kullanıcı adı) için hesap kapsamı.
pub fn hesap_kapsami(kimlik: &str) -> String {
    format!("hesap:{}", kimlik.trim().to_lowercase())
}

/// PIN girişi için kiracı kapsamı.
pub fn pin_kapsami(tenant_id: &str) -> String {
    format!("pin:{}", tenant_id.trim())
}

/// Kilidin durumu. Kullanıcıya gösterilecek bilgi burada toplanır.
#[derive(Debug, Clone, PartialEq)]
pub struct KilitDurumu {
    /// Kalan deneme hakkı. `None` = hesap kilitli, hak kalmadı.
    pub kalan_hak: Option<i64>,
    /// Kilit bitene kaç saniye var.
    pub kalan_sn: i64,
    /// Kilitli mi.
    pub kilitli: bool,
    /// Kullanıcıya gösterilecek mesaj.
    pub mesaj: String,
}

/// Kilit açık mı diye bakar. Kilitliyse `Err` döner.
///
/// Kilit **önce** kontrol edilir, kimlik sorgusu sonra: kilitli bir hesap için
/// kullanıcının var olup olmadığına bakmak, saldırgana "bu hesap var" bilgisini
/// bedava verirdi.
///
/// **Neden kalan hak burada hata döndürmüyor:** bu kontrol parolanın
/// doğruluğundan önce çalışır. Kalan hak 2'ye düştüğünde hata dönerse
/// **doğru parola bile reddedilir** ve kullanıcı kendi hesabına kilitlenir —
/// 3 yanlış denemeden sonra giremezsiniz. Kalan hak bilgisi yalnızca *hatalı*
/// deneme yanıtında (`hata_kaydet`) taşınır; kullanıcı böylece her seferinde
/// kaç hakkı kaldığını görür ve kazanmayı planlar.
///
/// Neden `tenant_id` yok: `scope` birincil anahtardır ve zaten benzersizdir
/// (`hesap:<kimlik>`). Giriş anında kiracı bilinmez — kimlik doğrulanmadan
/// önce hangi işletmeye ait olduğu belli değildir. `login_attempts.tenant_id`
/// bir **kaynak** alanıdır (hangi kiracı bağlamında yazıldı), filtre değil;
/// filtre olarak kullanılsaydı okuma ve yazma farklı kiracı değerleri
/// yüzünden kilit sessizce kaçardı.
pub async fn kilit_kontrol(conn: &mut SqliteConnection, kapsam: &str) -> Result<(), String> {
    let satir = sqlx::query("SELECT locked_until FROM login_attempts WHERE scope = ?")
        .bind(kapsam)
        .fetch_optional(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;

    let Some(satir) = satir else {
        return Ok(());
    };

    // Kilit okuması hata halinde `Err` yükselir, `0` dönmez: AGENTS.md §3.4.
    // Kilitli olduğunu düşünüp kullanıcıyı içeri almak, sessiz hatadan çok
    // daha kötüdür.
    let kalan_sn: i64 = satir
        .try_get::<i64, _>("locked_until")
        .map_err(|e| e.to_string())?
        - simdi_sn();

    if kalan_sn > 0 {
        return Err(format!(
            "RATE_LIMIT_EXCEEDED: Çok fazla hatalı deneme. {} saniye sonra tekrar deneyin.",
            kalan_sn
        ));
    }
    Ok(())
}

/// Hatalı denemeyi kaydeder ve gerekirse kilitler.
///
/// **Yan etki:** `login_attempts` satırı ekler/günceller. Çağıran bunu
/// `BEGIN IMMEDIATE` içinde yapmalıdır; iki kasa aynı anda beşinci hatayı
/// yazarsa sayaç ikisini de atlayabilir.
pub async fn hata_kaydet(
    conn: &mut SqliteConnection,
    tenant_id: &str,
    kapsam: &str,
) -> Result<KilitDurumu, String> {
    let mevcut =
        sqlx::query("SELECT failed_count, locked_until FROM login_attempts WHERE scope = ?")
            .bind(kapsam)
            .fetch_optional(&mut *conn)
            .await
            .map_err(|e| e.to_string())?;

    let (onceki_hata, kilit_bitti) = match mevcut {
        Some(satir) => (
            satir
                .try_get::<i64, _>("failed_count")
                .map_err(|e| e.to_string())?,
            satir
                .try_get::<i64, _>("locked_until")
                .map_err(|e| e.to_string())?,
        ),
        None => (0, 0),
    };

    // Kilit süresi dolmuşsa yeni bir hata yeni bir tur başlatır; eski sayaç
    // üzerine yazılmaz, aksi halde kullanıcı 5 hatalı denemeden sonra bir
    // kez doğru deneyip bir kez daha yanılarak süresiz kilitlenirdi.
    // Kilit hâlâ sürüyorsa yeni hata turu başlatılmaz; sayaç korunur ve kilit
    // olduğu gibi bildirilir. `kilit_kontrol` bu yola normalde ulaşmaz
    // (kilitliyse daha kimlik sorgulanmadan hata döner), ama iki kasa eşzamanlı
    // yazarsa buraya ulaşılabilir; yanlış mesaj dönmektense kilidi uzatmak
    // güvenli taraftır.
    if kilit_bitti > simdi_sn() {
        let kalan_sn = kilit_bitti - simdi_sn();
        let kalan_hak = (MAX_HESAP_HATASI - onceki_hata).max(0);
        sqlx::query("UPDATE login_attempts SET updated_at = datetime('now') WHERE scope = ?")
            .bind(kapsam)
            .execute(&mut *conn)
            .await
            .map_err(|e| e.to_string())?;

        return Ok(KilitDurumu {
            kalan_hak: (kalan_hak > 0).then_some(kalan_hak),
            kalan_sn,
            kilitli: true,
            mesaj: format!(
                "RATE_LIMIT_EXCEEDED: Çok fazla hatalı deneme. {} saniye sonra tekrar deneyin.",
                kalan_sn
            ),
        });
    }

    // Süreç:
    //   * kilit hiç kurulmamışsa → sayaç artar (1, 2, 3, 4, 5 → kilit),
    //   * kilit süresi dolmuşsa → yeni tur başlar, sayaç 1 olur.
    // Süresi dolmuş kilidin üzerine yazılırsa kullanıcı 5 hatalı denemeden sonra
    // bir kez doğru deneyip bir kez daha yanılarak **süresiz** kilitlenirdi.
    let yeni_hata = if kilit_bitti > 0 { 1 } else { onceki_hata + 1 };

    let (kilitli, yeni_kilit, kalan_sn, kalan_hak, mesaj) = if yeni_hata >= MAX_HESAP_HATASI {
        (
            true,
            simdi_sn() + KILIT_SURESI_SN,
            KILIT_SURESI_SN,
            None,
            format!(
                "RATE_LIMIT_EXCEEDED: Çok fazla hatalı deneme. {} saniye sonra tekrar deneyin.",
                KILIT_SURESI_SN
            ),
        )
    } else {
        let kalan = MAX_HESAP_HATASI - yeni_hata;
        (
            false,
            0,
            0,
            Some(kalan),
            if kalan <= UYARI_ESIGI {
                format!("Geçersiz kimlik bilgileri. {} hakkınız kaldı.", kalan)
            } else {
                "Geçersiz kimlik bilgileri".to_string()
            },
        )
    };

    sqlx::query(
        "INSERT INTO login_attempts (scope, tenant_id, failed_count, locked_until, updated_at)
         VALUES (?, ?, ?, ?, datetime('now'))
         ON CONFLICT(scope) DO UPDATE SET
             failed_count = excluded.failed_count,
             locked_until = excluded.locked_until,
             updated_at = excluded.updated_at",
    )
    .bind(kapsam)
    .bind(tenant_id)
    .bind(yeni_hata)
    .bind(yeni_kilit)
    .execute(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;

    Ok(KilitDurumu {
        kalan_hak,
        kalan_sn,
        kilitli,
        mesaj,
    })
}

/// Başarılı girişte sayacı temizler.
///
/// Satır yoksa hata **değildir**: kullanıcı ilk kez doğru giriş yapmış
/// olabilir. Kapsam birincil anahtar olduğu için kiracı filtresi gerekmez
/// (bkz. `kilit_kontrol`).
pub async fn basari_sifirla(conn: &mut SqliteConnection, kapsam: &str) -> Result<(), String> {
    sqlx::query("DELETE FROM login_attempts WHERE scope = ?")
        .bind(kapsam)
        .execute(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}
