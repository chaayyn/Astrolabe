// La liste de TOUS les raccourcis clavier et gestes souris de l'app, et le panneau d'aide
// qui l'affiche (touche ?). Une seule liste : l'aide ne peut pas se désynchroniser.
//
// Les gestionnaires eux-mêmes sont dans main.ts (raccourcis globaux), home.ts (flèches et
// Entrée dans la recherche) et engine.ts (souris). Si l'on ajoute ou change un raccourci,
// il faut mettre cette liste à jour au même endroit du code (voir les renvois "AIDE :").
import { span } from "./ui";

export interface Shortcut {
  /** Touches ou geste, affichés comme de petites touches (ex. ["Maj", "glisser"]). */
  keys: string[];
  /** Ce que ça fait. */
  description: string;
  group: "Navigation" | "Vue" | "Dans la recherche" | "Souris" | "Accessibilité";
  /**
   * Raccourci "essentiel" : il apparaît aussi dans la bande en bas de l'écran.
   * `label` : texte court de la bande. `priority` : plus le nombre est petit, plus le raccourci
   * est gardé longtemps quand la fenêtre est étroite (0 : "?", qui mène à tous les autres).
   */
  essential?: { label: string; priority: number };
}

export const SHORTCUTS: readonly Shortcut[] = [
  { group: "Navigation", keys: ["H"], description: "Ouvrir ou fermer l'Accueil, le champ de recherche prêt à taper", essential: { label: "Accueil / Recherche", priority: 1 } },
  { group: "Navigation", keys: [","], description: "Ouvrir ou fermer les Paramètres", essential: { label: "Paramètres", priority: 2 } },
  { group: "Navigation", keys: ["?"], description: "Afficher ou masquer cette aide", essential: { label: "Raccourcis", priority: 0 } },
  { group: "Navigation", keys: ["Échap"], description: "Fermer le tiroir ou la fenêtre ouverte, sinon retirer la mise en évidence d'une étoile" },
  { group: "Navigation", keys: ["B"], description: "Replier ou déplier la barre latérale" },

  { group: "Vue", keys: ["+", "−"], description: "Zoom avant, zoom arrière (maintenir pour un zoom continu)" },
  { group: "Vue", keys: ["0"], description: "Recentrer la vue" },
  { group: "Vue", keys: ["Espace"], description: "Mettre en pause ou relancer la rotation automatique" },
  { group: "Vue", keys: ["F"], description: "Plein écran" },
  { group: "Vue", keys: ["G"], description: "Afficher ou masquer les FPS" },

  { group: "Dans la recherche", keys: ["↑", "↓"], description: "Parcourir les résultats" },
  { group: "Dans la recherche", keys: ["Entrée"], description: "Aller à la note : la caméra vole vers son étoile" },
  { group: "Dans la recherche", keys: ["Échap"], description: "Fermer l'Accueil" },

  { group: "Souris", keys: ["glisser"], description: "Tourner autour du graphe" },
  { group: "Souris", keys: ["molette"], description: "Zoom" },
  { group: "Souris", keys: ["Maj", "glisser"], description: "Déplacer la vue (ou glisser avec le clic droit)" },
  { group: "Souris", keys: ["survol"], description: "Sur une étoile : voir son titre, ses liens et son orbite" },
  { group: "Souris", keys: ["clic"], description: "Sur une note d'un tiroir (Accueil, Notes, Activité, Tâches) : la caméra vole vers son étoile" },

  { group: "Accessibilité", keys: ["Tab", "Maj+Tab"], description: "Parcourir les boutons et les champs" },
  { group: "Accessibilité", keys: ["←", "→"], description: "Sur un curseur des Paramètres : ajuster la valeur" },
];

const GROUP_ORDER: Shortcut["group"][] = ["Navigation", "Vue", "Dans la recherche", "Souris", "Accessibilité"];

const $ = (id: string) => document.getElementById(id)!;

/** Le panneau d'aide : une fenêtre comme les Paramètres, construite à partir de SHORTCUTS. */
export class Help {
  private dialog = $("help") as HTMLDialogElement;
  private openBtn = $("help-open");
  private returnFocus: HTMLElement | null = null;

  constructor() {
    this.render();
    this.openBtn.addEventListener("click", () => this.toggle());
    $("help-close").addEventListener("click", () => this.close());
    // Échap ferme (comportement natif de <dialog>) ; le focus revient où il était.
    this.dialog.addEventListener("close", () => {
      document.body.classList.remove("veiled");
      this.openBtn.setAttribute("aria-expanded", "false");
      this.returnFocus?.focus();
    });
    this.dialog.addEventListener("cancel", () => document.body.classList.remove("veiled"));
    this.dialog.addEventListener("click", (e) => {
      if (e.target === this.dialog) this.close();
    });
  }

  get isOpen(): boolean {
    return this.dialog.open;
  }

  open(): void {
    if (this.isOpen) return;
    this.returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.dialog.showModal(); // <dialog> modal : le focus reste dans le panneau tant qu'il est ouvert
    document.body.classList.add("veiled");
    this.openBtn.setAttribute("aria-expanded", "true");
  }

  close(): void {
    document.body.classList.remove("veiled");
    if (this.isOpen) this.dialog.close();
  }

  toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  /** Une section par groupe : petites touches à gauche, description à droite. */
  private render(): void {
    $("help-body").replaceChildren(
      ...GROUP_ORDER.map((group) => {
        const section = document.createElement("section");
        section.className = "help-group";
        const list = document.createElement("dl");
        list.className = "help-list";
        for (const s of SHORTCUTS.filter((x) => x.group === group)) {
          const keys = document.createElement("dt");
          s.keys.forEach((k, i) => {
            if (i > 0) keys.append(span("help-sep", s.keys.length === 2 && group !== "Souris" ? " " : " + "));
            keys.append(span("keycap", k, "kbd"));
          });
          list.append(keys, span("", s.description, "dd"));
        }
        section.append(span("label", group, "h3"), list);
        return section;
      }),
    );
  }
}

// --- Bande des raccourcis essentiels, en bas de l'écran ------------------------------------

/** Ordre d'affichage dans la bande : celui de la liste, avec "?" toujours à la fin. */
function essentials(): Shortcut[] {
  const list = SHORTCUTS.filter((s) => s.essential);
  return [...list.filter((s) => s.keys[0] !== "?"), ...list.filter((s) => s.keys[0] === "?")];
}

/**
 * Remplit la bande avec les raccourcis essentiels (marqués `essential` dans SHORTCUTS).
 * Si la place manque, on retire d'abord ceux de plus faible priorité : jamais de retour à
 * la ligne ni de débordement. À rappeler quand la largeur disponible change.
 */
export function fitKeybar(bar: HTMLElement): void {
  let shown = essentials();
  const draw = () =>
    bar.replaceChildren(
      ...shown.map((s) => {
        const item = span("keybar-item", "");
        item.append(...s.keys.map((k) => span("keybar-key", k, "kbd")), span("keybar-label", s.essential!.label));
        return item;
      }),
    );
  draw();
  const overflows = () => bar.scrollWidth > bar.clientWidth + 1;
  while (overflows() && shown.length > 0) {
    const worst = Math.max(...shown.map((s) => s.essential!.priority));
    const index = shown.map((s) => s.essential!.priority).lastIndexOf(worst);
    shown = shown.filter((_, i) => i !== index);
    draw(); // plus rien du tout si même un seul raccourci ne tient pas
  }
}
