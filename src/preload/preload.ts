// Preload : petit script qui s'exécute avant la page, avec contextIsolation.
// Il expose à la page des API minimales et contrôlées : `window.vault`, `window.appWindow` et `window.themes`.
// La page ne reçoit que ces fonctions, jamais un accès direct à Node ou au disque.
import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type { AppWindowApi } from "../shared/app-window";
import type { VaultApi, VaultResult } from "../shared/note";
import type { ThemesApi } from "../shared/theme";

const vault: VaultApi = {
  // Envoie une demande au process principal et attend sa réponse (une Promise).
  scan: () => ipcRenderer.invoke("vault:scan"),

  // Écoute les messages "vault:changed" envoyés par le main.
  onChange: (callback) => {
    // On ne transmet que le résultat, pas l'objet `event` d'Electron (qui donnerait trop d'accès).
    const listener = (_event: IpcRendererEvent, result: VaultResult) => callback(result);
    ipcRenderer.on("vault:changed", listener);
    return () => ipcRenderer.removeListener("vault:changed", listener);
  },
};

contextBridge.exposeInMainWorld("vault", vault);

// Commandes de la fenêtre : uniquement le plein écran, rien d'autre.
const appWindow: AppWindowApi = {
  toggleFullscreen: () => ipcRenderer.send("window:toggle-fullscreen"),
  onFullscreenChange: (callback) => {
    const listener = (_event: IpcRendererEvent, fullscreen: boolean) => callback(fullscreen);
    ipcRenderer.on("window:fullscreen", listener);
    return () => ipcRenderer.removeListener("window:fullscreen", listener);
  },
};

contextBridge.exposeInMainWorld("appWindow", appWindow);

// Thèmes : lecture de la liste, du thème choisi, et avis quand un fichier de thème change.
const themes: ThemesApi = {
  list: () => ipcRenderer.invoke("themes:list"),
  get: (id) => ipcRenderer.invoke("themes:get", id),
  getActive: () => ipcRenderer.invoke("themes:get-active"),
  setActive: (id) => ipcRenderer.invoke("themes:set-active", id),
  getSettings: (id) => ipcRenderer.invoke("themes:get-settings", id),
  setSettings: (id, settings) => ipcRenderer.invoke("themes:set-settings", id, settings),
  onChange: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("themes:changed", listener);
    return () => ipcRenderer.removeListener("themes:changed", listener);
  },
};

contextBridge.exposeInMainWorld("themes", themes);
