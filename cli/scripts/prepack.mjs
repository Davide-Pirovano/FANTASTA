// Assembla le risorse del pacchetto npm "fantasta".
//
// L'app desktop è due processi Node: il server SQLite/LAN compilato
// (apps/desktop/dist/local-server.cjs) e il renderer Next standalone
// (apps/web/.next/standalone). Questo script li copia dentro resources/ così
// il pacchetto è autonomo: npx fantasta li avvia con Electron (modalità
// desktop) oppure con Node + browser (modalità --browser).
import { execSync } from "node:child_process";
import { copyFile, cp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const cliDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const repoRoot = path.resolve(cliDir, "..");
const desktop = path.join(repoRoot, "apps", "desktop");
const web = path.join(repoRoot, "apps", "web");
const standalone = path.join(web, ".next", "standalone");

const resources = path.join(cliDir, "resources");
await mkdir(resources, { recursive: true });

// 1. Bundle del server locale (CJS, usa require di node:sqlite): build se assente.
const serverBundle = path.join(desktop, "dist", "local-server.cjs");
async function hasServerBundle() {
  try {
    await copyFile(serverBundle, path.join(resources, "local-server.cjs"));
    return true;
  } catch {
    return false;
  }
}
if (!(await hasServerBundle())) {
  console.log("[prepack] bundle server mancante: eseguo bundle:server…");
  execSync("npm run bundle:server", { cwd: desktop, stdio: "inherit" });
  await copyFile(serverBundle, path.join(resources, "local-server.cjs"));
}
console.log("[prepack] server locale: OK");

// 2. Renderer Next standalone (prodotto con npm run web:build).
try {
  await cp(path.join(standalone, "apps"), path.join(resources, "web", "apps"), { recursive: true, force: true });
  await cp(path.join(standalone, "packages"), path.join(resources, "web", "packages"), { recursive: true, force: true });
  await cp(path.join(standalone, "package.json"), path.join(resources, "web", "package.json"), { force: true });
} catch {
  console.error("[prepack] renderer standalone mancante. Esegui prima: npm run web:build");
  process.exit(1);
}

// node_modules standalone: copia escludendo i binari nativi di sharp (non usati:
// la web non usa next/image) e i metadati, per un pacchetto cross-platform.
await mkdir(path.join(resources, "web", "node_modules"), { recursive: true });
const excludeTop = new Set(["@img", ".package-lock.json"]);
for (const entry of await readdir(path.join(standalone, "node_modules"))) {
  if (excludeTop.has(entry)) continue;
  await cp(
    path.join(standalone, "node_modules", entry),
    path.join(resources, "web", "node_modules", entry),
    { recursive: true, force: true, verbatimSymlinks: true },
  );
}
await rm(path.join(resources, "web", "package-lock.json"), { force: true });
console.log("[prepack] renderer standalone: OK");

// 3. Asset statici del renderer (.next/static e public).
await cp(path.join(web, ".next", "static"), path.join(resources, "web", "apps", "web", ".next", "static"), { recursive: true, force: true });
await cp(path.join(web, "public"), path.join(resources, "web", "apps", "web", "public"), { recursive: true, force: true });

// 4. App Electron (modalità desktop): main.cjs + preload.cjs + package.json.
// Electron viene eseguito con `electron resources/app`; le risorse precedenti
// (local-server.cjs e web/) restano fuori da app/, a livello di resources/.
const electronApp = path.join(resources, "app");
await mkdir(path.join(electronApp, "electron"), { recursive: true });
await copyFile(path.join(desktop, "electron", "main.cjs"), path.join(electronApp, "electron", "main.cjs"));
await copyFile(path.join(desktop, "electron", "preload.cjs"), path.join(electronApp, "electron", "preload.cjs"));
await writeFile(
  path.join(electronApp, "package.json"),
  JSON.stringify({ name: "fantasta", version: "1.0.0", main: "electron/main.cjs", private: true }, null, 2) + "\n",
);
// Icone dell'app: la finestra da npm gira sul bundle Electron generico, quindi
// senza queste l'icona nel Dock/taskbar sarebbe quella di default di Electron.
await mkdir(path.join(electronApp, "build"), { recursive: true });
await copyFile(path.join(desktop, "build", "icon.icns"), path.join(electronApp, "build", "icon.icns"));
await copyFile(path.join(desktop, "build", "icon.ico"), path.join(electronApp, "build", "icon.ico"));
console.log("[prepack] app Electron: OK (con icone)");

console.log("[prepack] risorse assemblate in cli/resources");