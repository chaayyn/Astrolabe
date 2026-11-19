// Adapté de second-brain-black-hole (MIT, © williamwasen) — voir docs/third-party-notices.md
//
// Déviation des étoiles des notes par la LENTILLE du trou noir (approximation visuelle).
//
// Un point situé DERRIÈRE le trou noir (plus loin que lui depuis la caméra) et vu près de lui
// à l'écran paraît repoussé vers l'extérieur et étiré en arc, comme la lumière des étoiles
// autour d'un vrai trou noir. On applique la formule de la "lentille ponctuelle" du dépôt de
// référence (lensing.js) :
//   rayon d'Einstein θ = focale · √(K · écart / (distance du point · distance du trou noir))
//   image principale à ½ (β + √(β² + 4θ²)) du centre, β = distance d'origine au centre ;
//   image secondaire, plus faible, de l'autre côté : ½ (β − √(β² + 4θ²)).
// L'effet s'éteint en douceur au-delà de quelques θ, pour ne déplacer que ce qui est proche.
//
// Adaptations : calcul côté processeur (pas de shader), pour que le moteur puisse viser
// exactement les positions AFFICHÉES (survol, clic, noms) ; échelle calée sur le trou noir
// de l'étape 18 (K = 2 Rs, en unités du monde) ; réglage de force.
import type { Camera, Projected } from "../../camera";
import { HOLE_RADIUS } from "../classic/blackhole";
import { RS } from "./accretion";

/** Ce que la lentille fait à un point de l'écran. */
export interface LensImage {
  x: number;
  y: number;
  /** Étirement le long de l'arc (1 = rond), et direction (radians) de cet étirement. */
  stretch: number;
  angle: number;
  /** Image secondaire, faible, de l'autre côté du trou noir (ou `null`). */
  secondary: { x: number; y: number; weight: number } | null;
}

export class Lens {
  /** Centre du trou noir à l'écran, sa profondeur, et la focale de la caméra. */
  private cx = 0;
  private cy = 0;
  private depth = 0;
  private focal = 1;
  /** Rayon de l'ombre à l'écran (pixels) : ce qui tombe dedans, derrière, est caché. */
  private shadow = 0;
  private active = false;
  private strength = 1;

  setStrength(strength: number): void {
    this.strength = strength;
  }

  /** À appeler une fois par image, avant de dévier quoi que ce soit. */
  update(camera: Camera): void {
    const c = camera.project(0, 0, 0);
    this.active = c.visible && this.strength > 0;
    this.cx = c.x;
    this.cy = c.y;
    this.depth = c.depth;
    this.focal = camera.focal;
    this.shadow = HOLE_RADIUS * c.scale;
  }

  /** Centre du trou noir à l'écran (pour savoir si un trait passe près de lui). */
  get center(): { x: number; y: number } {
    return { x: this.cx, y: this.cy };
  }

  /** Distance (pixels) au-delà de laquelle rien n'est dévié, pour un point à cette profondeur. */
  reach(depth: number): number {
    return 4.5 * this.einstein(depth);
  }

  /** Rayon d'Einstein (pixels) pour un point à cette profondeur ; 0 s'il n'est pas derrière. */
  private einstein(depth: number): number {
    if (!this.active || depth <= this.depth + 1) return 0;
    const gap = depth - this.depth;
    return this.focal * Math.sqrt((2 * RS * this.strength * gap) / (depth * this.depth));
  }

  /**
   * Image d'un point (x, y à l'écran, `depth` devant la caméra), ou `null` s'il n'est pas dévié.
   * `hidden` est vrai si l'image tombe dans l'ombre (point caché derrière l'horizon).
   */
  deflect(x: number, y: number, depth: number): (LensImage & { hidden: boolean }) | null {
    const theta = this.einstein(depth);
    if (theta <= 0) return null;
    const dx = x - this.cx;
    const dy = y - this.cy;
    const beta = Math.hypot(dx, dy);
    const ratio = beta / Math.max(theta, 1);
    const influence = 1 - smoothstep(2.2, 4.5, ratio);
    if (influence <= 0.001) return null;
    const ux = beta > 0.001 ? dx / beta : 1;
    const uy = beta > 0.001 ? dy / beta : 0;
    const split = Math.sqrt(beta * beta + 4 * theta * theta);
    const image = 0.5 * (beta + split);
    const r = beta + (image - beta) * influence;
    // Étirement tangentiel (l'arc) : rapport des rayons, atténué loin du trou noir.
    const stretch = 1 + (Math.min(8, image / Math.max(beta, 1)) - 1) * influence;
    const second = 0.5 * (beta - split); // négatif : de l'autre côté
    const radialScale = 0.5 * (1 - beta / split);
    const weight = influence * Math.min(1, Math.abs(radialScale * (second / Math.max(beta, 1))));
    return {
      x: this.cx + ux * r,
      y: this.cy + uy * r,
      stretch,
      angle: Math.atan2(uy, ux) + Math.PI / 2,
      secondary: weight > 0.03 ? { x: this.cx + ux * second, y: this.cy + uy * second, weight } : null,
      hidden: r < this.shadow,
    };
  }

  /** Dévie un point projeté sur place (pour les traits et les lumières). */
  apply(p: { x: number; y: number; depth: number }): void {
    const img = this.deflect(p.x, p.y, p.depth);
    if (img) {
      p.x = img.x;
      p.y = img.y;
    }
  }

  /** Vrai si le segment ab passe assez près du trou noir pour être courbé. */
  near(a: Projected, b: Projected): boolean {
    const reach = this.reach(Math.max(a.depth, b.depth));
    if (reach <= 0) return false;
    // Distance du centre au segment, à l'écran.
    const vx = b.x - a.x;
    const vy = b.y - a.y;
    const len2 = vx * vx + vy * vy || 1;
    const t = Math.max(0, Math.min(1, ((this.cx - a.x) * vx + (this.cy - a.y) * vy) / len2));
    return Math.hypot(a.x + vx * t - this.cx, a.y + vy * t - this.cy) < reach;
  }
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
