// Type partagé entre le preload et la page : les commandes de la fenêtre.
// Fichier de types uniquement (rien n'est exécuté).

/** Ce que le preload expose à la page sous `window.appWindow`. */
export interface AppWindowApi {
  /** Bascule le plein écran de la fenêtre. */
  toggleFullscreen(): void;
  /**
   * Appelle `callback(true/false)` à chaque entrée/sortie du plein écran
   * (y compris par une touche du système). Renvoie une fonction pour se désabonner.
   */
  onFullscreenChange(callback: (fullscreen: boolean) => void): () => void;
}
