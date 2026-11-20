// Process principal d'Electron : c'est le "programme" Node qui ouvre la fenêtre.
import { app, BrowserWindow, ipcMain, Menu, type Input } from "electron";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { readCaptureRequest, runCapture } from "./capture";
import { getActiveTheme, getThemeSettings, loadThemes, setActiveTheme, setThemeSettings } from "./themes";
import { scanVault } from "./vault";
import { watchVault } from "./watcher";

// Nom de l'app et dossier de ses données (réglages) : ~/.config/astrolabe sous Linux.
// Fixé AVANT le démarrage, sinon Electron utiliserait un autre dossier.
app.setName("Astrolabe");
app.setPath("userData", path.join(app.getPath("appData"), "astrolabe"));

// Mode capture (npm run capture) : photographier la fenêtre puis quitter. `null` sinon.
// Par défaut, la capture part d'un dossier de données vide et temporaire : réglages par défaut
// du thème, jamais ceux de l'utilisateur (images reproductibles). `--my-settings` les reprend.
const capture = readCaptureRequest();
if (capture && !capture.mySettings) {
  const temp = mkdtempSync(path.join(os.tmpdir(), "astrolabe-capture-"));
  app.setPath("userData", temp);
  app.on("will-quit", () => rmSync(temp, { recursive: true, force: true }));
} else {
  migrateOldSettings();
}

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

// Dossier du coffre : `vault/` à la racine du projet (là où est package.json), ou celui que
// donne la variable d'environnement ASTROLABE_VAULT (chemin absolu, ou relatif au dossier
// d'où l'app est lancée). S'il n'existe pas, l'app affiche simplement "Coffre introuvable".
const VAULT_DIR = process.env.ASTROLABE_VAULT
  ? path.resolve(process.env.ASTROLABE_VAULT)
  : path.resolve(app.getAppPath(), "./vault");
// Dossier des thèmes, à côté du coffre (jamais dedans).
const THEMES_DIR = path.resolve(app.getAppPath(), "./themes");
// Icône de la fenêtre (barre des tâches, Alt-Tab) : PNG fabriqué par `npm run icons`.
const WINDOW_ICON = path.resolve(app.getAppPath(), "./assets/brand/png/icon-512.png");

function createWindow(): void {
  const win = new BrowserWindow({
    width: capture?.width ?? 1200,
    height: capture?.height ?? 800,
    useContentSize: capture !== null, // en capture : la taille demandée est celle de l'image
    show: capture === null, // en capture, rien ne s'affiche à l'écran (rendu hors écran)
    backgroundColor: "#000000", // évite un flash blanc avant le chargement de la page
    title: "Astrolabe",
    icon: WINDOW_ICON,
    webPreferences: {
      preload: path.join(__dirname, "../preload/preload.js"),
      contextIsolation: true, // la page et le preload ne partagent pas le même JS
      nodeIntegration: false, // la page n'a pas accès à Node (fichiers, processus...)
      sandbox: true, // le preload tourne lui aussi dans un environnement restreint
      offscreen: capture !== null, // capture : image exacte, sans dépendre du gestionnaire de fenêtres
    },
  });

  if (capture) void runCapture(win, capture);

  // Sans barre de menus, ses raccourcis utiles sont repris ici (voir handleWindowKeys).
  win.webContents.on("before-input-event", (event, input) => {
    if (handleWindowKeys(win, input)) event.preventDefault();
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

/**
 * Pas de barre de menus "File Edit View Window" : l'app a sa propre interface. On la retire
 * entièrement (plutôt que de la cacher : avec `autoHideMenuBar`, la touche Alt la ferait
 * réapparaître). Copier, coller, couper, annuler et tout sélectionner continuent de marcher
 * dans les champs : sous Linux et Windows, c'est la page elle-même qui les gère.
 * Les raccourcis du menu qui restent utiles sont repris par handleWindowKeys.
 */
Menu.setApplicationMenu(null);

/**
 * Raccourcis de fenêtre (repris de l'ancien menu). Renvoie `true` si la touche a été utilisée.
 *   F11 : plein écran · Ctrl+Q : quitter
 *   En développement seulement : F12 ou Ctrl+Maj+I (outils de développement), Ctrl+R ou F5 (recharger).
 */
function handleWindowKeys(win: BrowserWindow, input: Input): boolean {
  if (input.type !== "keyDown") return false;
  const ctrl = input.control || input.meta;
  const key = input.key.toLowerCase();
  if (input.key === "F11" && !ctrl && !input.alt) {
    win.setFullScreen(!win.isFullScreen());
    return true;
  }
  if (ctrl && !input.shift && !input.alt && key === "q") {
    app.quit();
    return true;
  }
  if (!devServerUrl) return false;
  if (input.key === "F12" || (ctrl && input.shift && key === "i")) {
    win.webContents.toggleDevTools();
    return true;
  }
  if (input.key === "F5" || (ctrl && !input.shift && key === "r")) {
    win.webContents.reload();
    return true;
  }
  return false;
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
