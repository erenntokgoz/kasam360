import type { Lead } from './lead.js';

export type SendResult = 'sent' | 'not_configured' | 'failed';

export async function sendLeadMail(lead: Lead): Promise<SendResult> {
  const { MAIL_API_URL, MAIL_API_KEY, MAIL_FROM, LEAD_INBOX } = process.env;
  // Talep kaybolmasın diye yapılandırma eksikse başarı dönülmez; ziyaretçi e-posta adresine yönlendirilir.
  if (!MAIL_API_URL || !MAIL_API_KEY || !MAIL_FROM || !LEAD_INBOX) return 'not_configured';

  const text = [
    `Ad soyad: ${lead.name}`,
    `İşletme: ${lead.business}`,
    `E-posta: ${lead.email}`,
    `Telefon: ${lead.phone || '-'}`,
    '',
    lead.message || '(mesaj yok)',
  ].join('\n');

  try {
    const response = await fetch(MAIL_API_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${MAIL_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: MAIL_FROM,
        to: [LEAD_INBOX],
        reply_to: lead.email,
        subject: `Erken erişim talebi: ${lead.business}`,
        text,
      }),
      signal: AbortSignal.timeout(8000),
    });
    return response.ok ? 'sent' : 'failed';
  } catch {
    return 'failed';
  }
}
