// Adapté de second-brain-black-hole (MIT, © williamwasen) — voir THIRD_PARTY_LICENSES.md
//
// Les étoiles des notes et leurs liens, dans le style de la scène "galaxie" :
//   - étoiles : disque net, halo doux, petite pointe de diffraction pour les plus connectées,
//     scintillement léger et désynchronisé, anneau net au survol ;
//   - liens : traits très fins en dégradé, avec de petites LUMIÈRES qui voyagent dessus ;
//   - sections (## / ###) : de minuscules orbes qui tournent autour de leur étoile ;
//   - comètes : rares, ternes, jamais survolables ;
//   - lentille : près du trou noir, tout ce qui est DERRIÈRE lui est dévié et étiré en arc
//     (positions des étoiles calculées une fois par image dans displace(), traits et lumières
//     déviés point par point).
//
// D'après le dépôt de référence (blackhole.js, lensing.js) : profil lumineux des étoiles
// (cœur + halo), vague de scintillement, étirement en arc par la lentille, image secondaire,
// comètes qui tombent, lumières le long des liens. Adaptations : Canvas 2D au-dessus du ciel
// WebGL ; notre disposition par orbites de dossiers, notre caméra et notre survol sont gardés ;
// couleurs du thème ; réglages ; mouvement réduit.
//
// C'est une ClassicScene : elle en garde tout (anneaux des dossiers, noms des dossiers, ordre
// de dessin du fond vers l'avant, masque du trou noir) et ne redessine que liens et étoiles.
import type { Projected } from "../../camera";
import type { GraphEdge, GraphNode } from "../../graph";
import { ClassicScene } from "../classic/classic-scene";
import type { Lens, LensImage } from "./lens";

/** Réglages propres à ce style (le reste vient de ClassicScene). 1 = rendu prévu. */
export interface StarStyle {
  lights: boolean;
  lightSpeed: number;
  orbs: boolean;
  comets: boolean;
  cometRate: number;
  reduceMotion: boolean;
}

/** Au plus autant de lumières sur les liens (performance). */
const MAX_LIGHTS = 400;
/** Au plus autant d'orbes de sections par étoile. */
const MAX_ORBS = 6;
/** Un lien proche du trou noir est découpé en autant de morceaux pour suivre la lentille. */
const CURVE_STEPS = 18;
const HOVER_RING = 2.4; // rayon de l'anneau de survol (× rayon de l'étoile)

interface Comet {
  from: [number, number, number];
  to: [number, number, number];
  start: number; // ms
  duration: number; // ms
}

/** Petit nombre pseudo-aléatoire stable tiré d'un texte (0 à 1). */
function hashOf(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
}

/** Tirages mémorisés par objet (calculés une seule fois, pas à chaque image). */
const seeds = new WeakMap<object, number>();
function seedOf(item: GraphNode | GraphEdge, text: () => string): number {
  let s = seeds.get(item);
  if (s === undefined) seeds.set(item, (s = hashOf(text())));
  return s;
}

export class GalaxieStars extends ClassicScene {
  private style: StarStyle = { lights: true, lightSpeed: 1, orbs: true, comets: true, cometRate: 1, reduceMotion: false };
  private lens: Lens | null = null;
  /** Ce que la lentille a fait à chaque étoile cette image (étirement, image secondaire). */
  private images = new Map<GraphNode, LensImage>();
  private sprites!: { warm: HTMLCanvasElement; gold: HTMLCanvasElement; spikes: HTMLCanvasElement; light: HTMLCanvasElement };
  private spriteKey = "";
  private comets: Comet[] = [];
  private nextComet = 0;
  private lightsDrawn = 0;

  setStyle(style: StarStyle): void {
    this.style = style;
    if (!style.comets) this.comets = [];
  }

  /** La lentille à suivre (ou `null` : pas de trou noir WebGL, donc pas de déviation). */
  setLens(lens: Lens | null): void {
    this.lens = lens;
    this.images.clear();
  }

  /**
   * Positions affichées des étoiles : la lentille dévie celles qui passent derrière le trou
   * noir ; celles dont l'image tombe dans l'ombre deviennent invisibles (ni dessin ni survol).
   */
  displaceStars(screen: Map<GraphNode, Projected>): void {
    this.images.clear();
    const lens = this.lens;
    if (!lens) return;
    for (const [n, p] of screen) {
      if (!p.visible) continue;
      const img = lens.deflect(p.x, p.y, p.depth);
      if (!img) continue;
      if (img.hidden) {
        p.visible = false;
        continue;
      }
      p.x = img.x;
      p.y = img.y;
      this.images.set(n, img);
    }
  }

  // --- Liens -------------------------------------------------------------------------------

  protected override drawEdge(e: GraphEdge, a: Projected, b: Projected, lit: boolean, anyHover: boolean): void {
    const ctx = this.ctx;
    const pal = this.palette;
    const fade = this.fade((a.depth + b.depth) / 2);
    const ghost = e.target.ghost;
    const path = this.edgePath(e, a, b);

    // Trait : dégradé de la couleur d'une étoile à l'autre, très fin et semi-transparent.
    const base = Math.min(1, (anyHover ? 0.05 : 0.22) * fade * this.opts.links);
    const colorOf = (n: GraphNode) => (n.gold ? pal.starAccent : pal.link);
    if (lit) {
      ctx.strokeStyle = `rgba(${pal.starAccent}, 0.85)`;
      ctx.lineWidth = 1.2;
    } else if (e.source.gold !== e.target.gold || ghost) {
      // Dégradé seulement s'il y a une différence à montrer (accent d'un côté, fantôme…).
      const g = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
      g.addColorStop(0, `rgba(${colorOf(e.source)}, ${base})`);
      g.addColorStop(1, `rgba(${colorOf(e.target)}, ${ghost ? base * 0.5 : base})`);
      ctx.strokeStyle = g;
      ctx.lineWidth = 0.8;
    } else {
      ctx.strokeStyle = `rgba(${colorOf(e.source)}, ${base})`;
      ctx.lineWidth = 0.8;
    }
    if (ghost) ctx.setLineDash([2, 4]);
    ctx.beginPath();
    ctx.moveTo(path[0].x, path[0].y);
    for (let i = 1; i < path.length; i++) ctx.lineTo(path[i].x, path[i].y);
    ctx.stroke();
    if (ghost) ctx.setLineDash([]);

    // Lumière qui voyage le long du lien (pas sur les liens vers des notes fantômes).
    if (!this.style.lights || ghost || this.lightsDrawn >= MAX_LIGHTS) return;
    this.lightsDrawn++;
    const speed = this.style.lightSpeed * (this.style.reduceMotion ? 0.03 : 1);
    const seed = seedOf(e, () => e.source.id + "→" + e.target.id);
    const t = (seed + (this.frame.time / 1000) * 0.12 * speed * (0.7 + seed * 0.6)) % 1;
    const point = this.pointOnEdge(e, t);
    if (!point) return;
    const size = (lit ? 10 : 8) * Math.max(0.7, Math.min(1.4, point.scale * 2));
    ctx.globalAlpha = (lit ? 1 : anyHover ? 0.3 : 0.9) * fade * Math.sin(Math.PI * t); // naît et s'éteint aux bouts
    ctx.drawImage(this.sprites.light, point.x - size / 2, point.y - size / 2, size, size);
    ctx.globalAlpha = 1;
  }

  /** Points du trait à l'écran : droit, ou courbé par la lentille s'il passe près du trou noir. */
  private edgePath(e: GraphEdge, a: Projected, b: Projected): { x: number; y: number }[] {
    if (!this.lens || !this.lens.near(a, b)) return [a, b];
    const pts: { x: number; y: number }[] = [];
    for (let i = 0; i <= CURVE_STEPS; i++) {
      const p = this.pointOnEdge(e, i / CURVE_STEPS);
      if (p) pts.push(p);
    }
    return pts.length >= 2 ? pts : [a, b];
  }

  /** Point à la fraction t du lien, projeté puis dévié par la lentille. */
  private pointOnEdge(e: GraphEdge, t: number): Projected | null {
    const s = e.source;
    const d = e.target;
    const p = this.frame.camera.project(s.x + (d.x - s.x) * t, s.y + (d.y - s.y) * t, s.z + (d.z - s.z) * t);
    if (!p.visible) return null;
    this.lens?.apply(p);
    return p;
  }

  // --- Étoiles ------------------------------------------------------------------------------

  protected override drawNode(n: GraphNode, p: Projected, dim: boolean, time: number): void {
    this.refreshSprites();
    const ctx = this.ctx;
    const pal = this.palette;
    // Cœur net plus petit que la zone de survol ; c'est le halo qui donne la présence.
    const r = Math.max(n.radius * p.scale * this.opts.size * 0.55, 1.1);
    const depthAlpha = this.fade(p.depth);
    const highlighted = this.frame.highlighted === n;

    if (n.ghost) {
      ctx.strokeStyle = `rgba(${pal.star}, ${(dim ? 0.12 : 0.4) * depthAlpha})`;
      ctx.lineWidth = 0.8;
      ctx.setLineDash([2, 2]);
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      return;
    }

    // Scintillement : une vague lente propre à chaque étoile (désynchronisées).
    const seed = seedOf(n, () => n.id);
    const wave = this.style.reduceMotion ? 0 : Math.pow(Math.max(0, Math.cos(seed * 40 - time / 1000 * (0.6 + seed * 0.5))), 12);
    const alpha = depthAlpha * (dim ? 0.3 : 1) * (0.88 + 0.12 * wave);
    const img = this.images.get(n);

    ctx.save();
    ctx.translate(p.x, p.y);
    // Près du trou noir : l'étoile est étirée en arc autour de lui.
    if (img && img.stretch > 1.05) {
      ctx.rotate(img.angle);
      ctx.scale(Math.min(img.stretch, 8), 1 / Math.sqrt(img.stretch));
    }

    // Halo doux (sprite pré-dessiné), plus large avec le réglage d'intensité.
    const glow = this.opts.glow;
    if (glow > 0) {
      const size = r * 13 * (0.55 + 0.45 * glow) * (1 + 0.15 * wave);
      ctx.globalAlpha = alpha * Math.min(1, glow);
      ctx.drawImage(n.gold ? this.sprites.gold : this.sprites.warm, -size / 2, -size / 2, size, size);
    }
    // Pointes de diffraction discrètes pour les plus connectées.
    if (n.gold && glow > 0) {
      const size = r * 16 * (0.8 + 0.3 * wave);
      ctx.globalAlpha = alpha * 0.55 * Math.min(1, glow);
      ctx.drawImage(this.sprites.spikes, -size / 2, -size / 2, size, size);
    }
    // Halo doré bref si la note vient d'apparaître ou d'être modifiée (comme la scène classique).
    const age = time - n.flashAt;
    if (n.flashAt > 0 && age < 1500) {
      const k = 1 - age / 1500;
      const size = r * (8 + 14 * k);
      ctx.globalAlpha = k;
      ctx.drawImage(this.sprites.gold, -size / 2, -size / 2, size, size);
    }
    // Cœur net.
    ctx.globalAlpha = alpha;
    ctx.fillStyle = `rgb(${n.gold ? pal.starAccent : pal.star})`;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.globalAlpha = 1;

    // Image secondaire, faible, de l'autre côté du trou noir.
    if (img?.secondary) {
      const s = img.secondary;
      const size = r * 5;
      ctx.globalAlpha = alpha * s.weight * 0.8;
      ctx.drawImage(n.gold ? this.sprites.gold : this.sprites.warm, s.x - size / 2, s.y - size / 2, size, size);
      ctx.globalAlpha = 1;
    }

    // Survol / sélection : un anneau net autour de l'étoile.
    if (highlighted) {
      ctx.strokeStyle = `rgba(${pal.starAccent}, 0.9)`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r * HOVER_RING + 4, 0, Math.PI * 2);
      ctx.stroke();
    }

    this.drawOrbs(n, p, r, alpha, highlighted, time);
  }

  /** Petites orbes des sections, en orbite autour de l'étoile (de près, ou au survol). */
  private drawOrbs(n: GraphNode, p: Projected, r: number, alpha: number, highlighted: boolean, time: number): void {
    if (!this.style.orbs || n.sections === 0) return;
    if (!highlighted && r < 3.2) return; // trop loin : on ne surcharge pas
    const ctx = this.ctx;
    const count = Math.min(MAX_ORBS, n.sections);
    const seed = (seedOf(n, () => n.id) * 7.13) % 1;
    const spin = this.style.reduceMotion ? 0 : time / 1000;
    const tilt = 0.35 + seed * 0.3; // orbite vue un peu de biais
    ctx.fillStyle = `rgb(${this.palette.star})`;
    for (let i = 0; i < count; i++) {
      const radius = r * (2.6 + i * 0.55);
      const angle = seed * 6.28 + (i * 6.28) / count + spin * (0.5 / (1 + i * 0.35));
      ctx.globalAlpha = alpha * (highlighted ? 0.8 : 0.5);
      ctx.beginPath();
      ctx.arc(p.x + Math.cos(angle) * radius, p.y + Math.sin(angle) * radius * tilt, Math.max(0.8, r * 0.18), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // --- Comètes (après tout le reste) ---------------------------------------------------------

  protected override afterScene(): void {
    this.lightsDrawn = 0; // compteur remis à zéro pour l'image suivante
    if (!this.style.comets || this.style.reduceMotion) return;
    const time = this.frame.time;
    // Une nouvelle comète de temps en temps (environ toutes les 12 à 40 s au réglage normal).
    if (time >= this.nextComet) {
      if (this.nextComet > 0 && this.comets.length < 2) this.comets.push(this.newComet(time));
      this.nextComet = time + ((12 + Math.random() * 28) * 1000) / Math.max(0.1, this.style.cometRate);
    }
    this.comets = this.comets.filter((c) => time < c.start + c.duration);
    for (const c of this.comets) this.drawComet(c, time);
  }

  private newComet(time: number): Comet {
    const R = Math.max(500, this.graph.outerRadius * 1.6);
    const dir = () => {
      const u = Math.random() * 2 - 1;
      const a = Math.random() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      return [Math.cos(a) * s, u * 0.5, Math.sin(a) * s] as [number, number, number];
    };
    const from = dir().map((v) => v * R) as [number, number, number];
    // Elle passe à côté du centre (jamais au milieu des étoiles), puis repart de l'autre côté.
    const miss = dir().map((v) => v * R * 0.45);
    const to = from.map((v, i) => -v + miss[i]) as [number, number, number];
    return { from, to, start: time, duration: 7000 + Math.random() * 5000 };
  }

  private drawComet(c: Comet, time: number): void {
    const ctx = this.ctx;
    const k = (time - c.start) / c.duration;
    const at = (t: number) => {
      const p = this.frame.camera.project(...(c.from.map((v, i) => v + (c.to[i] - v) * t) as [number, number, number]));
      if (p.visible) this.lens?.apply(p);
      return p;
    };
    const head = at(k);
    const tail = at(Math.max(0, k - 0.07));
    if (!head.visible || !tail.visible) return;
    const life = Math.sin(Math.PI * k); // apparaît et disparaît en douceur
    const g = ctx.createLinearGradient(head.x, head.y, tail.x, tail.y);
    g.addColorStop(0, `rgba(${this.palette.star}, ${0.45 * life})`);
    g.addColorStop(1, `rgba(${this.palette.star}, 0)`);
    ctx.strokeStyle = g;
    ctx.lineWidth = 1.2;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(head.x, head.y);
    ctx.lineTo(tail.x, tail.y);
    ctx.stroke();
    ctx.lineCap = "butt";
    ctx.globalAlpha = 0.5 * life;
    ctx.drawImage(this.sprites.light, head.x - 3, head.y - 3, 6, 6);
    ctx.globalAlpha = 1;
  }

  // --- Sprites pré-dessinés ------------------------------------------------------------------

  /** Refait les petites images (halos, pointes, lumière) si les couleurs du thème ont changé. */
  private refreshSprites(): void {
    const pal = this.palette;
    const key = `${pal.star}|${pal.starAccent}|${pal.link}`;
    if (key === this.spriteKey) return;
    this.spriteKey = key;
    this.sprites = {
      warm: halo(pal.star),
      gold: halo(pal.starAccent),
      spikes: spikes(pal.starAccent),
      light: halo(pal.star, 0.95),
    };
  }
}

/** Halo rond : cœur clair et longue retombée douce (profil des étoiles de la référence). */
function halo(rgb: string, core = 0.6): HTMLCanvasElement {
  const size = 64;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, `rgba(${rgb}, ${core})`);
  grad.addColorStop(0.12, `rgba(${rgb}, ${core * 0.45})`);
  grad.addColorStop(0.35, `rgba(${rgb}, ${core * 0.12})`);
  grad.addColorStop(1, `rgba(${rgb}, 0)`);
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return c;
}

/** Pointes de diffraction : une croix très fine qui s'estompe vers ses bouts. */
function spikes(rgb: string): HTMLCanvasElement {
  const size = 128;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  for (const [x0, y0, x1, y1] of [
    [0, size / 2, size, size / 2],
    [size / 2, 0, size / 2, size],
  ]) {
    const grad = g.createLinearGradient(x0, y0, x1, y1);
    grad.addColorStop(0, `rgba(${rgb}, 0)`);
    grad.addColorStop(0.5, `rgba(${rgb}, 0.9)`);
    grad.addColorStop(1, `rgba(${rgb}, 0)`);
    g.strokeStyle = grad;
    g.lineWidth = 1.2;
    g.beginPath();
    g.moveTo(x0, y0);
    g.lineTo(x1, y1);
    g.stroke();
  }
  return c;
}
