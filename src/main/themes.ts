// Thèmes : lecture du dossier themes/ (lecture seule) et du petit fichier de réglages
// de l'app (qui mémorise le thème choisi). Rien n'est jamais écrit dans le coffre.
import { app } from "electron";
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type { Theme, ThemeSettings } from "../shared/theme";

/** Thème utilisé quand aucun n'a été choisi, ou si le thème choisi a disparu. */
export const DEFAULT_THEME = "galaxie";

/** Un identifiant sûr : lettres, chiffres et tirets seulement (pas de "../"). */
const SAFE_ID = /^[a-z0-9][a-z0-9-]*$/i;
/** Un nom de fichier CSS simple, dans le dossier du thème (pas de sous-dossier). */
const SAFE_CSS_FILE = /^[\w-]+\.css$/i;

/**
 * Lit tous les thèmes valides de `themesDir`. Un thème invalide est ignoré, avec
 * un message sobre dans la console : jamais de plantage.
 */
export async function loadThemes(themesDir: string): Promise<Theme[]> {
  let entries;
  try {
    entries = await readdir(themesDir, { withFileTypes: true });
  } catch {
    console.warn(`[thèmes] dossier introuvable : ${themesDir}`);
    return [];
  }
  const themes: Theme[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const theme = await loadTheme(path.join(themesDir, entry.name), entry.name);
    if (theme) themes.push(theme);
  }
  return themes.sort((a, b) => a.name.localeCompare(b.name));
}

/** Lit et vérifie un thème. Renvoie `null` (et explique pourquoi) s'il est invalide. */
async function loadTheme(dir: string, folderName: string): Promise<Theme | null> {
  const skip = (reason: string) => {
    console.warn(`[thèmes] "${folderName}" ignoré : ${reason}`);
    return null;
  };

  let manifest: Record<string, unknown>;
  try {
    manifest = JSON.parse(await readFile(path.join(dir, "manifest.json"), "utf8"));
  } catch (err) {
    return skip(`manifest.json absent ou illisible (${(err as Error).message})`);
  }
  if (typeof manifest !== "object" || manifest === null) return skip("manifest.json doit être un objet");

  // Champs requis.
  for (const field of ["id", "name", "version"]) {
    if (typeof manifest[field] !== "string" || manifest[field] === "") return skip(`champ "${field}" manquant`);
  }
  const id = manifest.id as string;
  if (!SAFE_ID.test(id)) return skip(`id "${id}" invalide (lettres, chiffres et tirets seulement)`);
  if (id !== folderName) return skip(`l'id "${id}" doit être le nom du dossier`);

  // Fichier CSS : "theme.css" par défaut, toujours dans le dossier du thème.
  const style = manifest.style ?? "theme.css";
  if (typeof style !== "string" || !SAFE_CSS_FILE.test(style)) return skip(`"style" doit être un nom de fichier .css simple`);
  let css: string;
  try {
    css = await readFile(path.join(dir, style), "utf8");
  } catch {
    return skip(`fichier ${style} introuvable`);
  }

  // Scène (facultative) : seulement un NOM de scène livrée avec l'app, jamais un chemin.
  // Un nom bien formé mais inconnu sera remplacé par "classique" dans la page.
  const scene = manifest.scene;
  if (scene !== undefined && (typeof scene !== "string" || !SAFE_ID.test(scene))) {
    return skip(`"scene" doit être un nom simple (lettres, chiffres, tirets)`);
  }

  const optional = (field: string) => (typeof manifest[field] === "string" ? (manifest[field] as string) : undefined);
  return {
    id,
    name: manifest.name as string,
    version: manifest.version as string,
    author: optional("author"),
    description: optional("description"),
    scene: scene as string | undefined,
    css,
  };
}

// --- Réglages de l'app (thème choisi) --------------------------------------------------

/** Fichier de réglages, dans le dossier de données de l'app (jamais dans le coffre). */
function settingsFile(): string {
  return path.join(app.getPath("userData"), "settings.json");
}

/** Lit les réglages ; renvoie `{}` s'ils n'existent pas encore ou sont illisibles. */
async function readSettings(): Promise<Record<string, unknown>> {
  try {
    const data = JSON.parse(await readFile(settingsFile(), "utf8"));
    return typeof data === "object" && data !== null ? data : {};
  } catch {
    return {};
  }
}

/** Identifiant du thème choisi (par défaut : galaxie). */
export async function getActiveTheme(): Promise<string> {
  const settings = await readSettings();
  return typeof settings.theme === "string" && SAFE_ID.test(settings.theme) ? settings.theme : DEFAULT_THEME;
}

/** Mémorise le thème choisi (seul le champ "theme" du fichier de réglages change). */
export async function setActiveTheme(id: string): Promise<void> {
  if (!SAFE_ID.test(id)) return;
  await queued(async () => writeSettings({ ...(await readSettings()), theme: id }));
}

/**
 * Les modifications du fichier de réglages passent l'une après l'autre (lire, changer,
 * écrire) : deux enregistrements rapprochés ne peuvent pas s'écraser mutuellement.
 */
let writes: Promise<unknown> = Promise.resolve();
function queued<T>(task: () => Promise<T>): Promise<T> {
  const run = writes.then(task, task);
  writes = run.catch(() => undefined);
  return run;
}

/**
 * Version du format du fichier de réglages. Format 1 :
 * { version: 1, theme: "galaxie", themes: { galaxie: { params: {…}, colors: {…} } } }
 */
const SETTINGS_VERSION = 1;

async function writeSettings(settings: Record<string, unknown>): Promise<void> {
  await mkdir(path.dirname(settingsFile()), { recursive: true });
  await writeFile(settingsFile(), JSON.stringify({ ...settings, version: SETTINGS_VERSION }, null, 2), "utf8");
}

/**
 * Nettoie des réglages venus du fichier ou de la page : on ne garde que des valeurs simples
 * (nombres, cases, textes courts) et des couleurs "#rrggbb". La page vérifie ensuite chaque
 * valeur contre la fiche du réglage (bornes, type) et ignore ce qu'elle ne connaît pas.
 */
function cleanSettings(data: unknown): ThemeSettings {
  const out: ThemeSettings = { params: {}, colors: {} };
  if (typeof data !== "object" || data === null) return out;
  const { params, colors } = data as Record<string, unknown>;
  const safeKey = (k: string) => k.length <= 64 && /^[\w.-]+$/.test(k);
  if (typeof params === "object" && params !== null) {
    for (const [k, v] of Object.entries(params).slice(0, 100)) {
      if (!safeKey(k)) continue;
      if (typeof v === "boolean" || (typeof v === "number" && Number.isFinite(v)) || (typeof v === "string" && v.length <= 64)) {
        out.params[k] = v;
      }
    }
  }
  if (typeof colors === "object" && colors !== null) {
    for (const [k, v] of Object.entries(colors).slice(0, 50)) {
      if (/^--sc-[a-z-]+$/.test(k) && typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v)) out.colors[k] = v;
    }
  }
  return out;
}

/** Réglages mémorisés pour un thème (vides s'il n'y en a pas, ou si le fichier est abîmé). */
export async function getThemeSettings(id: string): Promise<ThemeSettings> {
  if (!SAFE_ID.test(id)) return { params: {}, colors: {} };
  const themes = (await readSettings()).themes;
  const entry = typeof themes === "object" && themes !== null ? (themes as Record<string, unknown>)[id] : undefined;
  return cleanSettings(entry);
}

/** Mémorise les réglages d'un thème (les autres thèmes et le thème actif ne changent pas). */
export async function setThemeSettings(id: string, data: unknown): Promise<void> {
  if (!SAFE_ID.test(id)) return;
  await queued(async () => {
    const settings = await readSettings();
    const themes =
      typeof settings.themes === "object" && settings.themes !== null ? { ...(settings.themes as object) } : {};
    (themes as Record<string, ThemeSettings>)[id] = cleanSettings(data);
    await writeSettings({ ...settings, themes });
  });
}
