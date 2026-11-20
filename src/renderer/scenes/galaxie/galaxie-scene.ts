// Scène "galaxie" : un ciel profond et un trou noir calculés par la carte graphique (WebGL2,
// sky.ts puis accretion.ts, dans le même canvas), et par-dessus les étoiles et liens des notes
// (stars.ts) : le dessin de la scène "classique" (anneaux et noms des dossiers, ordre de
// dessin, survol) réutilisé tel quel, avec des étoiles, liens, orbes de sections et comètes
// au style "galaxie", déviés par la lentille du trou noir (lens.ts). Ni fond étoilé ni trou
// noir 2D : on y efface ce qui passe DERRIÈRE l'ombre du trou noir.
//
//   calque #scene ─┬─ canvas WebGL2 : ciel (nébuleuse, étoiles, météores), puis trou noir
//                  └─ canvas 2D transparent : étoiles et liens des notes (stars.ts)
//
// Replis : WebGL2 absent → le moteur choisit "classique". Shader du trou noir refusé → ciel
// WebGL gardé, trou noir 2D de la scène classique. Carte graphique reprise en cours de route →
// fond et trou noir 2D classiques le temps qu'elle revienne.
import type { Camera, Projected } from "../../camera";
import type { GraphNode } from "../../graph";
import type { ParamDef, ParamValues } from "../../params";
import type { Palette, Scene, SceneFrame, SceneGraph } from "../scene";
import { Accretion, shadowRadius, type HoleOptions } from "./accretion";
import { Lens } from "./lens";
import { Sky } from "./sky";
import { GalaxieStars } from "./stars";

/** Réglages des étoiles et des liens (groupe "Étoiles et liens"). Défauts = le rendu prévu. */
const STAR_PARAMS: readonly ParamDef[] = [
  { id: "stars.glow", label: "Intensité du halo des étoiles", group: "Étoiles et liens", type: "slider", min: 0, max: 2, step: 0.05, unit: "×", default: 1 },
  { id: "stars.size", label: "Taille des étoiles", group: "Étoiles et liens", type: "slider", min: 0.5, max: 2, step: 0.05, unit: "×", default: 1 },
  { id: "stars.links", label: "Luminosité des liens", group: "Étoiles et liens", type: "slider", min: 0, max: 3, step: 0.05, unit: "×", default: 1 },
  { id: "stars.lens", label: "Déviation par la lentille", group: "Étoiles et liens", type: "slider", min: 0, max: 2, step: 0.05, unit: "×", default: 1 },
  { id: "links.lights", label: "Lumières sur les liens", group: "Étoiles et liens", type: "toggle", default: true },
  { id: "links.lightSpeed", label: "Vitesse des lumières", group: "Étoiles et liens", type: "slider", min: 0.2, max: 3, step: 0.1, unit: "×", default: 1 },
  { id: "stars.orbs", label: "Orbes des sections", group: "Étoiles et liens", type: "toggle", default: true },
  { id: "comets.on", label: "Comètes", group: "Étoiles et liens", type: "toggle", default: true },
  { id: "comets.rate", label: "Fréquence des comètes", group: "Étoiles et liens", type: "slider", min: 0.2, max: 3, step: 0.1, unit: "×", default: 1 },
];

/** Réglages du ciel (groupe "Ciel"). Défauts = le rendu prévu. */
const SKY_PARAMS: readonly ParamDef[] = [
  { id: "sky.nebula", label: "Intensité de la nébuleuse", group: "Ciel", type: "slider", min: 0, max: 3, step: 0.05, unit: "×", default: 1 },
  { id: "sky.density", label: "Densité des étoiles du ciel", group: "Ciel", type: "slider", min: 0, max: 2.5, step: 0.05, unit: "×", default: 1 },
  { id: "sky.brightness", label: "Luminosité générale", group: "Ciel", type: "slider", min: 0.3, max: 2, step: 0.05, unit: "×", default: 1 },
  { id: "sky.meteors", label: "Météores", group: "Ciel", type: "toggle", default: true },
];

/** Réglages du trou noir (groupe "Trou noir"). Défauts = le rendu prévu. */
const HOLE_PARAMS: readonly ParamDef[] = [
  { id: "hole.brightness", label: "Luminosité du disque", group: "Trou noir", type: "slider", min: 0.2, max: 2.5, step: 0.05, unit: "×", default: 1 },
  { id: "hole.lens", label: "Force de la lentille", group: "Trou noir", type: "slider", min: 0, max: 1.6, step: 0.05, unit: "×", default: 1 },
  { id: "hole.spin", label: "Vitesse de rotation du disque", group: "Trou noir", type: "slider", min: 0, max: 3, step: 0.1, unit: "×", default: 1 },
  { id: "hole.halo", label: "Intensité du halo", group: "Trou noir", type: "slider", min: 0, max: 2.5, step: 0.05, unit: "×", default: 1 },
  { id: "hole.tilt", label: "Inclinaison du disque", group: "Trou noir", type: "slider", min: -30, max: 30, step: 1, unit: "°", default: 8 },
  {
    id: "hole.quality",
    label: "Qualité",
    group: "Trou noir",
    type: "choice",
    options: [
      { value: "low", label: "Basse" },
      { value: "medium", label: "Moyenne" },
      { value: "high", label: "Élevée" },
    ],
    default: "medium",
  },
];

/** Le système demande moins d'animations (préférence d'accessibilité). */
const systemReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

export class GalaxieScene implements Scene {
  /** Les réglages des étoiles (comme la scène classique), puis ceux du ciel et du trou noir. */
  readonly params: readonly ParamDef[] = [...STAR_PARAMS, ...SKY_PARAMS, ...HOLE_PARAMS];
  private sky: Sky | null = null;
  private hole: Accretion | null = null;
  private classic = new GalaxieStars({ starfield: false });
  /** Lentille du trou noir : dévie les étoiles et les liens qui passent derrière lui. */
  private lens = new Lens();
  private palette!: Palette;
  private holeOptions: HoleOptions = { brightness: 1, lens: 1, spin: 1, halo: 1, tilt: 8, quality: "medium" };
  private reduceMotion = false;

  init(layer: HTMLElement, palette: Palette): void {
    this.palette = palette;
    this.sky = new Sky(); // erreur si WebGL2 indisponible : le moteur choisira "classique"
    this.sky.onAvailability = (available) => {
      this.classic.setStarfield(!available);
      if (available) this.startHole(); // tout ce que contenait la carte graphique est à refaire
      else this.hole = null; // ses ressources ont disparu avec le contexte
      this.syncMask();
    };
    this.startHole();
    layer.append(this.sky.canvas); // d'abord le ciel et le trou noir (dessous)…
    this.classic.init(layer, palette); // …puis le dessin classique (dessus)
    this.syncMask();
  }

  setParams(values: ParamValues): void {
    this.classic.setParams(values);
    const num = (id: string, fallback: number) => (typeof values[id] === "number" ? (values[id] as number) : fallback);
    this.sky?.setOptions({
      nebula: num("sky.nebula", 1),
      density: num("sky.density", 1),
      brightness: num("sky.brightness", 1),
      meteors: values["sky.meteors"] !== false,
    });
    const quality = values["hole.quality"];
    this.holeOptions = {
      brightness: num("hole.brightness", 1),
      lens: num("hole.lens", 1),
      spin: num("hole.spin", 1),
      halo: num("hole.halo", 1),
      tilt: num("hole.tilt", 8),
      quality: quality === "low" || quality === "high" ? quality : "medium",
    };
    this.reduceMotion = values["motion.reduce"] === true;
    this.hole?.setOptions(this.holeOptions, this.reduceMotion || systemReducedMotion.matches);
    this.lens.setStrength(num("stars.lens", 1));
    this.classic.setStyle({
      lights: values["links.lights"] !== false,
      lightSpeed: num("links.lightSpeed", 1),
      orbs: values["stars.orbs"] !== false,
      comets: values["comets.on"] !== false,
      cometRate: num("comets.rate", 1),
      reduceMotion: this.reduceMotion || systemReducedMotion.matches,
    });
    this.syncMask();
  }

  /**
   * Avant le dessin : la lentille dévie les étoiles qui passent derrière le trou noir. Le moteur
   * utilise ensuite ces positions affichées pour le survol, le clic et les noms des notes.
   */
  displace(screen: Map<GraphNode, Projected>, camera: Camera): void {
    this.lens.update(camera);
    this.classic.displaceStars(screen);
  }

  /** Nom de dossier sous la souris (dessiné par la partie classique). */
  folderAt(x: number, y: number): string | null {
    return this.classic.folderAt(x, y);
  }

  update(graph: SceneGraph): void {
    this.classic.update(graph);
  }

  render(frame: SceneFrame): void {
    if (this.sky?.render(frame.camera, frame.time, this.palette) && this.hole) {
      this.hole.setOptions(this.holeOptions, this.reduceMotion || systemReducedMotion.matches);
      try {
        this.hole.render(frame.camera, frame.time, this.palette, this.sky.pixelScale);
      } catch (err) {
        console.error("[trou noir] rendu impossible : trou noir 2D à la place.", err);
        this.hole.dispose();
        this.hole = null;
        this.syncMask();
      }
    }
    this.classic.render(frame);
  }

  dispose(): void {
    this.hole?.dispose();
    this.hole = null;
    this.sky?.dispose(); // libère aussi le contexte partagé
    this.sky = null;
    this.classic.dispose();
  }

  /** Crée le trou noir WebGL ; si un shader est refusé, on garde le trou noir 2D (message en console). */
  private startHole(): void {
    if (!this.sky) return;
    try {
      this.hole = new Accretion(this.sky.context);
      this.hole.setOptions(this.holeOptions, this.reduceMotion || systemReducedMotion.matches);
    } catch (err) {
      this.hole = null;
      console.error("[trou noir] WebGL indisponible pour le trou noir : trou noir 2D à la place.", err);
    }
  }

  /**
   * Trou noir WebGL actif : on efface ce qui passe derrière son ombre et la lentille dévie les
   * étoiles. Sinon (trou noir 2D de repli) : ni masque ni déviation.
   */
  private syncMask(): void {
    this.classic.setHoleMask(this.hole ? shadowRadius(this.holeOptions.lens) : null);
    this.classic.setLens(this.hole ? this.lens : null);
  }
}
