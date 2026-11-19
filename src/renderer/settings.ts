// Panneau "Paramètres" et gestion des réglages.
//
// Le panneau ne connaît AUCUNE scène en particulier : il lit les fiches de réglages (params.ts)
// déclarées par le moteur (ENGINE_PARAMS) et par la scène active (engine.sceneParams),
// et fabrique les champs tout seul. Les valeurs sont mémorisées PAR THÈME dans le fichier
// de réglages de l'app (jamais dans le coffre).
import type { Theme, ThemeSettings, ThemesApi } from "../shared/theme";
import { ENGINE_PARAMS, type Engine } from "./engine";
import { fitKeybar } from "./shortcuts";
import { resolveValues, sanitize, type ParamDef, type ParamValue, type ParamValues } from "./params";
import type { ThemeManager } from "./themes";
import type { Toolbar } from "./toolbar";
import { span } from "./ui";

/**
 * Couleurs réglables : chacune remplace une ou plusieurs variables --sc-* du thème actif,
 * par-dessus le thème, sans modifier ses fichiers. Leur valeur par défaut est celle du thème.
 */
const COLORS: { id: string; label: string; vars: string[] }[] = [
  { id: "--sc-accent", label: "Accent", vars: ["--sc-accent", "--sc-star-accent"] },
  { id: "--sc-star", label: "Étoiles", vars: ["--sc-star"] },
  { id: "--sc-link", label: "Liens", vars: ["--sc-link"] },
  { id: "--sc-orbit", label: "Orbites", vars: ["--sc-orbit"] },
];
const COLORS_GROUP = "Couleurs";
/** Les groupes du moteur qui doivent rester en dernier (après ceux de la scène). */
const LAST_GROUPS = ["Affichage"];
const SAVE_DELAY_MS = 400;

const $ = (id: string) => document.getElementById(id)!;

export class Settings {
  private themeId: string | null = null;
  /** Valeurs des réglages (moteur + scène), et couleurs remplacées (variable → "#rrggbb"). */
  private values: ParamValues = {};
  private colors: Record<string, string> = {};
  /** Couleurs du thème lui-même (sans remplacement) : valeurs par défaut des champs couleur. */
  private themeColors: Record<string, string> = {};
  /** Feuille de style des couleurs remplacées, placée après celle du thème : elle l'emporte. */
  private colorSheet = new CSSStyleSheet();
  private saveTimer = 0;
  private returnFocus: HTMLElement | null = null;

  private dialog = $("settings") as HTMLDialogElement;
  private body = $("settings-body");
  private openBtn = $("settings-open");

  constructor(
    private engine: Engine,
    private toolbar: Toolbar,
    private api: ThemesApi,
    private themes: ThemeManager,
  ) {
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, this.colorSheet];

    this.openBtn.addEventListener("click", () => this.toggle());
    $("settings-close").addEventListener("click", () => this.close());
    $("settings-reset-all").addEventListener("click", () => this.reset(null));
    // Échap ferme (comportement natif de <dialog>) : on rend alors le focus.
    this.dialog.addEventListener("close", () => {
      this.openBtn.setAttribute("aria-expanded", "false");
      document.body.classList.remove("veiled");
      this.returnFocus?.focus();
    });
    this.dialog.addEventListener("cancel", () => document.body.classList.remove("veiled"));
    this.dialog.addEventListener("click", (e) => {
      if (e.target === this.dialog) this.close();
    });
  }

  // --- Ouverture / fermeture -----------------------------------------------------------

  get isOpen(): boolean {
    return this.dialog.open;
  }

  open(): void {
    if (this.isOpen) return;
    this.returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.render();
    this.dialog.showModal();
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

  // --- Thème actif ---------------------------------------------------------------------

  /**
   * Un thème vient d'être appliqué : on retire les couleurs remplacées de l'ancien thème,
   * on installe la scène du nouveau, puis on charge et applique ses réglages mémorisés.
   */
  async switchTheme(theme: Theme | null): Promise<void> {
    this.themeId = theme?.id ?? null;
    this.colorSheet.replaceSync("");
    this.engine.refreshTheme(theme?.scene);
    this.themeColors = readThemeColors();

    const saved: ThemeSettings = this.themeId
      ? await this.api.getSettings(this.themeId).catch(() => ({ params: {}, colors: {} }))
      : { params: {}, colors: {} };
    if (this.themeId !== (theme?.id ?? null)) return; // un autre thème a été choisi entre-temps
    this.values = resolveValues(this.defs(), saved.params);
    this.colors = {};
    for (const c of COLORS) {
      const v = saved.colors[c.id];
      if (typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v)) this.colors[c.id] = v.toLowerCase();
    }
    this.applyAll();
    if (this.isOpen) this.render();
  }

  // --- Valeurs -------------------------------------------------------------------------

  /** Toutes les fiches : celles du moteur, puis celles de la scène active. */
  private defs(): ParamDef[] {
    return [...ENGINE_PARAMS, ...this.engine.sceneParams];
  }

  /** Applique tout : moteur, scène, FPS, mouvement réduit, couleurs. */
  private applyAll(): void {
    this.engine.setParams(this.values);
    this.engine.setSceneParams(this.values);
    this.toolbar.setFpsVisible(this.values["display.fps"] === true);
    // Bande des raccourcis en bas : affichée ou non ; remplie à nouveau quand elle réapparaît.
    const keybar = document.getElementById("keybar")!;
    const showKeybar = this.values["display.keybar"] !== false;
    if (showKeybar && keybar.hidden) {
      keybar.hidden = false;
      fitKeybar(keybar);
    }
    keybar.hidden = !showKeybar;
    document.body.classList.toggle("reduce-motion", this.values["motion.reduce"] === true);
    this.applyBlur();
    this.applyColors();
  }

  /**
   * Verre dépoli de l'interface : rayon du flou, et transparence du fond qui va avec. Sans flou,
   * le fond devient presque opaque (0,85) pour rester lisible ; à 18 px et plus, il est à 0,5.
   */
  private applyBlur(): void {
    const v = this.values["display.blur"];
    const blur = typeof v === "number" ? Math.max(0, v) : 18;
    const root = document.documentElement.style;
    root.setProperty("--ui-blur", `${blur}px`);
    root.setProperty("--ui-glass-alpha", (0.85 - (Math.min(blur, 18) / 18) * 0.35).toFixed(3));
  }

  /** Écrit les couleurs remplacées dans leur feuille de style, puis le graphe relit ses couleurs. */
  private applyColors(): void {
    const lines = COLORS.filter((c) => this.colors[c.id]).flatMap((c) =>
      c.vars.map((v) => `  ${v}: ${this.colors[c.id]};`),
    );
    this.colorSheet.replaceSync(lines.length ? `:root {\n${lines.join("\n")}\n}` : "");
    this.engine.paletteChanged();
  }

  /** Change un réglage (depuis un champ ou un raccourci) : appliqué tout de suite, mémorisé un peu après. */
  private setValue(def: ParamDef, raw: unknown): void {
    const value = sanitize(def, raw);
    if (value === undefined) return;
    this.values = { ...this.values, [def.id]: value };
    this.applyAll();
    this.scheduleSave();
  }

  private setColor(id: string, hex: string): void {
    if (!/^#[0-9a-f]{6}$/i.test(hex)) return;
    this.colors = { ...this.colors, [id]: hex.toLowerCase() };
    this.applyColors();
    this.scheduleSave();
  }

  /** Touche G : affiche ou masque les FPS, et garde la case du panneau synchronisée. */
  toggleFps(): void {
    const def = ENGINE_PARAMS.find((d) => d.id === "display.fps")!;
    this.setValue(def, this.values["display.fps"] !== true);
    if (this.isOpen) this.render();
  }

  /** Remet un groupe (ou tout, avec `null`) aux valeurs par défaut du thème actif. */
  private reset(group: string | null): void {
    for (const def of this.defs()) {
      if (group === null || def.group === group) this.values[def.id] = def.default;
    }
    if (group === null || group === COLORS_GROUP) this.colors = {};
    this.values = { ...this.values };
    this.applyAll();
    this.scheduleSave();
    this.render();
  }

  /** Mémorisation légère : une seule écriture, 400 ms après le dernier changement. */
  private scheduleSave(): void {
    if (!this.themeId) return;
    const id = this.themeId;
    window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      void this.api.setSettings(id, { params: { ...this.values }, colors: { ...this.colors } });
    }, SAVE_DELAY_MS);
  }

  // --- Fabrication du panneau ------------------------------------------------------------

  /** (Re)fabrique le contenu du panneau à partir des fiches du moteur et de la scène active. */
  private render(): void {
    const focusedId = document.activeElement instanceof HTMLElement ? document.activeElement.id : "";
    const defs = this.defs();

    // Ordre des groupes : Thème, Couleurs, groupes du moteur, groupes de la scène, puis Affichage.
    const groups: string[] = [];
    for (const def of defs) if (!groups.includes(def.group)) groups.push(def.group);
    groups.sort((a, b) => Number(LAST_GROUPS.includes(a)) - Number(LAST_GROUPS.includes(b)));

    this.body.replaceChildren(
      this.themeSection(),
      this.section(COLORS_GROUP, COLORS.map((c) => this.colorField(c))),
      ...groups.map((g) => this.section(g, defs.filter((d) => d.group === g).map((d) => this.field(d)))),
    );
    if (focusedId) document.getElementById(focusedId)?.focus(); // le focus clavier reste en place
  }

  /** Liste des thèmes : des noms cliquables, le thème appliqué marqué d'un petit trait. */
  private themeSection(): HTMLElement {
    const section = this.groupShell("Thème", false);
    const list = document.createElement("ul");
    list.className = "theme-list";
    const themes = this.themes.themes;
    if (themes.length === 0) list.append(span("empty", "Aucun thème trouvé dans themes/", "li"));
    for (const t of themes) {
      const li = document.createElement("li");
      const btn = document.createElement("button");
      btn.className = "line theme-choice";
      btn.id = `set-theme-${t.id}`;
      btn.setAttribute("aria-pressed", String(t.id === this.themeId));
      btn.title = t.description ?? "";
      btn.append(span("line-name", t.name), span("line-meta", `v${t.version}`));
      btn.addEventListener("click", () => void this.themes.choose(t.id));
      li.append(btn);
      list.append(li);
    }
    section.append(list);
    return section;
  }

  /** Un groupe : titre, bouton "Réinitialiser" (sauf pour Thème), puis ses champs. */
  private groupShell(title: string, resettable: boolean): HTMLElement {
    const section = document.createElement("section");
    section.className = "set-group";
    const head = document.createElement("div");
    head.className = "set-group-head";
    head.append(span("label", title, "h3"));
    if (resettable) {
      const btn = document.createElement("button");
      btn.className = "text-toggle";
      btn.textContent = "Réinitialiser";
      btn.setAttribute("aria-label", `Réinitialiser le groupe ${title}`);
      btn.addEventListener("click", () => this.reset(title));
      head.append(btn);
    }
    section.append(head);
    return section;
  }

  private section(title: string, fields: HTMLElement[]): HTMLElement {
    const section = this.groupShell(title, true);
    section.append(...fields);
    return section;
  }

  /** Un champ fabriqué d'après sa fiche : curseur, case, liste ou couleur. */
  private field(def: ParamDef): HTMLElement {
    const row = document.createElement("div");
    row.className = `set-field set-${def.type}`;
    const id = `set-${def.id.replace(/[^\w-]/g, "-")}`;
    const label = document.createElement("label");
    label.htmlFor = id;
    label.textContent = def.label;
    const value = this.values[def.id] ?? def.default;

    let input: HTMLInputElement | HTMLSelectElement;
    let output: HTMLOutputElement | null = null;
    switch (def.type) {
      case "slider": {
        const range = document.createElement("input");
        range.type = "range";
        range.min = String(def.min);
        range.max = String(def.max);
        range.step = String(def.step);
        range.value = String(value);
        output = document.createElement("output");
        output.htmlFor.add(id);
        const show = (v: ParamValue) => (output!.textContent = formatNumber(Number(v), def.step) + (def.unit ?? ""));
        show(value);
        range.addEventListener("input", () => {
          this.setValue(def, Number(range.value));
          show(this.values[def.id]);
        });
        input = range;
        break;
      }
      case "toggle": {
        const box = document.createElement("input");
        box.type = "checkbox";
        box.checked = value === true;
        box.addEventListener("change", () => this.setValue(def, box.checked));
        input = box;
        break;
      }
      case "choice": {
        const select = document.createElement("select");
        for (const o of def.options) select.append(new Option(o.label, o.value, false, o.value === value));
        select.addEventListener("change", () => this.setValue(def, select.value));
        input = select;
        break;
      }
      case "color": {
        const color = document.createElement("input");
        color.type = "color";
        color.value = String(value);
        color.addEventListener("input", () => this.setValue(def, color.value));
        input = color;
        break;
      }
    }
    input.id = id;
    row.append(label, input);
    if (output) row.append(output);
    return row;
  }

  /** Champ couleur : remplace une couleur du thème (valeur par défaut : celle du thème). */
  private colorField(c: { id: string; label: string }): HTMLElement {
    const row = document.createElement("div");
    row.className = "set-field set-color";
    const id = `set-color${c.id}`;
    const label = document.createElement("label");
    label.htmlFor = id;
    label.textContent = c.label;
    const input = document.createElement("input");
    input.type = "color";
    input.id = id;
    input.value = this.colors[c.id] ?? this.themeColors[c.id] ?? "#ffffff";
    input.addEventListener("input", () => this.setColor(c.id, input.value));
    row.append(label, input);
    return row;
  }
}

/** Couleurs du thème actif (sans remplacement), au format "#rrggbb" pour les champs couleur. */
function readThemeColors(): Record<string, string> {
  const css = getComputedStyle(document.documentElement);
  return Object.fromEntries(COLORS.map((c) => [c.id, toHex(css.getPropertyValue(c.id).trim())]));
}

/** Convertit une couleur CSS en "#rrggbb" (le canvas sait lire toutes les écritures de couleur). */
const probe = document.createElement("canvas").getContext("2d")!;
function toHex(value: string): string {
  probe.fillStyle = "#000000";
  probe.fillStyle = value || "#000000";
  const out = probe.fillStyle;
  if (out.startsWith("#")) return out;
  const m = /rgba?\(([^)]+)\)/.exec(out);
  if (!m) return "#ffffff";
  return `#${m[1]
    .split(",")
    .slice(0, 3)
    .map((x) => Math.round(Number(x)).toString(16).padStart(2, "0"))
    .join("")}`;
}

/** Affiche un nombre avec autant de décimales que le pas du curseur. */
function formatNumber(n: number, step: number): string {
  const decimals = step >= 1 ? 0 : Math.min(3, String(step).split(".")[1]?.length ?? 0);
  return n.toFixed(decimals).replace(".", ",");
}
