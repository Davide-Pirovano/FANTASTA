import type { NextConfig } from "next";
import path from "node:path";

const repositoryRoot = path.resolve(process.cwd(), "../..");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  output: "standalone",
  outputFileTracingRoot: repositoryRoot,
  // Il renderer desktop riusa il client LAN TypeScript del workspace desktop.
  transpilePackages: ["@fantasta/desktop"],
  turbopack: {
    root: repositoryRoot,
  },
  // Non generare automaticamente AGENTS.md / CLAUDE.md (agent rules) a ogni `next dev`.
  agentRules: false,
};

export default nextConfig;
