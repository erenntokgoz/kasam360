import nodemailer from 'nodemailer';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

export type SendMail = (mail: Mail) => Promise<void>;

// Eksik yapılandırma başarı sayılmaz; hata çağırana taşınır.
export const sendSmtpMail: SendMail = async ({ to, subject, text }) => {
  const { SMTP_HOST, SMTP_PORT, SMTP_SECURITY, SMTP_USERNAME, SMTP_PASSWORD, SMTP_FROM } = process.env;
  if (!SMTP_HOST || !SMTP_USERNAME || !SMTP_PASSWORD || !SMTP_FROM) {
    // Yalnız yerel başlatıcı DEV_MAIL_DIR verir: posta gerçek kutuya gitmez, dosyaya yazılır ve logda
    // açıkça belirtilir. Üretimde bu değişken yoktur; eksik SMTP yine hata olarak döner.
    const devDir = process.env.DEV_MAIL_DIR;
    if (!devDir || process.env.NODE_ENV === 'production') throw new Error('SMTP ayarları eksik.');
    mkdirSync(devDir, { recursive: true });
    const file = path.join(devDir, `${new Date().toISOString().replace(/[:.]/g, '-')}-${to.replace(/[^a-z0-9@._-]/gi, '_')}.txt`);
    writeFileSync(file, `Kime: ${to}
Konu: ${subject}

${text}
`, 'utf8');
    console.warn(`[YEREL POSTA] SMTP yok; posta gönderilmedi, dosyaya yazıldı: ${file}`);
    return;
  }

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
