import type { NextConfig } from "next";
import os from "node:os";
import path from "node:path";

const repositoryRoot = path.resolve(process.cwd(), "../..");
const lanHost = (() => {
  try {
    return new URL(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").hostname;
  } catch {
    return "localhost";
  }
})();

/** IP IPv4 delle interfacce di rete locali (es. 192.168.x.x del Mac). */
function lanAddresses(): string[] {
  const addresses: string[] = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const item of list ?? []) {
      if (item.family === "IPv4" && !item.internal) addresses.push(item.address);
    }
  }
  return addresses;
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  output: "standalone",
  outputFileTracingRoot: repositoryRoot,
  // Durante i test LAN i partecipanti aprono il renderer tramite l'IP del Mac, e
  // la finestra Electron usa 127.0.0.1. Next dev (allowedDevOrigins) blocca con
  // 403 chunks/HMR provenienti da origini non elencate: senza queste voci la
  // regia desktop e i guest dal telefono non caricano il JS. Vale solo in dev.
  allowedDevOrigins: Array.from(new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1", lanHost, ...lanAddresses()])),
  // Il renderer desktop riusa il client LAN TypeScript del workspace desktop.
  transpilePackages: ["@fantasta/desktop"],
  turbopack: {
    root: repositoryRoot,
  },
  // Non generare automaticamente AGENTS.md / CLAUDE.md (agent rules) a ogni `next dev`.
  agentRules: false,
};

export default nextConfig;
