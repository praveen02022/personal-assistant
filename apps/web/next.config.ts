import type { NextConfig } from "next";

// The browser only ever talks to this origin. /api/* is proxied to the NestJS API,
// so the session cookie stays first-party, SSE needs no CORS, and no token reaches the client.
const API_ORIGIN = process.env.API_ORIGIN ?? "http://127.0.0.1:4000";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  poweredByHeader: false,
  transpilePackages: ["@personalos/contracts"],
  // Old addresses keep working. /settings/integrations is also where Microsoft sign-in returns
  // (the API redirects there with ?result=..., which is passed through).
  async redirects() {
    return [
      { source: "/settings/integrations", destination: "/connections", permanent: false },
      { source: "/settings/voice", destination: "/settings", permanent: false },
    ];
  },
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API_ORIGIN}/api/:path*` }];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(), geolocation=(), microphone=(self)" },
        ],
      },
    ];
  },
  turbopack: {
    rules: { "*.css": { loaders: ["@tailwindcss/turbopack"], as: "*.css" } },
  },
};

export default nextConfig;
