#!/usr/bin/env node
// Launcher "fantasta".
//
// Di default avvia la VERA app desktop: avvia Electron con le risorse incluse
// (resources/app), che apre la finestra della regia e serve server SQLite/LAN
// (porta 47821) e renderer (porta 47822). Il binario Electron è firmato da
// GitHub, quindi NIENTE avviso Gatekeeper all'apertura.
//
// Con `--browser` (o FANTASTA_BROWSER=1) usa la modalità legacy senza Electron:
// avvia i due processi Node (local-server.cjs + renderer standalone) e apre la
// regia nel browser di default. Utile su macchine senza Electron installato.
"use strict";

const { spawn } = require("node:child_process");
const { mkdir, readFile, writeFile } = require("node:fs/promises");
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

async function runDesktopMode() {
  const binary = electronBinary();
  if (!binary) {
    log("Electron non trovato: passo alla modalità browser.");
    return runBrowserMode();
  }
  // Crea la directory dei dati prima che Electron apra il database.
  await mkdir(DATA_DIR, { recursive: true });
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