// Point d'entrée de la page : demande les notes au main, les affiche en graphe, dans la
// barre latérale et ses tiroirs, et met tout à jour quand le coffre change.
import "./style.css";
// Symbole de la marque : Vite en fait un vrai fichier (jamais une image "data:", refusée par la
// politique de sécurité de la page), au même chemin en développement et une fois l'app compilée.
import symbolUrl from "../../assets/brand/symbol-small.svg";
import type { AppWindowApi } from "../shared/app-window";
import type { Note, VaultApi, VaultResult } from "../shared/note";
import type { ThemesApi } from "../shared/theme";
import { Drawers } from "./drawers";
import { Graph } from "./graph";
import { Home } from "./home";
import { Settings } from "./settings";
import { fitKeybar, Help } from "./shortcuts";
import { Sidebar, type ActivityEvent } from "./sidebar";
import { ThemeManager } from "./themes";
import { Toolbar } from "./toolbar";
import { Engine } from "./engine";

// Dit à TypeScript que le preload a ajouté `window.vault` et `window.appWindow`.
declare global {
  interface Window {
    vault: VaultApi;
    appWindow: AppWindowApi;
    themes: ThemesApi;
  }
}

(document.getElementById("app-logo") as HTMLImageElement).src = symbolUrl;
(document.getElementById("favicon") as HTMLLinkElement).href = symbolUrl;

const errorEl = document.getElementById("error")!;
const syncEl = document.getElementById("sync")!;
const asideEl = document.getElementById("sidebar")!;

const graph = new Graph();
// Le moteur : la scène dessine dans #scene (derrière), le moteur écrit les noms et reçoit
// la souris sur #graph (au-dessus).
const view = new Engine(
  document.getElementById("scene")!,
  document.getElementById("graph") as HTMLCanvasElement,
  graph,
);
// Si la scène du thème ne peut pas démarrer (ex. WebGL2 absent), le moteur affiche la scène
// classique et on le signale discrètement quelques secondes.
const noticeEl = document.getElementById("notice")!;
let noticeTimer = 0;
view.onSceneFallback = (message) => {
  noticeEl.textContent = message;
  noticeEl.hidden = false;
  clearTimeout(noticeTimer);
  noticeTimer = window.setTimeout(() => (noticeEl.hidden = true), 8000);
};
const toolbar = new Toolbar(view, window.appWindow);
// Thème : appliqué au démarrage, puis à chaque choix ou modification d'un fichier de thème.
// Le panneau Paramètres installe alors la scène du thème et ses réglages mémorisés.
const themes = new ThemeManager(window.themes, (theme) => void settings.switchTheme(theme));
const settings = new Settings(view, toolbar, window.themes, themes);
// Icône "réglages" en haut à droite : ouvre le même panneau que l'entrée de la barre latérale.
document.getElementById("corner-settings")!.addEventListener("click", () => settings.toggle());
const help = new Help();
// Lien "Raccourcis" en bas des Paramètres : on ferme les Paramètres puis on ouvre l'aide.
document.getElementById("settings-shortcuts")!.addEventListener("click", () => {
  settings.close();
  help.open();
});
themes.start().catch((err: unknown) => {
  console.warn("[thèmes] chargement impossible :", err);
});
// Tiroirs (Accueil, Notes, Activité, Tâches) : un seul ouvert à la fois.
const drawers = new Drawers();
const home = new Home(graph, drawers, {
  onPickNote: (path) => view.select(path),
  onPickFolder: (folder) => view.focusOrbit(folder),
});

/**
 * Largeur cachée à gauche : la barre latérale (si elle est dépliée) et le tiroir ouvert.
 * Le graphe se centre dans ce qui reste, pour qu'une étoile visée ne soit jamais dessous.
 */
function panelInset(): number {
  let right = asideEl.classList.contains("collapsed") ? 0 : asideEl.getBoundingClientRect().right;
  const drawer = drawers.element;
  if (drawer) right = Math.max(right, drawer.getBoundingClientRect().right);
  // Fenêtre étroite : si le tiroir prend presque tout, on garde le graphe centré sur la fenêtre.
  return right > window.innerWidth - 240 ? 0 : right;
}

/** Le graphe se centre dans l'espace libre ; la bande des raccourcis s'ajuste à la place restante. */
const keybar = document.getElementById("keybar")!;
/**
 * Réajuste la bande APRÈS la mise en page (image suivante) : mesurer plus tôt donnait une
 * largeur périmée, et du texte coupé dans une fenêtre étroite.
 */
let fitFrame = 0;
function refitKeybar(): void {
  cancelAnimationFrame(fitFrame);
  fitFrame = requestAnimationFrame(() => fitKeybar(keybar));
}
function setInset(px: number): void {
  view.setLeftInset(px);
  document.documentElement.style.setProperty("--inset", `${px}px`);
  refitKeybar(); // la place disponible a changé : moins (ou plus) de raccourcis dans la bande
}
void document.fonts.ready.then(refitKeybar); // largeurs du texte justes une fois les polices prêtes

const sidebar = new Sidebar({
  onHover: (path) => view.setPanelHover(path),
  onSelect: (path) => view.select(path),
  onFocusFolder: (folder) => view.focusOrbit(folder),
  onToggle: () => setInset(panelInset()),
});
drawers.onChange = () => setInset(panelInset());
setInset(panelInset());
window.addEventListener("resize", () => setInset(panelInset()));

/**
 * Anneaux de focus : visibles seulement pendant une vraie navigation au clavier (Tab, flèches).
 * Le navigateur les montre aussi après n'importe quelle touche (donc après un raccourci comme B
 * ou G) sur le bouton qui garde le focus, par exemple l'engrenage après la fermeture des
 * Paramètres : on note donc nous-mêmes la façon dont l'utilisateur se déplace.
 */
const setInputMode = (mode: "pointer" | "keyboard") => (document.documentElement.dataset.input = mode);
setInputMode("pointer");
window.addEventListener("pointerdown", () => setInputMode("pointer"), true);
window.addEventListener(
  "keydown",
  (e) => {
    if (["Tab", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) setInputMode("keyboard");
  },
  true,
);

/** Vrai si l'utilisateur est en train d'écrire (champ de saisie) : les raccourcis se taisent. */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

// AIDE : chaque raccourci ci-dessous est aussi décrit dans SHORTCUTS (shortcuts.ts).
// Raccourcis clavier. Règle : on lit le CARACTÈRE produit (e.key), jamais la position de la
// touche (e.code), et Maj n'est jamais refusée : sur AZERTY, "?" = Maj + ",",
// "0" = Maj + "à", "+" = Maj + "=" (ou les touches du pavé numérique, qui donnent les mêmes
// caractères sans Maj).
//   H Accueil (avec sa recherche) · , paramètres · B barre latérale · + / − zoom · 0 recentrer
//   Espace pause · F plein écran · G compteur FPS · Échap ferme le tiroir ouvert, sinon
//   retire la mise en évidence (les fenêtres Paramètres et Aide se ferment nativement).
window.addEventListener("keydown", (e) => {
  // Pas de raccourci avec Ctrl/Alt/Cmd, pendant la saisie dans un champ, ni pendant la
  // composition d'un caractère accentué (méthode de saisie / touche morte). AltGr (vu comme
  // Ctrl + Alt sur certains systèmes) est donc ignoré aussi : aucun raccourci n'en dépend.
  if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing || isTyping(e.target)) return;
  const key = e.key.toLowerCase();

  // Aide ouverte : seule la touche ? (pour fermer) agit ; Échap ferme nativement.
  if (help.isOpen) {
    if (key === "?") {
      e.preventDefault();
      help.close();
    }
    return;
  }

  // Paramètres ouverts : seule la virgule (pour fermer) agit ; Échap ferme nativement.
  if (settings.isOpen) {
    if (key === ",") {
      e.preventDefault();
      settings.close();
    }
    return;
  }
  // H et "," : on annule la frappe avant d'ouvrir. Sinon, comme l'ouverture met le focus
  // dans un champ (la recherche de l'Accueil), le caractère "h" ou "," s'y écrirait aussitôt.
  if (key === "h" && !e.repeat) {
    e.preventDefault();
    return home.toggle();
  }
  if (key === "," && !e.repeat) {
    e.preventDefault();
    return settings.open();
  }
  // "?" (Maj + / en QWERTY, Maj + , en AZERTY) : l'aide des raccourcis. Frappe annulée,
  // pour qu'aucun "?" ne s'écrive nulle part.
  if (key === "?" && !e.repeat) {
    e.preventDefault();
    return help.open();
  }
  // Les tiroirs ne sont pas des fenêtres modales : les commandes de la vue restent actives.

  // Zoom : on accepte les touches maintenues (zoom continu).
  if (key === "+") return toolbar.zoomIn();
  if (key === "-") return toolbar.zoomOut();
  if (e.repeat) return; // pour les bascules, une pression = une action

  if (key === "0") toolbar.recenter();
  else if (key === " ") {
    // Sur un bouton, Espace garde son rôle normal (l'activer) : pas de pause dans ce cas.
    if (e.target instanceof HTMLButtonElement) return;
    e.preventDefault();
    toolbar.togglePause();
  } else if (key === "f") toolbar.toggleFullscreen();
  else if (key === "g") settings.toggleFps();
  else if (key === "b") sidebar.toggle();
  else if (key === "escape") {
    if (drawers.isOpen()) drawers.close();
    else view.select(null);
  }
});

/**
 * Date de modification de chaque note au dernier affichage (chemin → date).
 * `null` tant que rien n'a été affiché : au premier affichage, rien ne s'illumine.
 */
let previous: Map<string, number> | null = null;

/**
 * Notes au dernier affichage réussi, pour le journal d'activité (chemin → note).
 * `null` avant le premier scan : le journal démarre vide.
 */
let known: Map<string, Note> | null = null;

/** Relance une animation CSS même si la classe est déjà présente. */
function replay(node: HTMLElement, className: string): void {
  node.classList.remove(className);
  void node.offsetWidth; // force le navigateur à "oublier" l'animation précédente
  node.classList.add(className);
}

/** Affiche un résultat de lecture : le graphe, ou le message d'erreur. */
function show(result: VaultResult): void {
  if (!result.ok) {
    errorEl.textContent = result.error;
    errorEl.hidden = false;
    graph.update([], new Set());
    previous = new Map(); // au retour du coffre, toutes les étoiles s'illumineront
    // Le journal garde son point de comparaison : au retour du coffre, seules les vraies
    // différences seront notées (et pas toutes les notes comme "ajoutées").
    sidebar.update([], [{ time: Date.now(), kind: "error", path: "", text: result.error, folder: "" }]);
    home.update([]);
    return;
  }
  errorEl.hidden = true;
  render(result.notes);
}

/** Met à jour le graphe, la barre latérale et ses tiroirs. */
function render(notes: Note[]): void {
  // Notes nouvelles (absentes avant) ou modifiées (date différente) : halo doré bref.
  const changed = new Set(
    previous ? notes.filter((n) => previous!.get(n.path) !== n.modified).map((n) => n.path) : [],
  );
  graph.update(notes, changed);
  view.dataChanged();
  previous = new Map(notes.map((n) => [n.path, n.modified]));

  sidebar.update(notes, known ? diff(known, notes) : []);
  home.update(notes);
  known = new Map(notes.map((n) => [n.path, n]));
}

/** Compare l'ancien et le nouveau scan : notes ajoutées, modifiées, supprimées. */
function diff(before: Map<string, Note>, notes: Note[]): ActivityEvent[] {
  const now = Date.now();
  const events: ActivityEvent[] = [];
  const event = (kind: ActivityEvent["kind"], n: Note) =>
    events.push({ time: now, kind, path: n.path, text: n.title, folder: n.folder });

  const after = new Set(notes.map((n) => n.path));
  for (const n of notes) {
    const old = before.get(n.path);
    if (!old) event("added", n);
    else if (old.modified !== n.modified) event("modified", n);
  }
  for (const old of before.values()) if (!after.has(old.path)) event("removed", old);
  return events;
}

// Premier affichage, puis mise à jour à chaque changement du coffre.
window.vault.scan().then(show, (err: unknown) => show({ ok: false, error: String(err) }));

window.vault.onChange((result) => {
  show(result);
  replay(syncEl, "pulse");
});
