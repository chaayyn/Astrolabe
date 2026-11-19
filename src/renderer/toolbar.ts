// Barre d'outils flottante (zoom −/+, recentrer, pause, plein écran) et compteur de FPS.
// Les boutons ne font que transmettre des ordres à la vue 3D ou à la fenêtre.
import type { AppWindowApi } from "../shared/app-window";
import type { Engine } from "./engine";

const ZOOM_STEP = 1.25; // chaque cran de zoom rapproche/éloigne la caméra de 25 %
const LOW_FPS = 30; // sous ce seuil, le compteur devient plus visible
const IDLE_MS = 3000; // la barre s'estompe après 3 s sans mouvement de souris

const $ = (id: string) => document.getElementById(id)!;

export class Toolbar {
  private pauseBtn = $("tool-pause");
  private fullscreenBtn = $("tool-fullscreen");
  private fpsEl = $("fps");
  private bar = $("toolbar");
  /** La bande des raccourcis s'estompe en même temps que la barre. */
  private keybar = $("keybar");
  private idleTimer = 0;

  constructor(
    private view: Engine,
    private appWindow: AppWindowApi,
  ) {
    $("tool-zoom-out").addEventListener("click", () => this.zoomOut());
    $("tool-zoom-in").addEventListener("click", () => this.zoomIn());
    $("tool-recenter").addEventListener("click", () => this.recenter());
    this.pauseBtn.addEventListener("click", () => this.togglePause());
    this.fullscreenBtn.addEventListener("click", () => this.toggleFullscreen());

    // L'icône du plein écran suit l'état réel de la fenêtre (même si on en sort autrement).
    appWindow.onFullscreenChange((full) => {
      this.fullscreenBtn.setAttribute("aria-pressed", String(full));
      this.setTip(this.fullscreenBtn, full ? "Quitter le plein écran · F" : "Plein écran · F");
    });

    // La barre s'estompe quand la souris ne bouge plus, et revient au moindre mouvement.
    // (Elle reste visible tant qu'on la survole ou qu'un de ses boutons a le focus : voir CSS.)
    window.addEventListener("mousemove", () => this.wake());
    this.wake();

    // Compteur de FPS : la vue le met à jour toutes les 0,5 s.
    view.onFps = (fps) => {
      this.fpsEl.textContent = `${Math.round(fps)} fps`;
      this.fpsEl.classList.toggle("low", fps < LOW_FPS);
    };
  }

  zoomIn(): void {
    this.view.zoomBy(1 / ZOOM_STEP);
  }

  zoomOut(): void {
    this.view.zoomBy(ZOOM_STEP);
  }

  recenter(): void {
    this.view.recenter();
  }

  togglePause(): void {
    const paused = !this.view.toggleAutoRotate();
    this.pauseBtn.setAttribute("aria-pressed", String(paused));
    this.setTip(this.pauseBtn, paused ? "Reprendre rotation · Espace" : "Pause rotation · Espace");
  }

  toggleFullscreen(): void {
    this.appWindow.toggleFullscreen();
  }

  /** Affiche ou masque le compteur de FPS (réglage "Afficher les FPS", ou touche G). */
  setFpsVisible(visible: boolean): void {
    this.fpsEl.hidden = !visible;
  }

  /** Fait réapparaître la barre et relance le compte à rebours avant qu'elle s'estompe. */
  private wake(): void {
    this.bar.classList.remove("idle");
    this.keybar.classList.remove("idle");
    window.clearTimeout(this.idleTimer);
    this.idleTimer = window.setTimeout(() => {
      this.bar.classList.add("idle");
      this.keybar.classList.add("idle");
    }, IDLE_MS);
  }

  /** Change le texte de l'info-bulle et le nom lu par les lecteurs d'écran. */
  private setTip(btn: HTMLElement, text: string): void {
    btn.dataset.tip = text;
    btn.setAttribute("aria-label", text.split(" · ")[0]);
  }
}
