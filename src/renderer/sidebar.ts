// Barre latérale gauche et contenu de trois tiroirs :
//   - Notes : l'arborescence du coffre ;
//   - Activité : stats du coffre, 5 dernières modifications, courbe 14 jours, journal en direct ;
//   - Tâches : les tâches ouvertes (leur nombre est aussi rappelé dans la navigation).
// Elle ne fait qu'afficher ; elle prévient le graphe quand on survole ou choisit une note.
// Le squelette HTML est dans index.html : ici on ne remplit que les contenus, ce qui garde
// l'état (dossiers repliés, défilement) d'une mise à jour à l'autre.
import pkg from "../../package.json";
import type { Note } from "../shared/note";
import { drawSparkline, perDay, setValue, shortAge, span } from "./ui";

/** Un événement du journal d'activité. */
export interface ActivityEvent {
  /** Heure de détection (ms depuis 1970). */
  time: number;
  kind: "added" | "modified" | "removed" | "error";
  /** Chemin de la note (vide pour une erreur). */
  path: string;
  /** Texte affiché : titre de la note, ou message d'erreur. */
  text: string;
  folder: string;
}

/** Ce que le rail signale au reste de l'application. */
export interface SidebarCallbacks {
  /** Survol d'une note (`null` quand on la quitte). */
  onHover(path: string | null): void;
  /** Clic sur une note. */
  onSelect(path: string): void;
  /** La barre latérale vient d'être repliée (`false`) ou dépliée (`true`). */
  onToggle(open: boolean): void;
}

const RECENT_ROWS = 5;
/** En dessous de cette largeur de fenêtre (px), la barre latérale démarre repliée. */
const NARROW_PX = 760;
const ACTIVITY_DAYS = 14;
const ACTIVITY_LIMIT = 50;

const KIND_LABEL: Record<ActivityEvent["kind"], string> = {
  added: "ajoutée",
  modified: "modifiée",
  removed: "supprimée",
  error: "erreur",
};

const $ = (id: string) => document.getElementById(id)!;

export class Sidebar {
  private notes: Note[] = [];
  private activity: ActivityEvent[] = [];
  /** Dossiers repliés dans l'arborescence (par défaut tout est déplié). */
  private collapsed = new Set<string>();
  private open = true;

  constructor(private callbacks: SidebarCallbacks) {
    $("app-version").textContent = `v${pkg.version}`;

    $("sidebar-collapse").addEventListener("click", () => this.toggle());
    $("sidebar-open").addEventListener("click", () => this.toggle());

    // Fenêtre étroite au démarrage : la barre commence repliée, pour laisser la place au graphe.
    if (window.innerWidth < NARROW_PX) this.setOpen(false);

    // Les durées relatives ("5m", "2h") vieillissent : on les rafraîchit chaque minute.
    setInterval(() => this.renderRecent(), 60_000);
  }

  get isOpen(): boolean {
    return this.open;
  }

  /** Replie la barre (elle disparaît, un petit bouton carré permet de la rouvrir) ou la déplie. */
  toggle(): void {
    this.setOpen(!this.open);
    // Le focus suit : sur le bouton qui permet de faire l'inverse.
    const target = $(this.open ? "sidebar-collapse" : "sidebar-open");
    if (document.activeElement === document.body || $("sidebar").contains(document.activeElement) || document.activeElement?.id === "sidebar-open") target.focus();
  }

  private setOpen(open: boolean): void {
    this.open = open;
    $("sidebar").classList.toggle("collapsed", !open);
    $("sidebar").toggleAttribute("inert", !open); // repliée : rien n'y prend le focus
    $("sidebar-open").hidden = open;
    this.callbacks.onToggle(open);
  }

  /** Nouvelles données du coffre : tout le rail est mis à jour. */
  update(notes: Note[], events: ActivityEvent[]): void {
    this.notes = notes;
    // Les plus récents en haut, 50 au maximum.
    this.activity = [...[...events].reverse(), ...this.activity].slice(0, ACTIVITY_LIMIT);
    this.renderStats();
    this.renderRecent();
    this.renderActivity();
    this.renderTasks();
    this.renderJournal();
    this.renderTree();
  }

  // --- Ligne de stats ------------------------------------------------------------------

  private renderStats(): void {
    const folders = new Set<string>();
    for (const n of this.notes) {
      // Un dossier compte aussi ses parents : "Projets/Archives" → "Projets" et "Projets/Archives".
      const parts = n.folder ? n.folder.split("/") : [];
      parts.forEach((_, i) => folders.add(parts.slice(0, i + 1).join("/")));
    }
    const links = this.notes.reduce((s, n) => s + n.links.length, 0);
    const tags = new Set(this.notes.flatMap((n) => n.tags)).size;
    const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? "s" : ""}`;
    setValue(
      $("rail-stats"),
      [plural(this.notes.length, "note"), plural(links, "lien"), plural(folders.size, "dossier"), plural(tags, "tag")].join(
        " · ",
      ),
    );
  }

  // --- Récemment ---------------------------------------------------------------------

  private renderRecent(): void {
    const recent = [...this.notes].sort((a, b) => b.modified - a.modified).slice(0, RECENT_ROWS);
    $("recent-list").replaceChildren(
      ...(recent.length === 0
        ? [span("empty", "Aucune note pour l'instant", "li")]
        : recent.map((n) => this.noteLine(n.path, n.title, shortAge(n.modified)))),
    );
  }

  // --- Courbe d'activité -------------------------------------------------------------

  private renderActivity(): void {
    // Nombre de notes dont la dernière modification tombe sur chacun des 14 derniers jours.
    const counts = perDay(this.notes, ACTIVITY_DAYS, (n) => n.modified);
    drawSparkline(
      $("activity-spark") as unknown as SVGSVGElement,
      counts,
      260,
      44,
      "Notes modifiées par jour sur 14 jours",
    );
  }

  // --- Tâches ouvertes ----------------------------------------------------------------

  private renderTasks(): void {
    const tasks = this.notes.flatMap((n) => n.tasks.map((text) => ({ text, note: n })));
    const count = tasks.length === 0 ? "" : String(tasks.length);
    setValue($("tasks-count"), count);
    setValue($("nav-tasks-count"), count);
    $("tasks-list").replaceChildren(
      ...(tasks.length === 0
        ? [span("empty", "Aucune tâche ouverte", "li")]
        : tasks.map((t) => this.noteLine(t.note.path, t.text, t.note.name))),
    );
  }

  // --- Journal des événements depuis le lancement ------------------------------------

  private renderJournal(): void {
    const list = document.createElement("ul");
    list.className = "lines";
    if (this.activity.length === 0) {
      list.append(span("empty", "Rien de nouveau depuis le lancement", "li"));
    }
    const exists = new Set(this.notes.map((n) => n.path));
    for (const ev of this.activity) {
      const meta = `${clock(ev.time)} ${KIND_LABEL[ev.kind]}`;
      // Une note supprimée n'a plus d'étoile : la ligne n'est pas cliquable.
      if (ev.kind !== "error" && ev.kind !== "removed" && exists.has(ev.path)) {
        list.append(this.noteLine(ev.path, ev.text, meta, `kind-${ev.kind}`));
      } else {
        const li = document.createElement("li");
        const div = document.createElement("div");
        div.className = `line kind-${ev.kind}`;
        div.append(span("line-name", ev.text), span("line-meta", meta));
        li.append(div);
        list.append(li);
      }
    }
    $("journal").replaceChildren(list);
  }

  // --- Arborescence --------------------------------------------------------------------

  private renderTree(): void {
    $("tree").replaceChildren(
      this.notes.length === 0 ? span("empty", "Coffre vide", "p") : this.treeList(buildTree(this.notes), 0),
    );
  }

  /** Une liste <ul> pour un dossier : sous-dossiers d'abord, puis notes, par ordre alphabétique. */
  private treeList(folder: Folder, depth: number): HTMLElement {
    const ul = document.createElement("ul");
    ul.className = "tree";
    ul.setAttribute("role", depth === 0 ? "tree" : "group");

    for (const child of [...folder.folders.values()].sort((a, b) => a.name.localeCompare(b.name))) {
      const li = document.createElement("li");
      const isOpen = !this.collapsed.has(child.path);
      const btn = document.createElement("button");
      btn.className = "line folder";
      btn.style.paddingLeft = `${depth * 14}px`;
      btn.setAttribute("aria-expanded", String(isOpen));
      btn.dataset.folder = child.path;
      btn.append(span("twisty", isOpen ? "▾" : "▸"), span("line-name", child.name), span("line-meta", String(child.count)));
      // Un dossier ne fait que se replier/déplier.
      btn.addEventListener("click", () => {
        if (isOpen) this.collapsed.add(child.path);
        else this.collapsed.delete(child.path);
        this.renderTree();
        // Après le redessin, le focus clavier reste sur ce dossier.
        $("tree").querySelector<HTMLButtonElement>(`button[data-folder="${CSS.escape(child.path)}"]`)?.focus();
      });
      li.append(btn);
      if (isOpen) li.append(this.treeList(child, depth + 1));
      ul.append(li);
    }

    for (const note of [...folder.notes].sort((a, b) => a.name.localeCompare(b.name))) {
      const row = this.noteLine(note.path, note.name, "");
      (row.firstElementChild as HTMLElement).style.paddingLeft = `${18 + depth * 14}px`;
      ul.append(row);
    }
    return ul;
  }

  // --- Éléments communs ----------------------------------------------------------------

  /**
   * Ligne cliquable liée à une note : nom à gauche, info à droite.
   * Survol (ou focus clavier) → l'étoile s'éclaire ; clic (ou Entrée) → la caméra y va.
   */
  private noteLine(path: string, name: string, meta: string, extraClass = ""): HTMLLIElement {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.className = `line ${extraClass}`.trim();
    btn.append(span("line-name", name), span("line-meta", meta));
    btn.addEventListener("mouseenter", () => this.callbacks.onHover(path));
    btn.addEventListener("mouseleave", () => this.callbacks.onHover(null));
    btn.addEventListener("focus", () => this.callbacks.onHover(path));
    btn.addEventListener("blur", () => this.callbacks.onHover(null));
    btn.addEventListener("click", () => this.callbacks.onSelect(path));
    li.append(btn);
    return li;
  }
}

// --- Arborescence ----------------------------------------------------------------------

interface Folder {
  name: string;
  path: string;
  folders: Map<string, Folder>;
  notes: Note[];
  /** Nombre de notes dans ce dossier et ses sous-dossiers. */
  count: number;
}

/** Range les notes dans une arborescence de dossiers, d'après leur champ `folder`. */
function buildTree(notes: Note[]): Folder {
  const root: Folder = { name: "", path: "", folders: new Map(), notes: [], count: 0 };
  for (const note of notes) {
    let current = root;
    current.count++;
    if (note.folder !== "") {
      for (const part of note.folder.split("/")) {
        const path = current.path ? `${current.path}/${part}` : part;
        if (!current.folders.has(part)) {
          current.folders.set(part, { name: part, path, folders: new Map(), notes: [], count: 0 });
        }
        current = current.folders.get(part)!;
        current.count++;
      }
    }
    current.notes.push(note);
  }
  return root;
}

/** Heure "14:03". */
function clock(ms: number): string {
  return new Date(ms).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}
