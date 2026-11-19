// Les tiroirs : des panneaux plats qui s'ouvrent à droite de la barre latérale (Accueil,
// Notes, Activité, Tâches). Un seul ouvert à la fois ; le graphe reste visible à côté.
// Ce ne sont pas des fenêtres modales : le graphe reste utilisable pendant qu'un tiroir est
// ouvert. Échap (ou la croix, ou un nouveau clic sur l'entrée) le referme.
//
// Ce module ne connaît pas le contenu des tiroirs : il ne fait que les montrer, les cacher,
// marquer l'entrée active de la navigation et gérer le focus.

export type DrawerId = "home" | "notes" | "activity" | "tasks";

const $ = (id: string) => document.getElementById(id)!;

export class Drawers {
  private current: DrawerId | null = null;
  /** Élément qui avait le focus avant l'ouverture (il le retrouve à la fermeture). */
  private returnFocus: HTMLElement | null = null;
  private navItems = [...document.querySelectorAll<HTMLButtonElement>(".nav-item[data-drawer]")];

  /** Prévenu à chaque ouverture/fermeture (le graphe se recentre dans la place libre). */
  onChange: (open: DrawerId | null) => void = () => {};

  constructor() {
    for (const item of this.navItems) {
      item.addEventListener("click", () => this.toggle(item.dataset.drawer as DrawerId));
    }
    for (const drawer of document.querySelectorAll<HTMLElement>(".drawer")) {
      drawer.querySelector(".drawer-close")?.addEventListener("click", () => this.close());
      // Échap dans un tiroir (même depuis le champ de recherche) le referme.
      drawer.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && !e.isComposing) {
          e.preventDefault();
          e.stopPropagation();
          this.close();
        }
      });
    }
  }

  get openId(): DrawerId | null {
    return this.current;
  }

  isOpen(id?: DrawerId): boolean {
    return id ? this.current === id : this.current !== null;
  }

  /** L'élément du tiroir ouvert (pour mesurer la place qu'il prend), ou `null`. */
  get element(): HTMLElement | null {
    return this.current ? $(`drawer-${this.current}`) : null;
  }

  /**
   * Ouvre un tiroir (et ferme l'autre s'il y en avait un). Le focus va sur `focus` si donné,
   * sinon sur le titre du tiroir, pour que le clavier et les lecteurs d'écran suivent.
   */
  open(id: DrawerId, focus?: HTMLElement): void {
    if (this.current !== id) {
      if (!this.current) {
        const active = document.activeElement;
        this.returnFocus = active instanceof HTMLElement && active !== document.body ? active : null;
      }
      if (this.current) $(`drawer-${this.current}`).hidden = true;
      this.current = id;
      $(`drawer-${id}`).hidden = false;
      this.syncNav();
      this.onChange(id);
    }
    const target = focus ?? $(`drawer-${id}`).querySelector<HTMLElement>("h2");
    if (target) {
      if (!target.hasAttribute("tabindex") && !(target instanceof HTMLInputElement)) target.tabIndex = -1;
      target.focus();
    }
  }

  /** Ferme le tiroir ouvert. Le focus revient à l'entrée de navigation qui l'avait ouvert. */
  close(options: { restoreFocus?: boolean } = {}): void {
    if (!this.current) return;
    const drawer = $(`drawer-${this.current}`);
    const hadFocus = drawer.contains(document.activeElement);
    drawer.hidden = true;
    const navItem = this.navItems.find((b) => b.dataset.drawer === this.current) ?? null;
    this.current = null;
    this.syncNav();
    this.onChange(null);
    if (options.restoreFocus !== false && hadFocus) {
      // Barre latérale repliée (inerte) : le focus va au bouton qui permet de la rouvrir.
      const target = this.returnFocus ?? navItem;
      if (target && !target.closest("[inert]")) target.focus();
      else document.getElementById("sidebar-open")?.focus();
    }
    this.returnFocus = null;
  }

  toggle(id: DrawerId): void {
    if (this.current === id) this.close();
    else this.open(id);
  }

  /** Marque l'entrée active : petit trait à gauche (CSS) et aria-current pour les lecteurs d'écran. */
  private syncNav(): void {
    for (const item of this.navItems) {
      const active = item.dataset.drawer === this.current;
      item.setAttribute("aria-expanded", String(active));
      if (active) item.setAttribute("aria-current", "true");
      else item.removeAttribute("aria-current");
    }
  }
}
