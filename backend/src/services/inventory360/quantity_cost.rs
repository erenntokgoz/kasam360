//! Reel miktarları sınırda mikrobirime çevirir; kuruş hesabı tamsayıdır.

const SCALE: i128 = 1_000_000;

pub(crate) fn quantity_micros(quantity: f64) -> Result<i128, String> {
    if !quantity.is_finite() || quantity <= 0.0 || quantity > (i64::MAX as f64) / 1_000_000.0 {
        return Err("VALIDATION: geçersiz stok miktarı".into());
    }
    let micros = (quantity * SCALE as f64).round() as i128;
    if micros == 0 {
        return Err("VALIDATION: stok miktarı ölçülemeyecek kadar küçük".into());
    }
    Ok(micros)
}

fn rounded_positive(numerator: i128, denominator: i128) -> Result<i64, String> {
    let rounded = numerator
        .checked_add(denominator / 2)
        .ok_or_else(|| "OVERFLOW: maliyet hesabı taştı".to_string())?
        / denominator;
    i64::try_from(rounded).map_err(|_| "OVERFLOW: maliyet hesabı taştı".to_string())
}

pub(crate) fn line_cost_cents(unit_cost_cents: i64, quantity: f64) -> Result<i64, String> {
    if unit_cost_cents < 0 {
        return Err("VALIDATION: negatif parti maliyeti".into());
    }
    let micros = quantity_micros(quantity)?;
    let numerator = i128::from(unit_cost_cents)
        .checked_mul(micros)
        .ok_or_else(|| "OVERFLOW: maliyet hesabı taştı".to_string())?;
    rounded_positive(numerator, SCALE)
}

pub(crate) fn unit_cost_cents(total_cost_cents: i64, quantity: f64) -> Result<i64, String> {
    if total_cost_cents < 0 {
        return Err("VALIDATION: negatif toplam maliyet".into());
    }
    let numerator = i128::from(total_cost_cents)
        .checked_mul(SCALE)
        .ok_or_else(|| "OVERFLOW: maliyet hesabı taştı".to_string())?;
    rounded_positive(numerator, quantity_micros(quantity)?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kesirli_miktar_kurusla_yuvarlanir() {
        assert_eq!(line_cost_cents(333, 1.5).unwrap(), 500);
        assert_eq!(unit_cost_cents(500, 1.5).unwrap(), 333);
        assert!(line_cost_cents(i64::MAX, 1_000_000.0).is_err());
    }
}
