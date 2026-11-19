// Accueil (anciennement "Home") : le tiroir le plus large, à droite de la barre latérale,
// avec la recherche, 4 grands chiffres, une courbe de 30 jours et trois listes simples.
// Il ne fait qu'afficher ; un clic sur une note ou un dossier ferme le tiroir et demande à
// la caméra d'y aller. Le squelette HTML est dans index.html (#drawer-home).
import type { Note } from "../shared/note";
import type { Drawers } from "./drawers";
import type { Graph } from "./graph";
import { highlight, search, type SearchHit } from "./search";
import { DAY, drawSparkline, perDay, setValue, shortAge, span } from "./ui";

/** Ce que la fenêtre Home signale au reste de l'application. */
export interface HomeCallbacks {
  /** Clic (ou Entrée) sur une note : la caméra vole vers son étoile. */
  onPickNote(path: string): void;
  /** Clic sur un dossier : la caméra vole vers son orbite ("" = racine, le trou noir). */
  onPickFolder(folder: string): void;
}

const $ = (id: string) => document.getElementById(id)!;
/** Les 4 grands chiffres (créés une fois, puis seules les valeurs changent). */
const FIGURES = ["notes", "sections", "links", "updated"] as const;
const FIGURE_LABELS: Record<(typeof FIGURES)[number], string> = {
  notes: "Notes",
  sections: "Sections",
  links: "Liens",
  updated: "Mis à jour 7j",
};
const LIST_ROWS = 5;

export class Home {
  private notes: Note[] = [];
  private hits: SearchHit[] = [];
  /** Résultat surligné au clavier (↑ / ↓), -1 = aucun. */
  private active = -1;
  private input = $("home-search") as HTMLInputElement;
  private results = $("home-results");

  constructor(
    private graph: Graph,
    private drawers: Drawers,
    private callbacks: HomeCallbacks,
  ) {
    // Le faux champ de recherche de la barre latérale ouvre l'Accueil, curseur dans la recherche.
    $("search-open").addEventListener("click", () => this.open());
    // L'entrée "Accueil" de la navigation ouvre le tiroir ; on y prépare alors la recherche.
    document.querySelector('.nav-item[data-drawer="home"]')!.addEventListener("click", () => {
      if (this.isOpen) this.prepare();
    });

    this.input.addEventListener("input", () => {
      this.active = -1;
      this.renderResults();
    });
    this.input.addEventListener("keydown", (e) => this.onSearchKey(e));

    this.buildFigures();
  }

  get isOpen(): boolean {
    return this.drawers.isOpen("home");
  }

  /** Ouvre le tiroir et met le focus dans la recherche (texte déjà tapé sélectionné). */
  open(): void {
    this.drawers.open("home", this.input);
    this.prepare();
  }

  /** Date du jour en tête, curseur dans la recherche. */
  private prepare(): void {
    $("home-date").textContent = new Date().toLocaleDateString("fr-FR", {
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
    });
    this.input.focus();
    this.input.select();
  }

  close(): void {
    if (this.isOpen) this.drawers.close();
  }

  toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  /** Nouvelles données du coffre : tout est mis à jour, la recherche en cours est conservée. */
  update(notes: Note[]): void {
    this.notes = notes;
    this.renderFigures();
    this.renderSpark();
    this.renderTopConnected();
    this.renderGroups();
    this.renderRecent();
    this.renderResults();
  }

  // --- Recherche ---------------------------------------------------------------------

  private renderResults(): void {
    const query = this.input.value;
    this.hits = search(this.notes, query);
    if (this.active >= this.hits.length) this.active = this.hits.length - 1;

    this.input.setAttribute("aria-expanded", String(this.hits.length > 0));
    this.results.hidden = query.trim() === "";
    if (query.trim() !== "" && this.hits.length === 0) {
      this.results.replaceChildren(span("empty", "Aucune note ne correspond", "li"));
      return;
    }

    this.results.replaceChildren(
      ...this.hits.map((hit, i) => {
        const li = document.createElement("li");
        li.id = `home-opt-${i}`;
        li.className = "result";
        li.setAttribute("role", "option");
        li.setAttribute("aria-selected", String(i === this.active));
        const title = span("result-title", "");
        title.append(...highlight(hit.note.title, query));
        const snippet = span("result-snippet", "");
        snippet.append(...highlight(hit.snippet, query));
        li.append(title, span("result-folder", hit.note.folder || "/"), snippet);
        li.addEventListener("mousemove", () => this.setActive(i));
        li.addEventListener("click", () => this.pickNote(hit.note.path));
        return li;
      }),
    );
    this.syncActive();
  }

  /**
   * ↑ / ↓ parcourent les résultats, Entrée choisit (le premier s'il n'y en a pas de surligné).
   * AIDE : décrits aussi dans SHORTCUTS (shortcuts.ts), groupe "Dans la recherche".
   */
  private onSearchKey(e: KeyboardEvent): void {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (this.hits.length === 0) return;
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      this.setActive((this.active + step + this.hits.length) % this.hits.length);
    } else if (e.key === "Enter") {
      const hit = this.hits[Math.max(0, this.active)];
      if (hit) this.pickNote(hit.note.path);
    }
  }

  private setActive(i: number): void {
    this.active = i;
    this.syncActive();
  }

  /** Reporte le résultat actif sur la liste et sur le champ (pour les lecteurs d'écran). */
  private syncActive(): void {
    this.results.querySelectorAll(".result").forEach((li, i) => li.setAttribute("aria-selected", String(i === this.active)));
    if (this.active >= 0) {
      this.input.setAttribute("aria-activedescendant", `home-opt-${this.active}`);
      $(`home-opt-${this.active}`).scrollIntoView({ block: "nearest" });
    } else {
      this.input.removeAttribute("aria-activedescendant");
    }
  }

  private pickNote(path: string): void {
    // Le tiroir se ferme (le focus n'est pas renvoyé ailleurs) : la caméra prend le relais.
    this.drawers.close({ restoreFocus: false });
    this.callbacks.onPickNote(path);
  }

  // --- 4 grands chiffres --------------------------------------------------------------

  private buildFigures(): void {
    $("home-numbers").replaceChildren(
      ...FIGURES.map((key) => {
        const figure = document.createElement("div");
        figure.className = "figure";
        figure.dataset.figure = key;
        figure.append(span("label", FIGURE_LABELS[key], "dt"), span("", "0", "dd"));
        return figure;
      }),
    );
  }

  private renderFigures(): void {
    const n = this.notes;
    const values: Record<(typeof FIGURES)[number], number> = {
      notes: n.length,
      sections: n.reduce((s, x) => s + x.sections, 0),
      links: n.reduce((s, x) => s + x.links.length, 0),
      updated: n.filter((x) => x.modified >= Date.now() - 7 * DAY).length,
    };
    for (const key of FIGURES) {
      const dd = $("home-numbers").querySelector<HTMLElement>(`[data-figure="${key}"] dd`)!;
      setValue(dd, String(values[key]));
    }
  }

  // --- Courbe des 30 derniers jours (le seul graphique) --------------------------------

  private renderSpark(): void {
    const counts = perDay(this.notes, 30, (x) => x.modified);
    drawSparkline($("home-spark") as unknown as SVGSVGElement, counts, 600, 48, "Notes modifiées par jour sur 30 jours");
    const total = counts.reduce((a, b) => a + b, 0);
    setValue($("home-spark-caption"), `Notes modifiées · 30 jours · ${total}`);
  }

  // --- Plus connectées -------------------------------------------------------------------

  private renderTopConnected(): void {
    // Le graphe connaît déjà le nombre de liens (entrants + sortants) de chaque étoile.
    const top = this.graph.nodes
      .filter((n) => !n.ghost)
      .sort((a, b) => b.degree - a.degree || a.label.localeCompare(b.label))
      .slice(0, LIST_ROWS);
    $("home-top").replaceChildren(
      ...(top.length === 0
        ? [span("empty", "Aucune note", "li")]
        : top.map((n) => this.line(n.label, String(n.degree), () => this.pickNote(n.id)))),
    );
  }

  // --- Sections par groupe ---------------------------------------------------------------

  private renderGroups(): void {
    const byFolder = new Map<string, number>();
    for (const n of this.notes) byFolder.set(n.folder, (byFolder.get(n.folder) ?? 0) + n.sections);
    const rows = [...byFolder.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const max = Math.max(1, ...rows.map(([, v]) => v));

    $("home-groups").replaceChildren(
      ...(rows.length === 0
        ? [span("empty", "Coffre vide", "li")]
        : rows.map(([folder, value]) => {
            const li = this.line(folder || "Racine", String(value), () => this.pickFolder(folder));
            // Un trait fin (couleur d'accent : c'est une donnée) dont la longueur suit le nombre de sections
            // (dans une piste pleine largeur, pour qu'il passe sous le nom).
            const track = span("line-track", "");
            const bar = span("line-bar", "");
            bar.style.width = `${Math.max(2, (value / max) * 100)}%`;
            track.append(bar);
            const btn = li.firstElementChild as HTMLElement;
            btn.classList.add("with-bar");
            btn.append(track);
            return li;
          })),
    );
  }

  private pickFolder(folder: string): void {
    this.drawers.close({ restoreFocus: false });
    this.callbacks.onPickFolder(folder);
  }

  // --- Activité récente --------------------------------------------------------------

  private renderRecent(): void {
    const recent = [...this.notes].sort((a, b) => b.modified - a.modified).slice(0, LIST_ROWS);
    $("home-recent").replaceChildren(
      ...(recent.length === 0
        ? [span("empty", "Aucune note", "li")]
        : recent.map((n) => this.line(n.title, shortAge(n.modified), () => this.pickNote(n.path)))),
    );
  }

  /** Ligne de texte cliquable : nom à gauche, valeur à droite. */
  private line(name: string, meta: string, onClick: () => void): HTMLLIElement {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.className = "line";
    btn.append(span("line-name", name), span("line-meta", meta));
    btn.addEventListener("click", onClick);
    li.append(btn);
    return li;
  }
}
