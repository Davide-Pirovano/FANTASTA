#!/usr/bin/env node
// Launcher "fantasta".
//
// Su macOS assembla al primo avvio una vera Fantasta.app (copia del dist
// Electron con plist, nome e icona corretti, rifirmata adhoc) e la lancia
// in modalità detached: nel Dock compare solo Fantasta con la sua icona,
// senza il processo "exec" (che su macOS 26 appare quando un processo node
// resta vivo accanto a Electron) e senza l'icona atomo di Electron.
//
// Con `--browser` (o FANTASTA_BROWSER=1) usa la modalità legacy senza
// Electron: avvia i due processi Node (local-server.cjs + renderer standalone)
// e apre la regia nel browser di default.
"use strict";

const { spawn, execFileSync } = require("node:child_process");
const {
  access,
  copyFile,
  mkdir,
  open,
  readFile,
  rm,
  writeFile,
} = require("node:fs/promises");
const { homedir } = require("node:os");
const path = require("node:path");

const resourcesRoot = path.resolve(__dirname, "..", "resources");
const serverEntry = path.join(resourcesRoot, "local-server.cjs");
const rendererEntry = path.join(resourcesRoot, "web", "apps", "web", "server.js");
const appDir = path.join(resourcesRoot, "app");

const HOST = "0.0.0.0";
const LOCAL_PORT = process.env.FANTASTA_PORT ?? "47821";
const RENDERER_PORT = process.env.FANTASTA_RENDERER_PORT ?? "47822";
const LOCAL_URL = `http://127.0.0.1:${LOCAL_PORT}`;
const RENDERER_URL = `http://127.0.0.1:${RENDERER_PORT}`;

const DATA_DIR = process.env.FANTASTA_DATA_DIR ?? path.join(homedir(), ".fantasta");
const DB_PATH = process.env.FANTASTA_DATABASE_PATH ?? path.join(DATA_DIR, "fantasta.db");
const SESSION_FILE = process.env.FANTASTA_SESSION_FILE ?? path.join(DATA_DIR, "admin-session.txt");

const browserMode = process.argv.includes("--browser") || process.env.FANTASTA_BROWSER === "1";

let running = [];

function log(message) {
  console.log(`[fantasta] ${message}`);
}

function error(message) {
  console.error(`[fantasta] Errore: ${message}`);
}

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function waitForHealth(url, label, healthPath = "/api/health", timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(new URL(healthPath, url));
      if (response.ok) return;
    } catch {
      // il processo si sta ancora avviando
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Il processo ${label} non ha risposto in tempo`);
}

async function startServer() {
  // Crea la directory dei dati prima di aprire il database, così il server
  // locale può scrivere il file .db anche al primo avvio.
  await mkdir(DATA_DIR, { recursive: true });
  log(`Avvio server locale su http://${HOST}:${LOCAL_PORT}`);
  const child = spawn(process.execPath, [serverEntry], {
    cwd: path.dirname(serverEntry),
    env: {
      ...process.env,
      FANTASTA_HOST: HOST,
      FANTASTA_PORT: LOCAL_PORT,
      FANTASTA_DATABASE_PATH: DB_PATH,
    },
    stdio: "inherit",
  });
  running.push(child);
  return child;
}

async function resolveAdminSession() {
  await mkdir(DATA_DIR, { recursive: true });
  try {
    const stored = (await readFile(SESSION_FILE, "utf8")).trim();
    if (stored) return stored;
  } catch {
    // nessuna sessione salvata: se ne crea una
  }
  const response = await fetch(new URL("/api/session", LOCAL_URL), { method: "POST" });
  if (!response.ok) throw new Error("Impossibile creare la sessione admin locale");
  const payload = await response.json();
  if (!payload.sessionId) throw new Error("Risposta sessione locale non valida");
  await writeFile(SESSION_FILE, payload.sessionId, { mode: 0o600 });
  return payload.sessionId;
}

function startRenderer() {
  log(`Avvio renderer su http://${HOST}:${RENDERER_PORT}`);
  const child = spawn(process.execPath, [rendererEntry], {
    cwd: path.join(resourcesRoot, "web"),
    env: { ...process.env, HOSTNAME: HOST, PORT: RENDERER_PORT },
    stdio: "inherit",
  });
  running.push(child);
  return child;
}

function openBrowser(url) {
  const platform = process.platform;
  log(`Apertura regia nel browser: ${url}`);
  if (platform === "darwin") {
    spawn("open", [url], { stdio: "ignore", detached: true }).unref();
  } else if (platform === "win32") {
    spawn("cmd", ["/c", "start", "", url], { stdio: "ignore", detached: true, windowsHide: true }).unref();
  } else {
    spawn("xdg-open", [url], { stdio: "ignore", detached: true }).unref();
  }
}

function electronBinary() {
  try {
    // Quando eseguito da Node, `require("electron")` restituisce il percorso
    // del binario Electron (non il modulo). Se electron non è installato il
    // require fallisce e si cade nella modalità browser.
    const electron = require("electron");
    return typeof electron === "string" ? electron : null;
  } catch {
    return null;
  }
}

function cliVersion() {
  try {
    return require(path.join(__dirname, "..", "package.json")).version;
  } catch {
    return "0.0.0";
  }
}

// Assemblea una vera Fantasta.app (macOS) dentro DATA_DIR copiando il dist
// Electron e patchando plist, icona e identificatore, poi rifirma adhoc.
// Ritorna il percorso del bundle. Se il bundle esiste già e la versione di
// Electron/risorse non è cambiata, lo riusa.
async function ensureMacAppBundle(binary) {
  const distApp = path.resolve(path.dirname(binary), "../.."); // .../dist/Electron.app
  const electronVersion = await readFile(path.join(path.dirname(distApp), "version"), "utf8").then((v) => v.trim()).catch(() => "unknown");
  const marker = `${electronVersion}|${cliVersion()}`;
  const bundlePath = path.join(DATA_DIR, "Fantasta.app");
  const markerPath = path.join(DATA_DIR, ".bundle-version");

  try {
    const current = (await readFile(markerPath, "utf8")).trim();
    if (current === marker && (await fileExists(bundlePath))) return bundlePath;
  } catch {
    // nessun marker: si assembla
  }

  log("Preparazione app Fantasta (solo la prima volta, pochi secondi)...");
  await rm(bundlePath, { recursive: true, force: true });

  // 1. Copia il dist Electron come base del bundle. Su macOS si usa `ditto`:
  //    fs.cp risolverebbe i symlink relativi dei framework in percorsi
  //    assoluti, rendendo il bundle non autonomo (icudtl.dat non trovato).
  execFileSync("ditto", [distApp, bundlePath], { stdio: "ignore" });

  // 2. Patch dell'Info.plist: nome, icona, identificatore e versione.
  const plist = path.join(bundlePath, "Contents", "Info.plist");
  const replacements = [
    ["CFBundleName", "Fantasta"],
    ["CFBundleDisplayName", "Fantasta"],
    ["CFBundleIdentifier", "com.fantasta.desktop"],
    ["CFBundleIconFile", "icon.icns"],
    ["CFBundleShortVersionString", cliVersion()],
    ["CFBundleVersion", cliVersion()],
  ];
  for (const [key, value] of replacements) {
    execFileSync("plutil", ["-replace", key, "-string", value, plist]);
  }

  // 3. Sostituisci l'icona di default (electron.icns) con quella di Fantasta.
  await rm(path.join(bundlePath, "Contents", "Resources", "electron.icns"), { force: true });
  await copyFile(path.join(appDir, "build", "icon.icns"), path.join(bundlePath, "Contents", "Resources", "icon.icns"));

  // 4. Copia le risorse dell'app dentro il bundle: main.cjs/preload/icone in
  //    Contents/Resources/app, e server + renderer in Contents/Resources.
  await rm(path.join(bundlePath, "Contents", "Resources", "app"), { recursive: true, force: true });
  execFileSync("ditto", [appDir, path.join(bundlePath, "Contents", "Resources", "app")], { stdio: "ignore" });
  await copyFile(serverEntry, path.join(bundlePath, "Contents", "Resources", "local-server.cjs"));
  await rm(path.join(bundlePath, "Contents", "Resources", "web"), { recursive: true, force: true });
  execFileSync("ditto", [path.join(resourcesRoot, "web"), path.join(bundlePath, "Contents", "Resources", "web")], { stdio: "ignore" });

  // 5. Rifirma adhoc (la modifica del plist invalida la firma originale).
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", bundlePath], { stdio: "ignore" });

  await writeFile(markerPath, marker);
  return bundlePath;
}

async function runBrowserMode() {
  log("Modalità browser (senza finestra).");
  startServer();

  let errorLogged = false;
  for (const child of running) {
    child.on("exit", (code) => {
      if (!errorLogged) {
        errorLogged = true;
        if (process.listenerCount("SIGINT") === 0) {
          error(`Il server si è fermato (${code ?? "terminato"}). L'asta è offline.`);
        }
      }
    });
  }

  try {
    await waitForHealth(LOCAL_URL, "server locale");
    log("Server locale pronto");
    const sessionId = await resolveAdminSession();
    log("Sessione admin pronta");
    startRenderer();
    // Il renderer Next NON espone /api/health: si attende la pagina /local/setup.
    await waitForHealth(RENDERER_URL, "renderer", "/local/setup");

    const home = new URL("/local/home", RENDERER_URL);
    home.searchParams.set("server", LOCAL_URL);
    home.searchParams.set("session", sessionId);
    openBrowser(home.toString());

    log(`Tutto pronto. Regia: ${home.toString()}`);
    log(`I partecipanti si collegano dal telefono con il QR che trovi durante la creazione.`);

    // Resta in esecuzione: il server LAN deve servire i partecipanti.
    await new Promise((resolve) => {
      const stop = () => {
        for (const child of running) {
          try {
            child.kill("SIGTERM");
          } catch {
            /* già terminato */
          }
        }
        resolve();
      };
      process.once("SIGINT", stop);
      process.once("SIGTERM", stop);
    });
  } catch (cause) {
    error(cause instanceof Error ? cause.message : String(cause));
    for (const child of running) {
      try {
        child.kill("SIGTERM");
      } catch {
        /* ignora */
      }
    }
    process.exit(1);
  }
}

async function runMacDesktopMode(binary) {
  try {
    const bundlePath = await ensureMacAppBundle(binary);
    const executable = path.join(bundlePath, "Contents", "MacOS", "Electron");
    const logPath = path.join(DATA_DIR, "desktop.log");
    const logFd = await open(logPath, "a");
    log(`Avvio app desktop da ${bundlePath}`);
    log("App desktop avviata: chiudi la finestra per fermarla.");
    log(`Log: ${logPath}`);
    const child = spawn(executable, [`--user-data-dir=${DATA_DIR}`], {
      env: {
        ...process.env,
        FANTASTA_NPM_MODE: "1",
        FANTASTA_HOST: HOST,
        FANTASTA_PORT: LOCAL_PORT,
        FANTASTA_RENDERER_PORT: RENDERER_PORT,
        FANTASTA_DATABASE_PATH: DB_PATH,
        FANTASTA_LOCAL_SERVER_URL: LOCAL_URL,
      },
      stdio: ["ignore", logFd, logFd],
      detached: true,
    });
    // Il launcher esce subito: se restasse vivo, macOS mostrerebbe un'icona
    // "exec" nel Dock accanto all'app.
    child.unref();
  } catch (cause) {
    error(cause instanceof Error ? cause.message : String(cause));
    log("Ripiego sulla modalità browser.");
    return runBrowserMode();
  }
}

async function runDesktopMode() {
  const binary = electronBinary();
  if (!binary) {
    log("Electron non trovato: passo alla modalità browser.");
    return runBrowserMode();
  }
  // Crea la directory dei dati prima che Electron apra il database.
  await mkdir(DATA_DIR, { recursive: true });
  if (process.platform === "darwin") {
    await runMacDesktopMode(binary);
    return;
  }
  // Windows/Linux: lancio del binario Electron con le risorse del pacchetto.
  // (Su queste piattaforme non esiste il problema dell'icona "exec" nel Dock.)
  log(`Avvio app desktop (Electron) da ${appDir}`);
  const child = spawn(binary, [appDir], {
    env: {
      ...process.env,
      FANTASTA_NPM_MODE: "1",
      FANTASTA_LOCAL_SERVER_URL: LOCAL_URL,
      FANTASTA_HOST: HOST,
      FANTASTA_PORT: LOCAL_PORT,
      FANTASTA_RENDERER_PORT: RENDERER_PORT,
      FANTASTA_DATABASE_PATH: DB_PATH,
    },
    stdio: "inherit",
  });
  running.push(child);

  const interrupted = await new Promise((resolve) => {
    const onSignal = () => {
      running.forEach((c) => { try { c.kill("SIGTERM"); } catch {} });
      resolve(true);
    };
    child.on("exit", (code, signal) => resolve(code === 0 ? false : true));
    process.once("SIGINT", onSignal);
    process.once("SIGTERM", onSignal);
  });
  if (interrupted) {
    log("App desktop chiusa. L'asta è offline.");
  }
}

async function main() {
  if (browserMode) {
    await runBrowserMode();
  } else {
    await runDesktopMode();
  }
}

void main();
