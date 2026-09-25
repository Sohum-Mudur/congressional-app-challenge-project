import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin the project root. Without this, a stray package-lock.json in a parent folder
  // (e.g. the home directory) makes Next.js treat that whole folder as the workspace.
  turbopack: { root: __dirname },
  outputFileTracingRoot: __dirname,
};

export default nextConfig;
