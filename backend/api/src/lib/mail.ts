import nodemailer from 'nodemailer';

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

export type SendMail = (mail: Mail) => Promise<void>;

// Eksik yapılandırma başarı sayılmaz; hata çağırana taşınır.
export const sendSmtpMail: SendMail = async ({ to, subject, text }) => {
  const { SMTP_HOST, SMTP_PORT, SMTP_SECURITY, SMTP_USERNAME, SMTP_PASSWORD, SMTP_FROM } = process.env;
  if (!SMTP_HOST || !SMTP_USERNAME || !SMTP_PASSWORD || !SMTP_FROM) throw new Error('SMTP ayarları eksik.');

  const transport = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT ?? 465),
    secure: SMTP_SECURITY === 'ssl',
    auth: { user: SMTP_USERNAME, pass: SMTP_PASSWORD },
  });
  const mail = { from: `KASAM360 <${SMTP_FROM}>`, to, subject, text };
  try {
    await transport.sendMail(mail);
  } catch (error) {
    // Anlık DNS veya bağlantı hatası doğrulama mailini kaybettirmesin; ikinci hata çağırana taşınır.
    console.error('Mail ilk denemede gönderilemedi:', error);
    await new Promise((resolve) => setTimeout(resolve, 2000));
    await transport.sendMail(mail);
  }
};
