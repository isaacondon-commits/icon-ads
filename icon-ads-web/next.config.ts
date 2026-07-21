import type { NextConfig } from "next";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

const csp = [
  "default-src 'self'",
  // 'unsafe-inline' is required for the Google Analytics config script, which
  // is injected as an inline <script> at runtime (see components/GoogleAnalytics.tsx).
  "script-src 'self' 'unsafe-inline' https://www.googletagmanager.com",
  "style-src 'self' 'unsafe-inline' https://unpkg.com",
  `img-src 'self' data: ${apiUrl} https://unpkg.com https://*.tile.openstreetmap.org https://*.supabase.co https://*.r2.dev`,
  `media-src 'self' ${apiUrl} https://*.supabase.co https://*.r2.dev`,
  "font-src 'self' data:",
  // *.supabase.co and *.r2.cloudflarestorage.com are the direct-upload targets
  // (#network-error-large-videos) — the browser PUTs files straight to
  // storage, bypassing the backend, so those origins need connect-src too.
  `connect-src 'self' ${apiUrl} https://api.open-meteo.com https://www.google-analytics.com https://*.google-analytics.com https://*.supabase.co https://*.r2.cloudflarestorage.com`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
  images: {
    remotePatterns: [
      // Cloudflare R2 public bucket
      {
        protocol: "https",
        hostname: "**.r2.dev",
      },
      // Custom R2 domain (set via NEXT_PUBLIC_R2_PUBLIC_URL)
      ...(process.env.NEXT_PUBLIC_R2_PUBLIC_URL
        ? [
            {
              protocol: "https" as const,
              hostname: new URL(process.env.NEXT_PUBLIC_R2_PUBLIC_URL).hostname,
            },
          ]
        : []),
      // Supabase Storage
      {
        protocol: "https",
        hostname: "*.supabase.co",
      },
    ],
  },
};

export default nextConfig;
