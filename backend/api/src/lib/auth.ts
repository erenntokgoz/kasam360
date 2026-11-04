import { hash, verify } from '@node-rs/argon2';
import { betterAuth } from 'better-auth';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { emailOTP } from 'better-auth/plugins';
import type { Pool } from 'pg';
import type { SendMail } from './mail.js';
import { prefixedId } from './prefixedId.js';
import { validateProfile } from './profile.js';

const TEN_MINUTES = 10 * 60;
const ONE_HOUR = 60 * 60;
// Masaüstü doğrulamayı bağlantıyla değil kodla yapar; ikinci mail gönderilmez.
const DESKTOP_ORIGIN = /^http:\/\/(tauri\.localhost|localhost:1420)$/;

export interface AuthOptions {
  pool: Pool;
  secret: string;
  siteUrl: string;
  allowedOrigins: string[];
  sendMail: SendMail;
  google?: { clientId: string; clientSecret: string };
}

export function createAuth({ pool, secret, siteUrl, allowedOrigins, sendMail, google }: AuthOptions) {
  return betterAuth({
    appName: 'KASAM360',
    plugins: [
      emailOTP({
        otpLength: 6,
        expiresIn: TEN_MINUTES,
        allowedAttempts: 5,
        disableSignUp: true,
        sendVerificationOTP: async ({ email, otp, type }) => {
          await sendMail({
            to: email,
            subject: type === 'forget-password' ? 'KASAM360 şifre yenileme kodu' : 'KASAM360 doğrulama kodu',
            text: `Kodunuz: ${otp}\n\nKod 10 dakika geçerlidir. Bu isteği siz yapmadıysanız bu e-postayı silin.`,
          });
        },
      }),
    ],
    database: pool,
    secret,
    baseURL: siteUrl,
    basePath: '/api/auth',
    trustedOrigins: allowedOrigins,
    advanced: {
      database: { generateId: ({ model }) => prefixedId(model) },
      // Site ve ters vekil aynı sunucudadır; sınır sayacı onların değil ziyaretçinin adresini almalı.
      ipAddress: { trustedProxies: ['127.0.0.1', '::1'] },
    },
    // shortcut: sayaçlar bellektedir, ikinci sunucu eklenince veritabanına taşınmalı.
    rateLimit: {
      enabled: true,
      window: 60,
      max: 60,
      customRules: {
        '/sign-up/email': { window: TEN_MINUTES, max: 5 },
        '/sign-in/email': { window: TEN_MINUTES, max: 10 },
        '/request-password-reset': { window: TEN_MINUTES, max: 3 },
        '/send-verification-email': { window: TEN_MINUTES, max: 3 },
        '/email-otp/send-verification-otp': { window: TEN_MINUTES, max: 5 },
        '/email-otp/request-password-reset': { window: TEN_MINUTES, max: 3 },
        '/email-otp/verify-email': { window: TEN_MINUTES, max: 10 },
        '/email-otp/reset-password': { window: TEN_MINUTES, max: 10 },
      },
    },
    user: {
      deleteUser: { enabled: true },
      additionalFields: {
        businessName: { type: 'string', required: false },
        phone: { type: 'string', required: false },
        consentAt: { type: 'date', required: false, input: false },
      },
    },
    databaseHooks: {
      user: {
        create: {
          // Google ile kayıt da onay metninin altındaki düğmeden geçer; onay anı her kayıtta tutulur.
          before: async (user) => ({ data: { ...user, consentAt: new Date() } }),
        },
      },
    },
    hooks: {
      before: createAuthMiddleware(async (context) => {
        const isRegistration = context.path === '/sign-up/email';
        if (!isRegistration && context.path !== '/update-user') return;
        const errors = validateProfile(context.body ?? {}, isRegistration);
        if (Object.keys(errors).length > 0) {
          throw new APIError('UNPROCESSABLE_ENTITY', { code: 'INVALID_PROFILE', message: 'Form hatalı.', errors });
        }
      }),
    },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      minPasswordLength: 8,
      maxPasswordLength: 128,
      resetPasswordTokenExpiresIn: ONE_HOUR,
      revokeSessionsOnPasswordReset: true,
      password: {
        hash: (password) => hash(password),
        verify: ({ hash: stored, password }) => verify(stored, password),
      },
      sendResetPassword: async ({ user, url }) => {
        await sendMail({
          to: user.email,
          subject: 'KASAM360 şifre sıfırlama',
          text: `Şifrenizi yenilemek için bu bağlantıyı açın:\n\n${url}\n\nBağlantı 1 saat geçerlidir. Bu isteği siz yapmadıysanız bu e-postayı silin.`,
        });
      },
      onPasswordReset: async ({ user }) => {
        await sendMail({
          to: user.email,
          subject: 'KASAM360 şifreniz değişti',
          text: `Şifreniz değiştirildi. Bu işlemi siz yapmadıysanız hemen şifrenizi sıfırlayın ve bize yazın: ${siteUrl}/iletisim`,
        });
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: true,
      autoSignInAfterVerification: true,
      expiresIn: ONE_HOUR,
      sendVerificationEmail: async ({ user, url }, request) => {
        if (DESKTOP_ORIGIN.test(request?.headers.get('origin') ?? '')) return;
        await sendMail({
          to: user.email,
          subject: 'KASAM360 e-posta doğrulama',
          text: `Hesabınızı açmak için bu bağlantıyı açın:\n\n${url}\n\nBağlantı 1 saat geçerlidir. Bu kaydı siz yapmadıysanız bu e-postayı silin.`,
        });
      },
    },
    // Tarayıcıda kayıtlı hesaba sessizce girilmesin; kullanıcı hesabını seçer.
    socialProviders: google ? { google: { ...google, prompt: 'select_account' } } : {},
  });
}

export type Auth = ReturnType<typeof createAuth>;
