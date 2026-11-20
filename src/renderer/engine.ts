// Le MOTEUR de la vue 3D : caméra, placement (simulation du graphe), projection à l'écran,
// survol, clic, vol de caméra, rotation automatique, noms des notes, FPS, décalage pour le rail.
// Il ne dessine PAS la scène : il la confie à une Scene (choisie par le thème) et ne dessine
// lui-même que les noms des notes, sur un calque transparent posé au-dessus.
//
//   engine.ts ──positions, caméra, survol──▶ Scene.render() ──▶ canvas de la scène
//       └──────────── noms des notes ─────▶ canvas du moteur (au-dessus, reçoit la souris)
import { Camera, type Projected } from "./camera";
import { palette, readPalette } from "./palette";
import type { Graph, GraphNode } from "./graph";
import type { ParamDef, ParamValues } from "./params";
import { createScene, DEFAULT_SCENE, resolveSceneName } from "./scenes/registry";
import { depthFade, type Scene } from "./scenes/scene";

// Rotation automatique : elle ne s'arrête que pendant une VRAIE manipulation de la caméra
// (glisser avec un bouton enfoncé, molette, vol de caméra). Bouger ou survoler sans cliquer
// ne l'arrête jamais. Elle reprend RESUME_MS après la fin du geste, en accélérant doucement.
const RESUME_MS = 1000;
const AUTO_SPEED = 0.04; // vitesse de la rotation automatique (radians par seconde)
const SPIN_UP_S = 0.6; // temps caractéristique de la reprise / du ralentissement (secondes)
/** Pendant le survol d'une étoile, la rotation ralentit (sans s'arrêter) pour viser plus facilement. */
const HOVER_SPIN = 0.5;

/**
 * Réglages du moteur (identiques pour toutes les scènes). Défauts = comportement habituel.
 * L'affichage des FPS est géré par la barre d'outils, mais déclaré ici pour le panneau.
 */
export const ENGINE_PARAMS: readonly ParamDef[] = [
  { id: "motion.rotation", label: "Vitesse de rotation", group: "Mouvement", type: "slider", min: 0, max: 5, step: 0.1, unit: "×", default: 1 },
  { id: "motion.reduce", label: "Réduire le mouvement", group: "Mouvement", type: "toggle", default: false },
  { id: "layout.spacing", label: "Espacement des orbites", group: "Orbites", type: "slider", min: 0.5, max: 2, step: 0.05, unit: "×", default: 1 },
  { id: "layout.tilt", label: "Inclinaison du disque", group: "Orbites", type: "slider", min: 0, max: 25, step: 1, unit: "°", default: 10 },
  // Lu par les scènes (noms écrits sur les anneaux), déclaré ici avec la disposition.
  { id: "display.folderLabels", label: "Noms des dossiers", group: "Orbites", type: "toggle", default: true },
  { id: "display.labels", label: "Noms affichés sur le graphe", group: "Affichage", type: "slider", min: 0, max: 12, step: 1, default: 5 },
  { id: "display.fps", label: "Afficher les FPS", group: "Affichage", type: "toggle", default: false },
  { id: "display.keybar", label: "Afficher la bande de raccourcis", group: "Affichage", type: "toggle", default: true },
  // Géré par le panneau Paramètres (fond translucide de l'interface), déclaré ici avec les autres.
  { id: "display.blur", label: "Flou de l'interface", group: "Affichage", type: "slider", min: 0, max: 30, step: 1, unit: " px", default: 18 },
];

export class Engine {
  private ctx: CanvasRenderingContext2D;
  private camera = new Camera();
  /** La scène qui dessine (choisie par le thème), et le nom sous lequel elle a été créée. */
  private scene: Scene;
  private sceneName: string;

  private hovered: GraphNode | null = null;
  private drag: { x: number; y: number; mode: "rotate" | "pan" } | null = null;
  /** Point où le bouton a été enfoncé : s'il est relâché sans avoir bougé, c'est un clic. */
  private downAt: { x: number; y: number; button: number } | null = null;
  private mouse: { x: number; y: number } | null = null;
  /** Fin du dernier geste sur la caméra (ms) : la rotation reprend RESUME_MS après. */
  private lastInteraction = -Infinity;
  /** Part de la vitesse de rotation automatique en cours (0 = à l'arrêt, 1 = pleine vitesse). */
  private spin = 1;
  /** Une étoile est sous la souris (image précédente) : la rotation ralentit un peu. */
  private hoveringStar = false;
  private lastFrame = 0;
  /** La distance de la caméra est ajustée une seule fois, au premier chargement. */
  private fitted = false;

  /** Note survolée dans le panneau latéral (son étoile s'éclaire), ou `null`. */
  private panelHoverId: string | null = null;
  /** Note choisie dans le panneau : son étoile reste mise en évidence. */
  private selectedId: string | null = null;
  /** Dossier choisi dans la fenêtre Home : son orbite reste éclairée. */
  private selectedFolder: string | null = null;
  /**
   * Déplacement animé de la caméra (~0,8 s) : vers une étoile (`id`) ou vers un point fixe
   * (`to`), en changeant aussi la distance si `toDistance` est donné.
   */
  private flight: {
    id: string | null;
    to: [number, number, number] | null;
    from: [number, number, number];
    fromDistance: number;
    toDistance: number | null;
    start: number;
  } | null = null;
  /** Largeur (pixels) cachée à gauche par le panneau : le graphe se centre dans le reste. */
  private leftInset = 0;

  /** Rotation automatique activée (bouton Pause/Lecture de la barre d'outils). */
  private autoRotate = true;
  /** Réglages du panneau Paramètres : vitesse de rotation (×), mouvement réduit, nombre de noms. */
  private rotationFactor = 1;
  private reduceMotion = false;
  private labelCount = 5;
  /** Dernières valeurs des réglages de la scène, renvoyées à chaque nouvelle scène. */
  private sceneValues: ParamValues = {};
  /** Distance visée par un zoom animé (boutons + / −), ou `null` s'il n'y en a pas en cours. */
  private zoomGoal: number | null = null;
  /** Vue initiale (après le premier chargement), pour le bouton Recentrer. */
  private home = { yaw: 0, pitch: 0.6, distance: 900 };
  /** Retour animé vers la vue initiale (bouton Recentrer). */
  private recentering: {
    from: { yaw: number; pitch: number; distance: number; target: [number, number, number] };
    start: number;
  } | null = null;

  /** Images par seconde mesurées, transmises toutes les 0,5 s à qui le demande. */
  onFps: (fps: number) => void = () => {};
  /** Prévenu quand la scène demandée n'a pas pu démarrer (ex. WebGL2 absent) : repli sur "classique". */
  onSceneFallback: (message: string) => void = () => {};
  private fpsFrames = 0;
  private fpsStart = 0;

  /** Position à l'écran de chaque étoile, recalculée à chaque image. */
  private screen = new Map<GraphNode, Projected>();

  /**
   * `layer` : l'élément où la scène place son ou ses canvas (derrière).
   * `canvas` : le calque du moteur, transparent, au-dessus : noms des notes et souris.
   */
  constructor(
    private layer: HTMLElement,
    private canvas: HTMLCanvasElement,
    private graph: Graph,
  ) {
    this.ctx = canvas.getContext("2d")!;
    // Scène par défaut tant que le thème n'est pas chargé (il peut en demander une autre).
    this.sceneName = resolveSceneName(undefined);
    this.scene = this.startScene(this.sceneName);
    this.resize();
    window.addEventListener("resize", () => this.resize());
    this.listen();
    requestAnimationFrame((t) => this.frame(t));
  }

  /** Adapte la taille du canvas à la fenêtre, en tenant compte des écrans haute densité. */
  private resize(): void {
    const dpr = window.devicePixelRatio || 1;
    const w = window.innerWidth;
    const h = window.innerHeight;
    // Le canvas a dpr fois plus de pixels réels que de pixels CSS : le dessin reste net.
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    // On dessine ensuite en pixels CSS ; cette transformation fait la conversion.
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.camera.width = w;
    this.camera.height = h;
  }

  // --- Commandes venant du panneau latéral -------------------------------------------

  /** Éclaire l'étoile d'une note (survol dans le panneau), ou rien avec `null`. */
  setPanelHover(id: string | null): void {
    this.panelHoverId = id;
  }

  /**
   * Met une étoile en évidence et y amène la caméra en douceur (~0,8 s).
   * `null` retire la mise en évidence (la caméra ne bouge pas).
   */
  select(id: string | null): void {
    // Échap pendant qu'un dossier est cadré : retour à la vue d'ensemble.
    if (id === null && this.selectedFolder !== null) return this.recenter();
    this.selectedId = id;
    this.selectedFolder = null;
    this.recentering = null;
    this.flight = id ? this.newFlight(id, null, null) : null;
    this.lastInteraction = performance.now(); // la rotation automatique attend la fin du vol
  }

  /**
   * Amène la caméra en douceur vers l'orbite d'un dossier et l'éclaire.
   * Toutes les orbites tournent autour du trou noir : on vise donc le centre, avec un recul
   * qui montre l'anneau en entier. Pour la racine (""), on se rapproche du trou noir.
   */
  focusOrbit(folder: string): void {
    // L'anneau du dossier ; pour un dossier sans note directe ("Archives" qui ne contient que
    // "Archives/2025"…), le plus grand anneau de ses sous-dossiers ; la racine a le sien.
    const orbits = this.graph.orbits.filter((o) => o.alive && (o.folder === folder || (folder !== "" && o.folder.startsWith(folder + "/"))));
    const radius = Math.max(0, ...orbits.map((o) => o.radius));
    const distance = orbits.length > 0 ? Camera.clampDistance(radius * 2.1 + 150) : 320;
    this.selectedId = null;
    this.selectedFolder = folder;
    this.recentering = null;
    this.zoomGoal = null;
    this.flight = this.newFlight(null, [0, 0, 0], distance);
    this.lastInteraction = performance.now();
  }

  private newFlight(id: string | null, to: [number, number, number] | null, toDistance: number | null) {
    const c = this.camera;
    return { id, to, toDistance, from: [...c.target] as [number, number, number], fromDistance: c.distance, start: performance.now() };
  }

  /**
   * Le thème vient de changer : relit les couleurs dans les variables CSS, puis remplace
   * la scène par celle que demande le thème (`sceneName`, "classique" si absente ou inconnue).
   * L'ancienne est libérée avant que la nouvelle ne démarre : une seule boucle d'animation,
   * celle du moteur, qui continue sans interruption.
   */
  refreshTheme(sceneName?: string): void {
    readPalette();
    this.scene.dispose();
    this.sceneName = resolveSceneName(sceneName);
    this.scene = this.startScene(this.sceneName);
  }

  /**
   * Crée et démarre une scène. Si elle n'y arrive pas (WebGL2 absent, shader refusé…),
   * elle est libérée et la scène classique prend sa place : l'app reste utilisable.
   */
  private startScene(name: string): Scene {
    let scene = createScene(name);
    try {
      scene.init(this.layer, palette);
    } catch (err) {
      scene.dispose();
      console.warn(`[scènes] la scène "${name}" n'a pas pu démarrer : repli sur "${DEFAULT_SCENE}".`, err);
      this.sceneName = DEFAULT_SCENE;
      scene = createScene(DEFAULT_SCENE);
      scene.init(this.layer, palette);
      this.onSceneFallback("Ciel 3D indisponible sur cet ordinateur : affichage classique.");
    }
    scene.setParams(this.sceneValues);
    scene.update(this.graph);
    return scene;
  }

  /** Réglages de la scène en service (pour le panneau Paramètres). */
  get sceneParams(): readonly ParamDef[] {
    return this.scene.params;
  }

  /** Nouvelles valeurs pour les réglages de la scène : appliquées sans recréer la scène. */
  setSceneParams(values: ParamValues): void {
    this.sceneValues = values;
    this.scene.setParams(values);
  }

  /** Nouvelles valeurs pour les réglages du moteur. */
  setParams(values: ParamValues): void {
    this.rotationFactor = typeof values["motion.rotation"] === "number" ? values["motion.rotation"] : 1;
    this.reduceMotion = values["motion.reduce"] === true;
    this.labelCount = typeof values["display.labels"] === "number" ? values["display.labels"] : 5;
    // Disposition des anneaux : les étoiles glissent vers leur nouvelle place (immédiat en mouvement réduit).
    const spacing = typeof values["layout.spacing"] === "number" ? values["layout.spacing"] : 1;
    const tilt = typeof values["layout.tilt"] === "number" ? values["layout.tilt"] : 10;
    this.graph.setLayout(spacing, tilt);
    this.graph.instant = this.reduceMotion;
  }

  /** Une couleur du thème a été surchargée : relit les couleurs (la scène suit seule). */
  paletteChanged(): void {
    readPalette();
  }

  /** Durée des animations de caméra : 0 si l'utilisateur a demandé moins de mouvement. */
  private get flightMs(): number {
    return this.reduceMotion ? 0 : 800;
  }

  /** Les données du graphe ont changé (nouveau scan) : la scène en est prévenue. */
  dataChanged(): void {
    this.scene.update(this.graph);
  }

  /** Nom de la scène en service (utile pour vérifier quel rendu est actif). */
  get activeScene(): string {
    return this.sceneName;
  }

  /** Indique la largeur cachée à gauche par le panneau (0 quand il est replié). */
  setLeftInset(px: number): void {
    this.leftInset = px;
  }

  // --- Commandes venant de la barre d'outils ------------------------------------------

  /** Zoom animé : `factor` < 1 rapproche, > 1 éloigne. Mêmes bornes que la molette. */
  zoomBy(factor: number): void {
    this.zoomGoal = Camera.clampDistance((this.zoomGoal ?? this.camera.distance) * factor);
  }

  /** Revient en douceur (~0,8 s) à la vue initiale et retire la mise en évidence. */
  recenter(): void {
    this.selectedId = null;
    this.selectedFolder = null;
    this.flight = null;
    this.zoomGoal = null;
    const c = this.camera;
    this.recentering = {
      from: { yaw: c.yaw, pitch: c.pitch, distance: c.distance, target: [...c.target] },
      start: performance.now(),
    };
  }

  /** Active ou arrête la rotation automatique (et seulement elle). Renvoie le nouvel état. */
  toggleAutoRotate(): boolean {
    this.autoRotate = !this.autoRotate;
    return this.autoRotate;
  }

  private nodeById(id: string | null): GraphNode | null {
    return id ? (this.graph.nodes.find((n) => n.id === id) ?? null) : null;
  }

  // --- Souris ------------------------------------------------------------------------

  /** AIDE : les gestes souris ci-dessous sont aussi décrits dans SHORTCUTS (shortcuts.ts). */
  private listen(): void {
    const c = this.canvas;
    // Un geste sur la caméra : la rotation automatique s'arrête net (reprise après le geste).
    const touch = () => {
      this.lastInteraction = performance.now();
      this.spin = 0;
    };

    // Molette : rapproche/éloigne la caméra.
    c.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        touch();
        this.zoomGoal = null; // la molette reprend la main sur un zoom animé en cours
        this.recentering = null;
        this.camera.zoom(e.deltaY);
      },
      { passive: false },
    );

    // Glisser : tourne autour du centre. Clic droit ou Maj + glisser : déplace la vue.
    c.addEventListener("mousedown", (e) => {
      touch();
      this.recentering = null; // saisir la vue interrompt le retour à la vue initiale
      const mode = e.button === 2 || e.shiftKey ? "pan" : "rotate";
      this.drag = { x: e.clientX, y: e.clientY, mode };
      this.downAt = { x: e.clientX, y: e.clientY, button: e.button };
      c.classList.add("dragging");
    });
    c.addEventListener("contextmenu", (e) => e.preventDefault()); // pas de menu au clic droit
    window.addEventListener("mouseup", (e) => {
      // Clic (sans glisser) sur le nom d'un dossier : la caméra vole vers son anneau.
      const down = this.downAt;
      this.downAt = null;
      if (down && down.button === 0 && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 5) {
        const folder = this.scene.folderAt?.(e.clientX, e.clientY) ?? null;
        if (folder !== null) this.focusOrbit(folder);
      }
      if (this.drag) touch(); // le délai de reprise compte à partir du relâchement
      this.drag = null;
      c.classList.remove("dragging");
    });
    window.addEventListener("mousemove", (e) => {
      if (this.drag) {
        const dx = e.clientX - this.drag.x;
        const dy = e.clientY - this.drag.y;
        if (this.drag.mode === "rotate") this.camera.rotate(dx, dy);
        else this.camera.pan(dx, dy);
        this.drag.x = e.clientX;
        this.drag.y = e.clientY;
      }
      this.mouse = { x: e.clientX, y: e.clientY };
    });
    c.addEventListener("mouseleave", () => (this.mouse = null));
  }

  /** L'étoile sous la souris. S'il y en a plusieurs, la plus proche de la caméra gagne. */
  private findHovered(): GraphNode | null {
    if (!this.mouse || this.drag) return null;
    let best: GraphNode | null = null;
    let bestDepth = Infinity;
    for (const [n, p] of this.screen) {
      if (!p.visible) continue;
      const d = Math.hypot(p.x - this.mouse.x, p.y - this.mouse.y);
      const reach = Math.max(n.radius * p.scale, 4) + 6; // zone de survol un peu plus large que l'étoile
      if (d < reach && p.depth < bestDepth) {
        best = n;
        bestDepth = p.depth;
      }
    }
    return best;
  }

  // --- Boucle ------------------------------------------------------------------------

  /** Appelée à chaque image (~60 fois par seconde) par requestAnimationFrame. */
  private frame(time: number): void {
    const dt = Math.min((time - this.lastFrame) / 1000, 0.1); // secondes depuis l'image précédente
    this.lastFrame = time;

    this.graph.tick(); // ne calcule rien si la disposition est déjà stable
    this.graph.animateOrbits(); // transitions douces des anneaux

    // Premier chargement : reculer la caméra pour voir toutes les orbites.
    if (!this.fitted && this.graph.nodes.length > 0) {
      this.camera.distance = Math.max(450, this.graph.outerRadius * 1.9 + 120);
      this.home = { yaw: this.camera.yaw, pitch: this.camera.pitch, distance: this.camera.distance };
      this.fitted = true;
    }

    // Mesure des images par seconde, moyennée sur 0,5 s.
    this.fpsFrames++;
    if (time - this.fpsStart >= 500) {
      this.onFps((this.fpsFrames * 1000) / (time - this.fpsStart));
      this.fpsFrames = 0;
      this.fpsStart = time;
    }

    // Rotation automatique très lente. Pause VOLONTAIRE (Espace, bouton, vitesse 0, mouvement
    // réduit) : arrêt immédiat, et elle ne repart que si on la relance. Pendant un geste ou un
    // vol de caméra : arrêt, puis reprise douce RESUME_MS après. Survol d'une étoile : ralentie.
    if (!this.autoRotate || this.reduceMotion || this.rotationFactor === 0) {
      this.spin = 0;
    } else if (this.drag || this.flight || this.recentering || time - this.lastInteraction < RESUME_MS) {
      this.spin = 0;
    } else {
      const goal = this.hoveringStar ? HOVER_SPIN : 1;
      this.spin += (goal - this.spin) * (1 - Math.exp(-dt / SPIN_UP_S)); // accélère/ralentit en douceur
      this.camera.yaw += AUTO_SPEED * this.rotationFactor * this.spin * dt;
    }

    // Zoom animé (boutons) : la distance rejoint la valeur visée en douceur.
    if (this.zoomGoal !== null) {
      this.camera.distance += (this.zoomGoal - this.camera.distance) * (this.reduceMotion ? 1 : 0.15);
      if (Math.abs(this.zoomGoal - this.camera.distance) < 0.5) this.zoomGoal = null;
    }

    // Retour à la vue initiale : angle, zoom et point visé reviennent ensemble en 0,8 s.
    if (this.recentering) {
      const { from, start } = this.recentering;
      const k = this.flightMs === 0 ? 1 : Math.min(1, (time - start) / this.flightMs);
      const ease = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
      // Le plus court chemin pour l'angle : on ne refait pas plusieurs tours.
      const dYaw = Math.atan2(Math.sin(this.home.yaw - from.yaw), Math.cos(this.home.yaw - from.yaw));
      const c = this.camera;
      c.yaw = from.yaw + dYaw * ease;
      c.pitch = from.pitch + (this.home.pitch - from.pitch) * ease;
      c.distance = from.distance + (this.home.distance - from.distance) * ease;
      for (let i = 0; i < 3; i++) c.target[i] = from.target[i] * (1 - ease);
      if (k >= 1) this.recentering = null;
    }

    // Le centre de l'image glisse en douceur vers le milieu de l'espace laissé libre par le panneau.
    this.camera.offsetX += (this.leftInset / 2 - this.camera.offsetX) * 0.15;

    // Vol de caméra vers l'étoile choisie : le point visé passe de `from` à l'étoile en 0,8 s.
    if (this.flight) {
      const f = this.flight;
      const node = this.nodeById(f.id);
      const k = this.flightMs === 0 ? 1 : Math.min(1, (time - f.start) / this.flightMs);
      const ease = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2; // démarre et freine en douceur
      // Destination : l'étoile (qui peut encore bouger un peu) ou le point fixe.
      const to = node ? [node.x, node.y, node.z] : f.to;
      if (to) for (let i = 0; i < 3; i++) this.camera.target[i] = f.from[i] + (to[i] - f.from[i]) * ease;
      if (f.toDistance !== null) this.camera.distance = f.fromDistance + (f.toDistance - f.fromDistance) * ease;
      if (k >= 1 || (f.id !== null && !node)) {
        this.flight = null;
        this.lastInteraction = time; // la rotation reprend RESUME_MS après l'arrivée
      }
    }

    this.screen.clear();
    for (const n of this.graph.nodes) this.screen.set(n, this.camera.project(n.x, n.y, n.z));
    // La scène peut déplacer ce que l'on voit (lentille du trou noir) : survol, clic et noms
    // suivent alors les positions affichées.
    this.scene.displace?.(this.screen, this.camera);
    const underMouse = this.findHovered();
    this.hoveringStar = underMouse !== null;
    const overFolder = !underMouse && this.mouse && !this.drag ? this.scene.folderAt?.(this.mouse.x, this.mouse.y) != null : false;
    this.canvas.style.cursor = underMouse || overFolder ? "pointer" : "";
    // Étoile mise en évidence : celle sous la souris, sinon celle survolée dans le panneau,
    // sinon celle choisie dans le panneau.
    this.hovered = underMouse ?? this.nodeById(this.panelHoverId) ?? this.nodeById(this.selectedId);

    // La boucle tourne en continu (le fond de la scène peut bouger à chaque image).
    // 1. La scène dessine tout le décor et les étoiles.
    this.scene.render({
      time,
      camera: this.camera,
      screen: this.screen,
      highlighted: this.hovered,
      selectedFolder: this.selectedFolder,
    });
    // 2. Le moteur écrit les noms des notes sur son calque transparent, au-dessus.
    this.ctx.clearRect(0, 0, this.camera.width, this.camera.height);
    this.drawLabels();

    requestAnimationFrame((t) => this.frame(t));
  }

  // --- Noms des notes (dessinés par le moteur, identiques pour toutes les scènes) -----

  private fade(depth: number): number {
    return depthFade(depth, this.camera, this.graph.outerRadius);
  }

  /**
   * Noms des notes en surimpression, en petit texte clair :
   * d'abord l'étoile survolée ou choisie (en doré), puis les 5 notes les plus connectées.
   * Ils pâlissent avec la profondeur, et un nom qui en chevaucherait un autre n'est pas écrit.
   */
  private drawLabels(): void {
    const ctx = this.ctx;
    const taken: { x: number; y: number; w: number; h: number }[] = [];
    const overlaps = (r: { x: number; y: number; w: number; h: number }) =>
      taken.some((t) => r.x < t.x + t.w && r.x + r.w > t.x && r.y < t.y + t.h && r.y + r.h > t.y);

    // Les plus connectées d'abord (au moins un lien), puis on écrit dans cet ordre.
    const top = this.graph.nodes
      .filter((n) => !n.ghost && n.degree > 0 && n !== this.hovered)
      .sort((a, b) => b.degree - a.degree)
      .slice(0, this.labelCount);
    const list = this.hovered ? [this.hovered, ...top] : top;

    ctx.textBaseline = "middle";
    ctx.shadowColor = "rgba(0, 0, 0, 0.95)"; // ombre douce : lisible même sur les étoiles
    ctx.shadowBlur = 6;
    for (const n of list) {
      const p = this.screen.get(n);
      if (!p?.visible) continue;
      const main = n === this.hovered;
      const text = n.ghost ? `${n.label} · non écrite` : n.label;
      ctx.font = `300 ${main ? 15 : 12}px ${palette.font}`;
      const w = ctx.measureText(text).width;
      const gap = Math.max(n.radius * p.scale, 1.2) + 8;
      // À droite de l'étoile, ou à gauche si le texte sortirait de l'écran.
      const x = p.x + gap + w + 8 > this.camera.width ? p.x - gap - w : p.x + gap;
      const rect = { x: x - 4, y: p.y - 10, w: w + 8, h: 20 };
      if (!main && overlaps(rect)) continue;
      taken.push(rect);

      if (main) {
        ctx.fillStyle = n.ghost ? `rgba(${palette.label}, 0.75)` : `rgb(${palette.starAccent})`;
      } else {
        // Plus l'étoile est loin, plus son nom est pâle.
        ctx.fillStyle = `rgba(${palette.label}, ${0.85 * this.fade(p.depth)})`;
      }
      ctx.fillText(text, x, p.y);
    }
    ctx.shadowBlur = 0;
    ctx.shadowColor = "transparent";
  }
}
