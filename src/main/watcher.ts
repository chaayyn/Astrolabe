// Surveillance d'un dossier : prévient quand un fichier suivi est ajouté, modifié, renommé
// ou supprimé. Sert au coffre (.md) et aux thèmes (.css, .json).
// On utilise fs.watch récursif, intégré à Node (pas de dépendance).
import { existsSync, watch, type FSWatcher } from "node:fs";

/** Délai d'attente après le dernier événement avant de prévenir (anti-rafale). */
const DEBOUNCE_MS = 200;
/** Si le coffre est introuvable, on réessaie de le surveiller à ce rythme. */
const RETRY_MS = 2000;

/**
 * Surveille `vaultDir` et appelle `onChange` (au plus une fois par rafale d'événements).
 * `extensions` : types de fichiers suivis (par défaut les notes .md).
 * Renvoie une fonction qui arrête la surveillance.
 */
export function watchVault(vaultDir: string, onChange: () => void, extensions: string[] = [".md"]): () => void {
  let watcher: FSWatcher | null = null;
  let debounceTimer: NodeJS.Timeout | null = null;
  let retryTimer: NodeJS.Timeout | null = null;

  // Une sauvegarde peut produire plusieurs événements : on attend 200 ms de calme.
  function scheduleChange(): void {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      onChange();
    }, DEBOUNCE_MS);
  }

  function start(): void {
    // Sous Linux, fs.watch récursif sur un dossier absent ne signale aucune erreur :
    // il ne fait rien en silence. On vérifie donc nous-mêmes.
    if (!existsSync(vaultDir)) {
      restartLater();
      return;
    }
    try {
      watcher = watch(vaultDir, { recursive: true }, (_event, filename) => {
        if (!isRelevant(filename, extensions)) return;
        scheduleChange();
        // Sous Linux, supprimer/renommer le coffre lui-même coupe le watcher
        // sans erreur : on le détecte ici et on repasse en mode "réessai".
        if (!existsSync(vaultDir)) restartLater();
      });
      // Si le coffre disparaît ou devient illisible, on repasse en mode "réessai".
      watcher.on("error", restartLater);
    } catch {
      // Coffre introuvable au démarrage : on réessaiera plus tard.
      restartLater();
    }
  }

  function restartLater(): void {
    watcher?.close();
    watcher = null;
    if (retryTimer) return;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      start();
      if (watcher) onChange(); // le coffre est (re)venu : on rescanne une fois
    }, RETRY_MS);
  }

  start();

  // Fonction d'arrêt : coupe les minuteurs et la surveillance.
  return () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    if (retryTimer) clearTimeout(retryTimer);
    watcher?.close();
  };
}

/**
 * Dit si un événement nous intéresse, d'après le chemin relatif reçu.
 * On garde : les fichiers suivis (.md pour le coffre), et les noms sans extension
 * (un dossier renommé ou supprimé peut en contenir). On ignore tout ce qui est caché
 * ou dans node_modules.
 */
function isRelevant(filename: string | null, extensions: string[]): boolean {
  if (!filename) return true; // événement sur le coffre lui-même (ex. supprimé)
  const parts = filename.split(/[\\/]/);
  if (parts.some((p) => p.startsWith(".") || p === "node_modules")) return false;
  const last = parts[parts.length - 1];
  return extensions.some((ext) => last.toLowerCase().endsWith(ext)) || !last.includes(".");
}
