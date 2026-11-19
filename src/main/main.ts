// Process principal d'Electron : c'est le "programme" Node qui ouvre la fenêtre.
import { app, BrowserWindow, ipcMain } from "electron";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { getActiveTheme, getThemeSettings, loadThemes, setActiveTheme, setThemeSettings } from "./themes";
import { scanVault } from "./vault";
import { watchVault } from "./watcher";

// Nom de l'app et dossier de ses données (réglages) : ~/.config/astrolabe sous Linux.
// Fixé AVANT le démarrage, sinon Electron utiliserait un autre dossier.
app.setName("Astrolabe");
app.setPath("userData", path.join(app.getPath("appData"), "astrolabe"));
migrateOldSettings();

/**
 * L'app s'appelait "Second Cerveau" : ses réglages (thème choisi, couleurs, curseurs) étaient
 * dans ~/.config/second-cerveau. Au premier lancement sous le nouveau nom, on COPIE ce fichier
 * dans le nouveau dossier (l'ancien est laissé tel quel, comme copie de sécurité).
 */
function migrateOldSettings(): void {
  const newFile = path.join(app.getPath("userData"), "settings.json");
  const oldFile = path.join(app.getPath("appData"), "second-cerveau", "settings.json");
  if (existsSync(newFile) || !existsSync(oldFile)) return;
  try {
    mkdirSync(path.dirname(newFile), { recursive: true });
    copyFileSync(oldFile, newFile);
    console.info(`[réglages] repris de l'ancien dossier : ${oldFile}`);
  } catch (err) {
    console.warn("[réglages] impossible de reprendre les anciens réglages :", err);
  }
}

// En dev, `npm run dev` fournit l'adresse du serveur Vite. En build, elle est absente.
const devServerUrl = process.env.VITE_DEV_SERVER_URL;

// Dossier du coffre, relatif à la racine du projet (là où est package.json).
const VAULT_DIR = path.resolve(app.getAppPath(), "./vault");
// Dossier des thèmes, à côté du coffre (jamais dedans).
const THEMES_DIR = path.resolve(app.getAppPath(), "./themes");
// Icône de la fenêtre (barre des tâches, Alt-Tab) : PNG fabriqué par `npm run icons`.
const WINDOW_ICON = path.resolve(app.getAppPath(), "./assets/brand/png/icon-512.png");

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    backgroundColor: "#000000", // évite un flash blanc avant le chargement de la page
    title: "Astrolabe",
    icon: WINDOW_ICON,
    webPreferences: {
      preload: path.join(__dirname, "../preload/preload.js"),
      contextIsolation: true, // la page et le preload ne partagent pas le même JS
      nodeIntegration: false, // la page n'a pas accès à Node (fichiers, processus...)
      sandbox: true, // le preload tourne lui aussi dans un environnement restreint
    },
  });

  // Prévenir la page à chaque entrée/sortie du plein écran (pour changer l'icône du bouton).
  win.on("enter-full-screen", () => win.webContents.send("window:fullscreen", true));
  win.on("leave-full-screen", () => win.webContents.send("window:fullscreen", false));

  if (devServerUrl) {
    win.loadURL(devServerUrl);
  } else {
    win.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
}

app.whenReady().then(() => {
  // Canal "vault:scan" : la page demande, le main lit le disque et renvoie les notes.
  ipcMain.handle("vault:scan", () => scanVault(VAULT_DIR));

  // Canal "window:toggle-fullscreen" : bascule le plein écran de la fenêtre qui le demande.
  ipcMain.on("window:toggle-fullscreen", (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    win?.setFullScreen(!win.isFullScreen());
  });

  // Quand le coffre change : nouveau scan complet, envoyé à toutes les fenêtres
  // sur le canal "vault:changed".
  const stopWatching = watchVault(VAULT_DIR, async () => {
    const result = await scanVault(VAULT_DIR);
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send("vault:changed", result);
    }
  });
  app.on("will-quit", stopWatching);

  // Thèmes : liste, thème choisi, et rechargement à chaud quand un .css ou manifest.json change.
  ipcMain.handle("themes:list", () => loadThemes(THEMES_DIR));
  ipcMain.handle("themes:get", async (_e, id: unknown) =>
    typeof id === "string" ? ((await loadThemes(THEMES_DIR)).find((t) => t.id === id) ?? null) : null,
  );
  ipcMain.handle("themes:get-active", () => getActiveTheme());
  ipcMain.handle("themes:set-active", (_e, id: unknown) => (typeof id === "string" ? setActiveTheme(id) : undefined));
  // Réglages du panneau Paramètres, mémorisés par thème dans le fichier de réglages de l'app.
  ipcMain.handle("themes:get-settings", (_e, id: unknown) =>
    typeof id === "string" ? getThemeSettings(id) : { params: {}, colors: {} },
  );
  ipcMain.handle("themes:set-settings", (_e, id: unknown, data: unknown) =>
    typeof id === "string" ? setThemeSettings(id, data) : undefined,
  );
  const stopThemes = watchVault(
    THEMES_DIR,
    () => {
      for (const win of BrowserWindow.getAllWindows()) win.webContents.send("themes:changed");
    },
    [".css", ".json"],
  );
  app.on("will-quit", stopThemes);

  createWindow();

  // macOS : rouvrir une fenêtre quand on clique sur l'icône du dock.
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Linux/Windows : fermer la dernière fenêtre quitte l'application.
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
