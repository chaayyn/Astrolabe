// Types partagés pour les thèmes (main, preload et page). Types uniquement.

/** Un thème valide, prêt à être appliqué. */
export interface Theme {
  /** Identifiant = nom du dossier dans themes/ (lettres, chiffres, tirets). */
  id: string;
  name: string;
  version: string;
  author?: string;
  description?: string;
  /**
   * Nom d'une scène LIVRÉE AVEC L'APP qui dessine le graphe (ex. "classique").
   * Jamais un chemin de code. Absent ou inconnu : scène "classique".
   */
  scene?: string;
  /** Contenu du fichier CSS du thème. */
  css: string;
}

/**
 * Réglages mémorisés pour UN thème (panneau Paramètres) :
 * valeurs des curseurs/cases, et couleurs qui remplacent celles du thème.
 */
export interface ThemeSettings {
  /** Identifiant du réglage → valeur (nombre, case cochée ou texte). */
  params: Record<string, number | boolean | string>;
  /** Variable CSS (ex. "--sc-accent") → couleur "#rrggbb". */
  colors: Record<string, string>;
}

/** Ce que le preload expose à la page sous `window.themes`. */
export interface ThemesApi {
  /** Tous les thèmes valides du dossier themes/. */
  list(): Promise<Theme[]>;
  /** Un thème par son identifiant (ou `null` s'il n'existe pas ou est invalide). */
  get(id: string): Promise<Theme | null>;
  /** Identifiant du thème choisi (mémorisé entre deux lancements). */
  getActive(): Promise<string>;
  /** Choisit le thème actif et le mémorise. */
  setActive(id: string): Promise<void>;
  /** Réglages mémorisés pour un thème (vides s'il n'y en a pas). */
  getSettings(id: string): Promise<ThemeSettings>;
  /** Mémorise les réglages d'un thème (dans le fichier de réglages de l'app, jamais dans le coffre). */
  setSettings(id: string, settings: ThemeSettings): Promise<void>;
  /** Appelle `callback` quand un fichier de thème change. Renvoie de quoi se désabonner. */
  onChange(callback: () => void): () => void;
}
