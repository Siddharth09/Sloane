import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The Expo app calls these routes cross-origin from its own dev/web
  // origin (Expo web build, `expo start --web`) - native iOS/Android never
  // hits this since CORS is a browser-only mechanism, but the mobile web
  // build was otherwise unable to reach the API at all ("Failed to fetch").
  // Safe to allow broadly: these routes have no cookie/session auth on
  // `main` (access_token is a request body field, not a credential-bearing
  // cookie) and already do their own quota/token checks server-side.
  async headers() {
    return [
      {
        source: "/api/:path*",
        headers: [
          { key: "Access-Control-Allow-Origin", value: "*" },
          { key: "Access-Control-Allow-Methods", value: "GET, POST, OPTIONS" },
          { key: "Access-Control-Allow-Headers", value: "Content-Type" },
        ],
      },
    ];
  },
};

export default nextConfig;
