import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // `domains` is deprecated in Next 16.
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'lh3.googleusercontent.com',
      },
    ],
  },
};

export default nextConfig;
