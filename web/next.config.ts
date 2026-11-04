import type { NextConfig } from 'next';

const apiOrigin = process.env.API_ORIGIN ?? 'http://localhost:4000';

// Tanıtım sitesi başka bir sayfaya gömülmemeli; form tıklama hilesine açık kalmasın diye çerçeve kapalıdır.
const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  agentRules: false,
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
  // Tarayıcı yalnız kendi adresini görür; API adresi değişse de sayfa kodu değişmez.
  async rewrites() {
    return [
      { source: '/api/auth/:path*', destination: `${apiOrigin}/api/auth/:path*` },
      { source: '/api/support/:path*', destination: `${apiOrigin}/api/support/:path*` },
      { source: '/api/desktop-link/:path*', destination: `${apiOrigin}/api/desktop-link/:path*` },
    ];
  },
  async redirects() {
    return [{ source: '/erken-erisim', destination: '/kayit', permanent: true }];
  },
};

export default nextConfig;
