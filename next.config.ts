import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  images: {
    // Product art comes from Channel3 partner CDNs at full camera resolution
    // (seen up to 2048x3000); let the optimizer serve card-sized versions.
    remotePatterns: [{ protocol: "https", hostname: "**" }],
  },
};

export default nextConfig;
