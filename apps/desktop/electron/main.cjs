const { app, BrowserWindow, dialog, ipcMain, safeStorage, session, shell, utilityProcess } = require("electron");
const { spawn } = require("node:child_process");
const { readFile, writeFile, mkdir, copyFile, rename, unlink, access } = require("node:fs/promises");
const { randomUUID } = require("node:crypto");
const path = require("node:path");
const { backup, DatabaseSync } = require("node:sqlite");

const repositoryRoot = path.resolve(__dirname, "../../..");
const localServerUrl = process.env.FANTASTA_LOCAL_SERVER_URL ?? "http://127.0.0.1:47821";
let rendererOrigin = process.env.FANTASTA_RENDERER_URL ?? "http://127.0.0.1:3000";
let localService;
let rendererService;
let hostConfig = { sessionId: null, leagueCode: null };

function hostConfigPath() {
  return path.join(app.getPath("userData"), "host.json");
}

function databasePath() {
  return process.env.FANTASTA_DATABASE_PATH ?? path.join(app.getPath("userData"), "fantasta.db");
}

function assertRenderer(event) {
  const sender = new URL(event.senderFrame.url);
  if (sender.origin !== assertLoopback(rendererOrigin, "FANTASTA_RENDERER_URL").origin) {
    throw new Error("Renderer non autorizzato");
  }
}

async function exportBackup() {
  const date = new Date().toISOString().slice(0, 10);
  const destination = await dialog.showSaveDialog({
    title: "Esporta backup Fantasta",
    defaultPath: path.join(app.getPath("documents"), `fantasta-backup-${date}.db`),
    filters: [{ name: "Database Fantasta", extensions: ["db", "sqlite"] }],
  });
  if (destination.canceled || !destination.filePath) return { canceled: true };
  const database = new DatabaseSync(databasePath(), { timeout: 5_000 });
  try {
    const pages = await backup(database, destination.filePath, { rate: 100 });
    return { canceled: false, path: destination.filePath, pages };
  } finally {
    database.close();
  }
}

async function fileExists(filePath) {
  try { await access(filePath); return true; } catch { return false; }
}

function validateBackup(filePath) {
  const database = new DatabaseSync(filePath, { readOnly: true, timeout: 5_000 });
  try {
    const migrations = database.prepare("SELECT COUNT(*) AS count FROM schema_migrations").get();
    const leagues = database.prepare("SELECT COUNT(*) AS count FROM leagues").get();
    if (!migrations || !leagues) throw new Error("Il file non contiene un database Fantasta valido");
  } finally {
    database.close();
  }
}

async function stopLocalService() {
  const service = localService;
  localService = undefined;
  if (!service || service.exitCode !== null) return;
  await new Promise((resolve) => {
    const timeout = setTimeout(() => { try { service.kill(); } catch {} resolve(); }, 5_000);
    service.once("exit", () => { clearTimeout(timeout); resolve(); });
    try { service.kill(); } catch {}
  });
}

async function stopRendererService() {
  const service = rendererService;
  rendererService = undefined;
  if (!service || service.exitCode !== null) return;
  await new Promise((resolve) => {
    const timeout = setTimeout(() => { service.kill("SIGKILL"); resolve(); }, 5_000);
    service.once("exit", () => { clearTimeout(timeout); resolve(); });
    service.kill("SIGTERM");
  });
}

async function restoreBackup() {
  if (process.env.FANTASTA_START_LOCAL_SERVER === "0") {
    throw new Error("Il ripristino richiede il servizio locale gestito da Electron");
  }
  const selection = await dialog.showOpenDialog({
    title: "Ripristina backup Fantasta",
    properties: ["openFile"],
    filters: [{ name: "Database Fantasta", extensions: ["db", "sqlite"] }],
  });
  if (selection.canceled || !selection.filePaths[0]) return { canceled: true };
  validateBackup(selection.filePaths[0]);
  const confirmation = await dialog.showMessageBox({
    type: "warning",
    buttons: ["Annulla", "Ripristina"],
    defaultId: 0,
    cancelId: 0,
    title: "Ripristinare questo backup?",
    message: "L'asta corrente verrà sostituita e tutti i partecipanti dovranno riconnettersi.",
    detail: "Prima del ripristino verrà conservata una copia di sicurezza del database attuale.",
  });
  if (confirmation.response !== 1) return { canceled: true };

  const target = databasePath();
  const folder = path.dirname(target);
  const candidate = path.join(folder, `fantasta-restore-${randomUUID()}.tmp`);
  const safety = path.join(folder, `fantasta-before-restore-${Date.now()}.db`);
  let previousPath = null;
  let replacementInstalled = false;
  try {
    await stopLocalService();
    if (await fileExists(target)) {
      const current = new DatabaseSync(target, { timeout: 5_000 });
      try { await backup(current, safety, { rate: 100 }); } finally { current.close(); }
      previousPath = `${target}.pre-restore-${Date.now()}`;
      await rename(target, previousPath);
    }
    await copyFile(selection.filePaths[0], candidate);
    validateBackup(candidate);
    await rename(candidate, target);
    replacementInstalled = true;
    await Promise.all([unlink(`${target}-wal`).catch(() => {}), unlink(`${target}-shm`).catch(() => {})]);
    await startLocalService();
    for (const window of BrowserWindow.getAllWindows()) window.webContents.reloadIgnoringCache();
    return { canceled: false, safetyPath: await fileExists(safety) ? safety : undefined };
  } catch (error) {
    await unlink(candidate).catch(() => {});
    if (previousPath && await fileExists(previousPath)) {
      if (replacementInstalled && await fileExists(target)) {
        await rename(target, `${target}.failed-restore-${Date.now()}`).catch(() => {});
      }
      if (!(await fileExists(target))) await rename(previousPath, target).catch(() => {});
    }
    if (!localService) await startLocalService().catch(() => {});
    throw error;
  }
}

async function loadHostConfig() {
  try {
    const raw = JSON.parse(await readFile(hostConfigPath(), "utf8"));
    const leagueCode = typeof raw.leagueCode === "string" ? raw.leagueCode : null;
    if (typeof raw.encryptedSession !== "string" || !(await safeStorage.isAsyncEncryptionAvailable())) {
      return { sessionId: null, leagueCode };
    }
    const decrypted = await safeStorage.decryptStringAsync(Buffer.from(raw.encryptedSession, "base64"));
    return { sessionId: decrypted.result, leagueCode };
  } catch {
    return { sessionId: null, leagueCode: null };
  }
}

async function saveHostConfig(update) {
  hostConfig = { ...hostConfig, ...update };
  await mkdir(path.dirname(hostConfigPath()), { recursive: true });
  const payload = { leagueCode: hostConfig.leagueCode };
  if (hostConfig.sessionId && await safeStorage.isAsyncEncryptionAvailable()) {
    payload.encryptedSession = (await safeStorage.encryptStringAsync(hostConfig.sessionId)).toString("base64");
  }
  await writeFile(hostConfigPath(), JSON.stringify(payload), { mode: 0o600 });
}

function assertLoopback(value, label) {
  const url = new URL(value);
  if (!["127.0.0.1", "localhost", "::1"].includes(url.hostname)) {
    throw new Error(`${label} deve essere un URL loopback`);
  }
  return url;
}

async function waitForHealth(url) {
  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(new URL("/api/health", url));
      if (response.ok) return;
    } catch { /* il processo locale sta ancora avviandosi */ }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error("Il servizio locale non ha risposto in tempo");
}

async function startLocalService() {
  if (process.env.FANTASTA_START_LOCAL_SERVER === "0") return;
  // In sviluppo il server SQLite gira attraverso tsx: NON e un runtime Electron,
  // quindi lo si mantiene con child_process.spawn (qui l'icona Dock non interessa).
  if (!app.isPackaged) {
    const entrypoint = path.join(repositoryRoot, "apps/desktop/src/main.ts");
    localService = spawn(process.execPath, ["--import", "tsx", entrypoint], {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",
        FANTASTA_HOST: "0.0.0.0",
        FANTASTA_PORT: new URL(localServerUrl).port || "47821",
        FANTASTA_DATABASE_PATH: databasePath(),
      },
      stdio: "inherit",
    });
    await waitForHealth(localServerUrl);
    return;
  }
  // Nel pacchetto il server locale e un file Node puro: utilityProcess.fork lo
  // esegue come helper invisibile di Electron, senza icona separata nel Dock
  // (a differenza di child_process.spawn del binario Electron con RUN_AS_NODE,
  // che macOS mostra come seconda app "exec").
  const entrypoint = path.join(process.resourcesPath, "local-server.cjs");
  localService = utilityProcess.fork(entrypoint, [], {
    env: {
      ...process.env,
      FANTASTA_HOST: "0.0.0.0",
      FANTASTA_PORT: new URL(localServerUrl).port || "47821",
      FANTASTA_DATABASE_PATH: databasePath(),
    },
    stdio: "inherit",
  });
  await waitForHealth(localServerUrl);
}

async function waitForRenderer(url) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(new URL("/local/setup", url));
      if (response.ok) return;
    } catch { /* Next standalone sta ancora avviandosi */ }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error("Il renderer locale non ha risposto in tempo");
}

async function startRendererService() {
  if (!app.isPackaged || process.env.FANTASTA_RENDERER_URL) return;
  const port = process.env.FANTASTA_RENDERER_PORT ?? "47822";
  rendererOrigin = `http://127.0.0.1:${port}`;
  const entrypoint = path.join(process.resourcesPath, "web", "apps", "web", "server.js");
  // Il renderer deve essere raggiungibile dalla LAN: il QR del wizard punta a
  // http://<IP-locale>:47822, dove i telefoni caricano la vista partecipante.
  // (In sviluppo il renderer è esposto con `next dev --hostname 0.0.0.0`.)
  rendererService = spawn(process.execPath, [entrypoint], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", HOSTNAME: "0.0.0.0", PORT: port },
    stdio: "inherit",
  });
  await waitForRenderer(rendererOrigin);
}

async function resolveAdminSession() {
  const configured = process.env.FANTASTA_ADMIN_SESSION ?? hostConfig.sessionId;
  if (configured) return configured;
  const response = await fetch(new URL("/api/session", localServerUrl), { method: "POST" });
  if (!response.ok) throw new Error("Impossibile creare la sessione admin locale");
  const payload = await response.json();
  if (!payload.sessionId) throw new Error("Risposta sessione locale non valida");
  await saveHostConfig({ sessionId: payload.sessionId });
  return payload.sessionId;
}

function createWindow(adminSession) {
  const rendererUrl = assertLoopback(rendererOrigin, "FANTASTA_RENDERER_URL");
  const serverUrl = assertLoopback(localServerUrl, "FANTASTA_LOCAL_SERVER_URL");
  const leagueCode = process.env.FANTASTA_LEAGUE_CODE ?? hostConfig.leagueCode;
  const window = new BrowserWindow({
    title: "Fantasta",
    width: 1440,
    height: 940,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    autoHideMenuBar: process.platform !== "darwin",
    backgroundColor: "#f4f8f5",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: true,
    },
  });
  // L'app si apre sempre dalla home: da lì si crea una nuova asta oppure si
  // rientra in regia con la card "Entra nella tua asta" (se c'è una lega salvata).
  const target = new URL("/local/home", rendererUrl);
  // `server` serve a setup/regia: senza, le pagine /local mostrano il fallback
  // "Configurazione desktop mancante".
  target.searchParams.set("server", serverUrl.toString());
  if (leagueCode) target.searchParams.set("league", leagueCode);
  target.searchParams.set("session", adminSession);
  window.once("ready-to-show", () => window.show());
  window.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const external = new URL(url);
      if (external.protocol === "https:" && external.hostname === "github.com") {
        void shell.openExternal(external.toString());
      }
    } catch { /* URL non valido: resta bloccato */ }
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (new URL(url).origin !== rendererUrl.origin) event.preventDefault();
  });
  void window.loadURL(target.toString());
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => BrowserWindow.getAllWindows()[0]?.focus());
  app.whenReady().then(async () => {
    app.setAboutPanelOptions({
      applicationName: "Fantasta",
      applicationVersion: app.getVersion(),
      copyright: "Copyright © 2026 Davide Pirovano",
      website: "https://github.com/Davide-Pirovano/fantasta",
    });
    // Solo write sanificato della clipboard (il "copia link" nel wizard/regia):
    // bloccato qui, navigator.clipboard.writeText fallisce in silenzio nel renderer.
    session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
      callback(permission === "clipboard-sanitized-write");
    });
    try {
      hostConfig = await loadHostConfig();
      await startLocalService();
      await startRendererService();
      const adminSession = await resolveAdminSession();
      ipcMain.handle("fantasta:save-host-config", async (event, update) => {
        assertRenderer(event);
        if (!update || typeof update.leagueCode !== "string" || !/^[A-Z0-9]{4,12}$/i.test(update.leagueCode)) throw new Error("Codice lega non valido");
        await saveHostConfig({ leagueCode: update.leagueCode.toUpperCase() });
      });
      ipcMain.handle("fantasta:export-backup", async (event) => {
        assertRenderer(event);
        return exportBackup();
      });
      ipcMain.handle("fantasta:restore-backup", async (event) => {
        assertRenderer(event);
        return restoreBackup();
      });
      createWindow(adminSession);
    } catch (error) {
      console.error(error);
      app.quit();
    }
  });
}

app.on("window-all-closed", () => app.quit());
app.on("before-quit", () => {
  try { localService?.kill(); } catch {}
  try { rendererService?.kill("SIGTERM"); } catch {}
});
