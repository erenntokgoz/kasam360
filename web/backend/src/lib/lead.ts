export interface Lead {
  name: string;
  business: string;
  email: string;
  phone: string;
  message: string;
}

export type LeadField = keyof Lead | 'consent';
export type LeadErrors = Partial<Record<LeadField, string>>;

export type LeadResult =
  | { ok: true; lead: Lead; isBot: boolean }
  | { ok: false; errors: LeadErrors };

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_PATTERN = /^\+?[0-9 ()-]{10,20}$/;
// Satır sonu e-posta başlığına sızamasın diye tek satırlık alanlarda kontrol karakteri yasaktır.
const CONTROL_PATTERN = /[\u0000-\u001f\u007f]/;

function readText(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  return typeof value === 'string' ? value.trim() : '';
}

export function validateLead(input: unknown): LeadResult {
  if (typeof input !== 'object' || input === null) {
    return { ok: false, errors: { name: 'Form okunamadı. Sayfayı yenileyip tekrar deneyin.' } };
  }

  const source = input as Record<string, unknown>;
  const lead: Lead = {
    name: readText(source, 'name'),
    business: readText(source, 'business'),
    email: readText(source, 'email'),
    phone: readText(source, 'phone'),
    message: readText(source, 'message'),
  };

  const errors: LeadErrors = {};
  if (lead.name.length < 2 || lead.name.length > 80 || CONTROL_PATTERN.test(lead.name)) {
    errors.name = 'Adınızı ve soyadınızı yazın.';
  }
  if (lead.business.length < 2 || lead.business.length > 120 || CONTROL_PATTERN.test(lead.business)) {
    errors.business = 'İşletmenizin adını yazın.';
  }
  if (lead.email.length > 160 || !EMAIL_PATTERN.test(lead.email)) {
    errors.email = 'Geçerli bir e-posta adresi yazın.';
  }
  if (lead.phone && !PHONE_PATTERN.test(lead.phone)) {
    errors.phone = 'Telefonu 0532 000 00 00 biçiminde yazın veya boş bırakın.';
  }
  if (lead.message.length > 1000) {
    errors.message = 'Mesajınız en fazla 1000 karakter olabilir.';
  }
  if (source.consent !== true) {
    errors.consent = 'Devam etmek için aydınlatma metnini onaylayın.';
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, lead, isBot: readText(source, 'website') !== '' };
}
