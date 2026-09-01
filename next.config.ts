import type { NextConfig } from "next";

const securityHeaders = [
  // 1. Enforce HTTPS via Strict-Transport-Security (HSTS)
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  // 2. Prevent clickjacking attacks via X-Frame-Options
  {
    key: "X-Frame-Options",
    value: "DENY",
  },
  // 3. Prevent MIME-type sniffing
  {
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  // 4. Restrict referrer leakage
  {
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
  // 5. Restrict dangerous browser features
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
  },
  // 6. Content Security Policy (CSP)
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self' https://generativelanguage.googleapis.com",
      "frame-ancestors 'none'",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
