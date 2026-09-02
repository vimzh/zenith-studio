import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // `@zenith/core` ships TypeScript source rather than a build step, so Next compiles it.
  transpilePackages: ["@zenith/core"],
};

export default nextConfig;
