//! Cari kart araması ve benzer ad denetimi.
//!
//! Neden SQL dışında: SQLite `LOWER` yalnız ASCII katlar; "IŞIK" ile "ışık"
//! veritabanında farklı kalır. Kart sayısı işletme ölçeğinde küçük olduğundan
//! kiracının kartları okunup Rust tarafında katlanır, ayrıca arama kolonu
//! tutulup eşitlenmek zorunda kalmaz.

/// Harf büyüklüğü ve Türkçe karakter farklarını yok eden karşılaştırma biçimi.
pub fn fold(text: &str) -> String {
    let mut folded = String::with_capacity(text.len());
    let mut pending_space = false;
    for c in text.chars() {
        // `to_lowercase` "İ" için birleşen nokta üretir; işaretler hiç taşınmaz.
        if ('\u{0300}'..='\u{036F}').contains(&c) {
            continue;
        }
        let mapped = match c {
            'İ' | 'I' | 'ı' | 'i' | 'Î' | 'î' => 'i',
            'Ş' | 'ş' => 's',
            'Ğ' | 'ğ' => 'g',
            'Ü' | 'ü' | 'Û' | 'û' => 'u',
            'Ö' | 'ö' => 'o',
            'Ç' | 'ç' => 'c',
            'Â' | 'â' => 'a',
            other => other,
        };
        if !mapped.is_alphanumeric() {
            pending_space = !folded.is_empty();
            continue;
        }
        if pending_space {
            folded.push(' ');
            pending_space = false;
        }
        folded.extend(mapped.to_lowercase());
    }
    folded
}

fn digits(text: &str) -> String {
    text.chars().filter(char::is_ascii_digit).collect()
}

/// Sorgunun her sözcüğü adda geçmeli ya da sorgu telefon rakamlarında bulunmalı.
pub fn matches_card(query: &str, name: &str, phone: Option<&str>) -> bool {
    let wanted = fold(query);
    if wanted.is_empty() {
        return true;
    }
    let folded_name = fold(name);
    if wanted.split(' ').all(|word| folded_name.contains(word)) {
        return true;
    }
    let wanted_digits = digits(query);
    wanted_digits.len() >= 3 && phone.is_some_and(|p| digits(p).contains(&wanted_digits))
}

/// Şirket türü sözcükleri ayırt edici değildir; "Öz Gıda Ltd" ile "Öz Gıda A.Ş."
/// aynı kuruma benzer.
const LEGAL_WORDS: [&str; 11] = [
    "ltd", "sti", "as", "a", "s", "tic", "san", "ve", "limited", "sirketi", "anonim",
];

fn significant_words(folded: &str) -> Vec<&str> {
    folded
        .split(' ')
        .filter(|word| !word.is_empty() && !LEGAL_WORDS.contains(word))
        .collect()
}

fn edit_distance(a: &str, b: &str) -> usize {
    let a: Vec<char> = a.chars().collect();
    let b: Vec<char> = b.chars().collect();
    let mut previous: Vec<usize> = (0..=b.len()).collect();
    for (i, ca) in a.iter().enumerate() {
        let mut current = vec![i + 1];
        for (j, cb) in b.iter().enumerate() {
            let substitution = previous[j] + usize::from(ca != cb);
            current.push(substitution.min(previous[j + 1] + 1).min(current[j] + 1));
        }
        previous = current;
    }
    previous[b.len()]
}

/// İki ad aynı kişi/kurum olabilir mi? Yalnız uyarı üretir, kayıt birleştirmez.
pub fn is_similar_name(a: &str, b: &str) -> bool {
    let (folded_a, folded_b) = (fold(a), fold(b));
    let (words_a, words_b) = (significant_words(&folded_a), significant_words(&folded_b));
    if words_a.is_empty() || words_b.is_empty() {
        return folded_a == folded_b;
    }
    let (joined_a, joined_b) = (words_a.join(" "), words_b.join(" "));
    if joined_a == joined_b {
        return true;
    }
    // Biri diğerinin ayrıntılı yazımı olabilir: "Ahmet Yılmaz" / "Ahmet Yılmaz Usta".
    let (short, long) = if words_a.len() <= words_b.len() {
        (&words_a, &words_b)
    } else {
        (&words_b, &words_a)
    };
    let long_enough = short.iter().map(|w| w.chars().count()).sum::<usize>() >= 5;
    if long_enough && short.iter().all(|word| long.contains(word)) {
        return true;
    }
    let allowed = if joined_a.chars().count().min(joined_b.chars().count()) <= 6 {
        1
    } else {
        2
    };
    edit_distance(&joined_a, &joined_b) <= allowed
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn turkce_karakter_ve_buyuk_harf_ayni_katlanir() {
        assert_eq!(fold("IŞIK Çiğdem"), "isik cigdem");
        assert_eq!(fold("ışık  ÇİĞDEM"), "isik cigdem");
        assert_eq!(fold("İ\u{0307}zmir, Şube-2"), "izmir sube 2");
    }

    #[test]
    fn arama_sozcuk_sirasindan_ve_telefondan_bagimsiz_bulur() {
        assert!(matches_card("yilmaz ahmet", "Ahmet YILMAZ", None));
        assert!(matches_card("ÖZ gıda", "Öz Gıda Toptan A.Ş.", None));
        assert!(matches_card("555 1010", "Kasap", Some("0212 555 10 10")));
        assert!(!matches_card("mehmet", "Ahmet Yılmaz", Some("0532")));
        assert!(matches_card("  ", "Herkes", None));
    }

    #[test]
    fn benzer_adlar_yakalanir_farkli_adlar_karismaz() {
        assert!(is_similar_name("Ahmet Yılmaz", "AHMET YILMAZ"));
        assert!(is_similar_name("Ahmet Yılmaz", "Ahmet Yilmaz Usta"));
        assert!(is_similar_name("Öz Gıda Ltd. Şti.", "OZ GIDA A.Ş."));
        assert!(is_similar_name("Mehmet Kaya", "Mehmet Kaye"));
        assert!(!is_similar_name("Ahmet Yılmaz", "Mehmet Kaya"));
        assert!(!is_similar_name("Ali", "Veli"));
        // Kısa ortak sözcük tek başına aynı kişi saydırmaz.
        assert!(!is_similar_name("Ali", "Ali Rıza Demir"));
    }
}
