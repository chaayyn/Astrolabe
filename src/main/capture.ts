// Mode "capture" (outil de développement) : l'app s'ouvre HORS ÉCRAN (rien ne s'affiche, le
// rendu WebGL fonctionne quand même), attend que la scène soit stable, photographie le contenu
// de sa propre fenêtre à la taille exacte demandée (jamais le bureau ni d'autres fenêtres), puis
// quitte.
//
// Il est déclenché par scripts/capture.cjs (`npm run capture`), qui passe la demande dans la
// variable d'environnement ASTROLABE_CAPTURE (JSON). Garde-fou : sans ASTROLABE_VAULT, le mode
// capture refuse de démarrer, pour ne jamais photographier le vrai coffre par erreur.
import { app, type BrowserWindow } from "electron";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

/** Ce qu'il faut photographier. */
export interface CaptureRequest {
  out: string; // fichier PNG de sortie (chemin absolu)
  width: number; // taille du contenu de la fenêtre, en pixels CSS
  height: number;
  wait: number; // attente avant la capture (ms), le temps que la disposition se stabilise
  state: "graph" | "home" | "settings"; // graphe seul, Accueil ouvert, ou Paramètres ouverts
  /** `true` : reprendre les réglages réels de l'utilisateur ; sinon réglages par défaut (dossier temporaire). */
  mySettings?: boolean;
}

/** Lit la demande de capture, ou `null` s'il n'y en a pas. Quitte si elle est invalide. */
export function readCaptureRequest(): CaptureRequest | null {
  const raw = process.env.ASTROLABE_CAPTURE;
  if (!raw) return null;
  if (!process.env.ASTROLABE_VAULT) {
    console.error("[capture] refusé : ASTROLABE_VAULT n'est pas défini (on ne photographie jamais le coffre par défaut).");
    app.exit(2);
    return null;
  }
  try {
    const req = JSON.parse(raw) as CaptureRequest;
    if (!["graph", "home", "settings"].includes(req.state)) throw new Error(`état inconnu : ${req.state}`);
    if (!(req.width > 0 && req.height > 0 && req.wait >= 0 && req.out)) throw new Error("taille, attente ou sortie invalide");
    return req;
  } catch (err) {
    console.error("[capture] demande invalide :", err);
    app.exit(2);
    return null;
  }
}

/** Attend, met la fenêtre dans l'état demandé, la photographie, écrit le PNG et quitte. */
export async function runCapture(win: BrowserWindow, req: CaptureRequest): Promise<void> {
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  // Rendu hors écran à 60 images/s, sans ralentissement pendant l'attente.
  win.webContents.setFrameRate(60);
  win.webContents.setBackgroundThrottling(false);
  await new Promise<void>((resolve) => win.webContents.once("did-finish-load", () => resolve()));
  await wait(req.wait);
  const press = async (keyCode: string) => {
    for (const type of ["keyDown", "char", "keyUp"] as const) win.webContents.sendInputEvent({ type, keyCode });
    await wait(900); // le panneau finit de s'ouvrir
  };
  if (req.state === "home") await press("H");
  if (req.state === "settings") await press(",");
  const image = await win.webContents.capturePage();
  mkdirSync(path.dirname(req.out), { recursive: true });
  writeFileSync(req.out, image.toPNG());
  const size = image.getSize();
  console.log(`[capture] ${req.out} (${size.width}×${size.height} pixels réels)`);
  app.quit();
}
