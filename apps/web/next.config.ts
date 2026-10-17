import path from "node:path";
import type { NextConfig } from "next";

// Monorepo root: workspace packages (e.g. @sqms/shared) live outside apps/web.
const repoRoot = path.resolve(process.cwd(), "../..");
const isDev = process.env.NODE_ENV !== "production";
// Development only: forward /api/* to the API so the browser talks to a single origin (session cookie + CSRF).
// In deployed environments the gateway routes /api/* to the API service directly.
const apiProxy = process.env.API_PROXY_URL ?? (isDev ? "http://127.0.0.1:4000" : undefined);

const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-src 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: repoRoot,
  turbopack: { root: repoRoot, rules: {
    '*': { condition: { path: /apps\/web\/src\/qms\/.*\.(?:js|jsx)$/ }, loaders: ['./qms-source-loader.cjs'] },
  } },
  poweredByHeader: false,
  reactStrictMode: true,
  async rewrites() {
    return apiProxy ? [{ source: "/api/:path*", destination: `${apiProxy.replace(/\/$/, "")}/api/:path*` }] : [];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
