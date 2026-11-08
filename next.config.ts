import type { NextConfig } from 'next'

// 'unsafe-eval' hanya dibutuhkan mode dev (React Refresh). Produksi tidak
// memakainya, jadi jangan dilepas ke pengguna akhir.
const isDev = process.env.NODE_ENV !== 'production'

// Vercel memakai builder Next.js-nya sendiri dan tidak membutuhkan bundel
// standalone; memaksakannya di sana membuat output tidak seperti yang diharapkan
// builder. Self-host tetap mendapat standalone seperti sebelumnya.
const onVercel = process.env.VERCEL === '1'

const nextConfig: NextConfig = {
  ...(onVercel ? {} : { output: 'standalone' as const }),
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [{
      source: '/(.*)',
      headers: [
        { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        {
          key: 'Content-Security-Policy',
          value: [
            "default-src 'self'",
            `script-src 'self'${isDev ? " 'unsafe-eval'" : ''} 'unsafe-inline'`,
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
            "font-src 'self' https://fonts.gstatic.com",
            "img-src 'self' data: blob:",
            "connect-src 'self'",
            "frame-ancestors 'self'",
            "base-uri 'self'",
            "form-action 'self'",
          ].join('; '),
        },
        { key: 'X-XSS-Protection', value: '1; mode=block' },
        { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
      ],
    }]
  },
}

export default nextConfig
