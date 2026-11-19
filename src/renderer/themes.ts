// Application du thème dans la page. La liste des thèmes est affichée par le panneau
// Paramètres (settings.ts), qui appelle `choose()`.
//
// Sécurité : le CSS du thème est appliqué via une feuille de style construite en JavaScript
// (CSSStyleSheet + document.adoptedStyleSheets). Aucune balise <style> n'est injectée et
// rien n'est chargé depuis l'extérieur : la politique de sécurité (CSP) reste inchangée.
import type { Theme, ThemesApi } from "../shared/theme";

const DEFAULT_THEME = "galaxie";

export class ThemeManager {
  private list: Theme[] = [];
  private active = DEFAULT_THEME;
  /** Thème réellement appliqué (le choisi, ou "galaxie" s'il a disparu), ou `null`. */
  private applied: Theme | null = null;
  /** La feuille de style du thème, placée après celle de l'app : ses variables l'emportent. */
  private sheet = new CSSStyleSheet();

  /**
   * `onApplied(theme)` est appelé après chaque application d'un thème (choix, démarrage,
   * fichier de thème modifié) : le reste de l'app suit (scène, réglages, panneau).
   */
  constructor(
    private api: ThemesApi,
    private onApplied: (theme: Theme | null) => void,
  ) {
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, this.sheet];
  }

  /** Thèmes valides du dossier themes/. */
  get themes(): readonly Theme[] {
    return this.list;
  }

  /** Thème appliqué en ce moment. */
  get current(): Theme | null {
    return this.applied;
  }

  /** Lit le thème choisi, l'applique, puis suit les modifications des fichiers de thème. */
  async start(): Promise<void> {
    this.active = await this.api.getActive();
    await this.reload();
    // Rechargement à chaud : un theme.css ou manifest.json modifié est réappliqué aussitôt.
    this.api.onChange(() => void this.reload());
  }

  /** Choisit un thème et le mémorise pour le prochain lancement. */
  async choose(id: string): Promise<void> {
    this.active = id;
    this.apply();
    await this.api.setActive(id);
  }

  private async reload(): Promise<void> {
    this.list = await this.api.list();
    this.apply();
  }

  /** Applique le thème actif ; s'il a disparu ou est devenu invalide, revient à "galaxie". */
  private apply(): void {
    const theme =
      this.list.find((t) => t.id === this.active) ?? this.list.find((t) => t.id === DEFAULT_THEME) ?? null;
    try {
      // Sans thème valide, la feuille reste vide : les valeurs de secours de l'app s'appliquent.
      this.sheet.replaceSync(theme?.css ?? "");
    } catch (err) {
      console.warn(`[thèmes] CSS de "${theme?.id}" refusé :`, err);
      this.sheet.replaceSync("");
    }
    this.applied = theme;
    this.onApplied(theme);
  }
}
