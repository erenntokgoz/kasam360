const PHONE_PATTERN = /^\+?[0-9 ()-]{10,20}$/;
// Ad alanları e-posta metnine de girebilir; satır sonu ve kontrol karakteri kabul edilmez.
const CONTROL_PATTERN = /[\u0000-\u001f\u007f]/;

const isText = (value: unknown, min: number, max: number) =>
  typeof value === 'string' && value.trim().length >= min && value.length <= max && !CONTROL_PATTERN.test(value);

export type ProfileErrors = Partial<Record<'name' | 'businessName' | 'phone' | 'consent', string>>;

// Kısmi güncellemede gönderilmeyen alan denetlenmez; kayıtta ad, işletme ve onay zorunludur.
export function validateProfile(body: Record<string, unknown>, isRegistration: boolean): ProfileErrors {
  const errors: ProfileErrors = {};
  if ((isRegistration || body.name !== undefined) && !isText(body.name, 2, 80)) {
    errors.name = 'Adınızı ve soyadınızı yazın.';
  }
  if ((isRegistration || body.businessName !== undefined) && !isText(body.businessName, 2, 120)) {
    errors.businessName = 'İşletmenizin adını yazın.';
  }
  if (body.phone !== undefined && body.phone !== '' && !(typeof body.phone === 'string' && PHONE_PATTERN.test(body.phone))) {
    errors.phone = 'Telefonu 0532 000 00 00 biçiminde yazın veya boş bırakın.';
  }
  if (isRegistration && body.consent !== true) errors.consent = 'Devam etmek için aydınlatma metnini onaylayın.';
  return errors;
}
