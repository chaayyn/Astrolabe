// Scène "classique" : le rendu Canvas 2D de l'app (ciel étoilé, anneaux des dossiers,
// liens, étoiles avec halo, trou noir). Elle ne fait que dessiner : positions, survol et
// caméra viennent du moteur. C'est la scène par défaut, et le repli si une autre manque.
import type { Projected } from "../../camera";
import type { GraphEdge, GraphNode, Orbit } from "../../graph";
import type { ParamDef, ParamValues } from "../../params";
import { depthFade, type Palette, type Scene, type SceneFrame, type SceneGraph } from "../scene";
import { drawBlackHole, HOLE_RADIUS } from "./blackhole";
import { Starfield } from "./starfield";

const FLASH_MS = 1500; // durée du halo doré sur une étoile nouvelle/modifiée
const RING_SEGMENTS = 180; // un anneau est dessiné comme 180 petits segments (un sur deux : pointillé)

/**
 * Réglages des étoiles des notes et des liens (groupe "Étoiles"). Défauts = rendu habituel.
 * Exportés : la scène "galaxie", qui réutilise ce dessin, propose les mêmes.
 */
export const STAR_PARAMS: readonly ParamDef[] = [
  { id: "stars.glow", label: "Intensité du halo", group: "Étoiles", type: "slider", min: 0, max: 2, step: 0.05, unit: "×", default: 1 },
  { id: "stars.size", label: "Taille des étoiles", group: "Étoiles", type: "slider", min: 0.5, max: 2, step: 0.05, unit: "×", default: 1 },
  { id: "stars.links", label: "Luminosité des liens", group: "Étoiles", type: "slider", min: 0, max: 3, step: 0.05, unit: "×", default: 1 },
];

/** Réglages de la scène classique : ceux des étoiles, plus ceux de son fond étoilé 2D. */
const PARAMS: readonly ParamDef[] = [
  ...STAR_PARAMS,
  { id: "stars.skyDensity", label: "Densité du fond étoilé", group: "Étoiles", type: "slider", min: 0, max: 2, step: 0.1, unit: "×", default: 1 },
  { id: "stars.twinkle", label: "Scintillement du fond", group: "Étoiles", type: "slider", min: 0, max: 1.8, step: 0.1, unit: "×", default: 1 },
];

export class ClassicScene implements Scene {
  readonly params = PARAMS;
  /**
   * `true` : la scène peint son propre fond (ciel noir étoilé, opaque). `false` : fond
   * transparent, pour qu'une autre scène (ex. "galaxie") pose son ciel dessous.
   */
  private starfield: boolean;
  /**
   * Trou noir : `null` = la scène dessine son trou noir 2D. Un nombre = une autre scène dessine
   * le trou noir (WebGL) DERRIÈRE ce canvas : on se contente d'effacer, dans un disque de ce
   * rayon (unités du monde), tout ce qui passe derrière lui, pour qu'il le cache.
   */
  private holeMask: number | null = null;
  /** Valeurs courantes des réglages (multiplicateurs, 1 = rendu habituel). */
  protected opts = { glow: 1, size: 1, links: 1 };
  /** Réglage "Noms des dossiers" (moteur, groupe Orbites). */
  private folderLabels = true;
  /** Zones des noms de dossiers écrits à la dernière image (pour le clic). */
  private labelRects: { x: number; y: number; w: number; h: number; folder: string }[] = [];
  private canvas = document.createElement("canvas");
  protected ctx = this.canvas.getContext("2d")!;
  /** Ciel étoilé du fond (3 couches pré-dessinées). */
  private sky = new Starfield();
  protected palette!: Palette;
  protected graph: SceneGraph = { nodes: [], edges: [], orbits: [], outerRadius: 0 };
  /** Halos pré-dessinés : bien plus rapide que de recalculer un dégradé par étoile. */
  private glow!: { warm: HTMLCanvasElement; gold: HTMLCanvasElement };
  /** Couleurs avec lesquelles les halos ont été dessinés (pour les refaire si elles changent). */
  private glowKey = "";
  /** Taille actuelle (pixels CSS et densité de l'écran), pour savoir quand tout refaire. */
  private size = { w: 0, h: 0, dpr: 0 };

  // Les valeurs de l'image en cours (pour ne pas les passer à chaque petite fonction).
  protected frame!: SceneFrame;

  constructor(options: { starfield?: boolean } = {}) {
    this.starfield = options.starfield ?? true;
  }

  /** Trou noir dessiné ailleurs (rayon de l'ombre, unités du monde), ou `null` pour le dessiner ici. */
  setHoleMask(radius: number | null): void {
    this.holeMask = radius;
  }

  /** Active ou retire le fond étoilé 2D (repli de la scène "galaxie" si son ciel tombe). */
  setStarfield(on: boolean): void {
    if (on === this.starfield) return;
    this.starfield = on;
    if (on && this.size.w > 0) this.sky.resize(this.size.w, this.size.h, this.size.dpr);
  }

  init(layer: HTMLElement, palette: Palette): void {
    this.palette = palette;
    this.refreshGlow();
    this.canvas.className = "scene-canvas";
    layer.append(this.canvas);
  }

  setParams(values: ParamValues): void {
    const num = (id: string) => (typeof values[id] === "number" ? (values[id] as number) : 1);
    this.opts = { glow: num("stars.glow"), size: num("stars.size"), links: num("stars.links") };
    this.sky.setOptions(num("stars.skyDensity"), num("stars.twinkle"));
    this.folderLabels = values["display.folderLabels"] !== false;
  }

  /** Refait les halos si les couleurs ont changé (ex. couleur des étoiles modifiée dans Paramètres). */
  private refreshGlow(): void {
    const key = `${this.palette.star}|${this.palette.starAccent}`;
    if (key === this.glowKey) return;
    this.glowKey = key;
    this.glow = { warm: makeGlow(this.palette.star), gold: makeGlow(this.palette.starAccent) };
  }

  update(graph: SceneGraph): void {
    this.graph = graph;
  }

  dispose(): void {
    this.canvas.remove();
    this.canvas.width = this.canvas.height = 0; // rend la mémoire du canvas tout de suite
  }

  render(frame: SceneFrame): void {
    this.frame = frame;
    this.fitToScreen(frame.camera.width, frame.camera.height);
    this.refreshGlow(); // presque gratuit : ne refait rien si les couleurs n'ont pas changé

    // Le fond scintille et le trou noir tourne : on redessine toute l'image à chaque fois.
    if (this.starfield) this.sky.draw(this.ctx, frame.time / 1000, frame.camera.yaw, frame.camera.pitch);
    else this.ctx.clearRect(0, 0, frame.camera.width, frame.camera.height);
    this.labelRects = [];
    for (const o of [...this.graph.orbits].sort((a, b) => a.index - b.index)) this.drawOrbit(o);
    this.drawScene();
    this.afterScene();
  }

  /** Après tout le reste (rien dans la scène classique) : une scène dérivée peut y ajouter un décor. */
  protected afterScene(): void {}

  /** Suit la taille de la fenêtre et la densité de l'écran (net en haute densité). */
  private fitToScreen(w: number, h: number): void {
    const dpr = window.devicePixelRatio || 1;
    if (w === this.size.w && h === this.size.h && dpr === this.size.dpr) return;
    this.size = { w, h, dpr };
    // Le canvas a dpr fois plus de pixels réels que de pixels CSS ; on dessine en pixels CSS.
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (this.starfield) this.sky.resize(w, h, dpr); // le ciel est régénéré à la nouvelle taille
  }

  protected fade(depth: number): number {
    return depthFade(depth, this.frame.camera, this.graph.outerRadius);
  }

  /**
   * Un anneau : le cercle d'un dossier dans le disque, projeté (il devient une ellipse), en
   * trait fin continu dont l'opacité suit la profondeur. Plus net si une note du dossier est
   * survolée ou si le dossier est choisi ; estompé si un AUTRE dossier est choisi.
   */
  private drawOrbit(o: Orbit): void {
    const ctx = this.ctx;
    const { camera, highlighted: h, selectedFolder } = this.frame;
    const palette = this.palette;
    const lit = (h !== null && !h.ghost && h.folder === o.folder) || (selectedFolder !== null && inFolder(o.folder, selectedFolder));
    const dimmed = selectedFolder !== null && !lit;
    const base = (lit ? 0.75 : 0.3) * (dimmed ? 0.35 : 1) * o.opacity;
    const rgb = lit ? palette.starAccent : palette.orbit;
    const r = o.shownRadius;

    // Points de l'anneau projetés à l'écran.
    const pts: Projected[] = [];
    for (let i = 0; i <= RING_SEGMENTS; i++) {
      const t = (i / RING_SEGMENTS) * Math.PI * 2;
      pts.push(this.ringPoint(o, r, t));
    }
    ctx.lineWidth = lit ? 1.2 : 0.8;
    for (let i = 0; i < RING_SEGMENTS; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      if (!a.visible || !b.visible) continue;
      ctx.strokeStyle = `rgba(${rgb}, ${base * this.fade((a.depth + b.depth) / 2)})`;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }

    if (this.folderLabels) this.drawOrbitLabel(o, lit, dimmed);
  }

  /** Un point de l'anneau `o` (rayon r, angle t), projeté à l'écran. */
  private ringPoint(o: Orbit, r: number, t: number): Projected {
    const c = Math.cos(t) * r;
    const s = Math.sin(t) * r;
    return this.frame.camera.project(c * o.u[0] + s * o.v[0], c * o.u[1] + s * o.v[1], c * o.u[2] + s * o.v[2]);
  }

  /**
   * Nom du dossier, posé SUR son anneau, à un angle propre à chaque anneau (les noms se
   * répartissent autour du disque). Toujours écrit droit, face à la caméra. Il est sauté
   * s'il chevaucherait un nom déjà écrit, et estompé s'il passe derrière le trou noir.
   * Sa zone est retenue : un clic dessus fait voler la caméra vers l'anneau (folderAt).
   */
  private drawOrbitLabel(o: Orbit, lit: boolean, dimmed: boolean): void {
    const ctx = this.ctx;
    ctx.font = '10px ui-monospace, "DejaVu Sans Mono", "Liberation Mono", monospace';
    ctx.letterSpacing = "3px";
    const text = (o.folder === "" ? "Racine" : (o.folder.split("/").pop() ?? o.folder)).toUpperCase();
    const w = ctx.measureText(text).width + 3;
    const overlaps = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) =>
      a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
    // Le nom glisse un peu le long de son anneau si une étoile (ou un autre nom) est dessous.
    let p: Projected | null = null;
    let rect: { x: number; y: number; w: number; h: number; folder: string } | null = null;
    for (const shift of [0, 0.1, -0.1, 0.2, -0.2, 0.3, -0.3, 0.45, -0.45]) {
      const q = this.ringPoint(o, o.shownRadius, o.labelAngle + shift);
      if (!q.visible) continue;
      const r = { x: q.x - w / 2 - 6, y: q.y - 8, w: w + 12, h: 16, folder: o.folder };
      if (this.labelRects.some((t) => overlaps(r, t))) continue;
      let onStar = false;
      for (const [n, s] of this.frame.screen) {
        if (!s.visible) continue;
        const rad = Math.max(n.radius * s.scale, 2) + 3;
        if (overlaps(r, { x: s.x - rad, y: s.y - rad, w: rad * 2, h: rad * 2 })) {
          onStar = true;
          break;
        }
      }
      if (onStar) continue;
      p = q;
      rect = r;
      break;
    }
    if (!p || !rect) {
      ctx.letterSpacing = "0px";
      return;
    }
    this.labelRects.push(rect);
    // Derrière le trou noir et tout près de lui à l'écran : très pâle.
    const hole = this.frame.camera.project(0, 0, 0);
    const behind = hole.visible && p.depth > hole.depth && Math.hypot(p.x - hole.x, p.y - hole.y) < HOLE_RADIUS * 3.4 * hole.scale;
    const alpha = (lit ? 1 : 0.7) * (dimmed ? 0.35 : 1) * (behind ? 0.25 : 1) * o.opacity * this.fade(p.depth);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    // Pas de boîte derrière le nom (elle découpait la lueur du trou noir) : une ombre douce suffit.
    ctx.shadowColor = `rgba(0, 0, 0, ${0.9 * alpha})`;
    ctx.shadowBlur = 5;
    // Couleur des noms (lisible quel que soit l'accent) ; l'accent seulement pour l'anneau mis en évidence.
    ctx.fillStyle = `rgba(${lit ? this.palette.starAccent : this.palette.label}, ${alpha})`;
    ctx.fillText(text, p.x + 1.5, p.y + 0.5); // +1.5 : compense l'espacement après la dernière lettre
    ctx.shadowBlur = 0;
    ctx.shadowColor = "transparent";
    ctx.letterSpacing = "0px";
    ctx.textAlign = "start";
  }

  /** Le dossier dont le nom est sous ce point de l'écran (dernière image dessinée), ou `null`. */
  folderAt(x: number, y: number): string | null {
    if (!this.folderLabels) return null;
    const hit = this.labelRects.find((r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h);
    return hit ? hit.folder : null;
  }

  /**
   * Poids d'un lien (multiplie son opacité) : plus discret entre étoiles peu connectées ;
   * avec un dossier choisi, ses liens ressortent et les autres s'effacent.
   */
  protected linkWeight(e: GraphEdge): number {
    const weak = 0.45 + 0.55 * Math.min(1, Math.min(e.source.degree, e.target.degree) / 6);
    const sel = this.frame.selectedFolder;
    if (sel === null) return weak;
    const touches = (!e.source.ghost && inFolder(e.source.folder, sel)) || (!e.target.ghost && inFolder(e.target.folder, sel));
    return touches ? 1.6 : weak * 0.35;
  }

  /**
   * Lignes et étoiles, dessinées du fond vers l'avant ("algorithme du peintre") :
   * ce qui est proche est peint en dernier, donc par-dessus ce qui est loin.
   */
  private drawScene(): void {
    const { screen, camera, time, highlighted: h } = this.frame;
    const neighbors = new Set<GraphNode>();
    if (h) {
      for (const e of this.graph.edges) {
        if (e.source === h) neighbors.add(e.target);
        if (e.target === h) neighbors.add(e.source);
      }
    }

    // Tout ce qu'il faut dessiner, avec sa profondeur.
    const items: { depth: number; draw: () => void }[] = [];
    for (const e of this.graph.edges) {
      const a = screen.get(e.source);
      const b = screen.get(e.target);
      if (!a?.visible || !b?.visible) continue;
      const lit = h !== null && (e.source === h || e.target === h);
      items.push({ depth: (a.depth + b.depth) / 2, draw: () => this.drawEdge(e, a, b, lit, h !== null) });
    }
    for (const [n, p] of screen) {
      if (!p.visible) continue;
      // Atténuée : hors des voisins de l'étoile survolée, ou hors du dossier choisi.
      const sel = this.frame.selectedFolder;
      const dim = (h !== null && n !== h && !neighbors.has(n)) || (sel !== null && (n.ghost || !inFolder(n.folder, sel)));
      items.push({ depth: p.depth, draw: () => this.drawNode(n, p, dim, time) });
    }
    // Le trou noir est trié comme le reste : ce qui est derrière lui est peint avant,
    // puis recouvert par son disque noir ; ce qui est devant est peint après.
    const center = camera.project(0, 0, 0);
    items.push({
      depth: center.depth,
      draw: () => (this.holeMask === null ? drawBlackHole(this.ctx, camera, time) : this.maskHole(center, this.holeMask)),
    });

    items.sort((a, b) => b.depth - a.depth); // du plus loin au plus proche
    for (const item of items) item.draw();
  }

  /**
   * Efface (rend transparent) un disque à l'emplacement de l'ombre du trou noir : tout ce qui a
   * déjà été peint, donc tout ce qui est PLUS LOIN que lui, disparaît derrière l'ombre dessinée
   * dessous ; ce qui est plus près sera peint ensuite, donc devant.
   */
  private maskHole(center: Projected, radius: number): void {
    if (!center.visible) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.globalCompositeOperation = "destination-out";
    ctx.beginPath();
    ctx.arc(center.x, center.y, radius * center.scale * 0.97, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /** Un lien entre deux étoiles (déjà projetées). Une scène dérivée peut le dessiner autrement. */
  protected drawEdge(e: GraphEdge, a: Projected, b: Projected, lit: boolean, anyHover: boolean): void {
    const ghost = e.target.ghost;
    const ctx = this.ctx;
    const palette = this.palette;
    const depthAlpha = this.fade((a.depth + b.depth) / 2);
    // Au survol : les liens de l'étoile s'éclairent en doré, les autres s'effacent.
    ctx.strokeStyle = lit
      ? `rgba(${palette.starAccent}, 0.85)`
      : `rgba(${palette.link}, ${Math.min(1, (anyHover ? 0.04 : 0.12) * depthAlpha * this.opts.links * this.linkWeight(e))})`;
    ctx.lineWidth = 1;
    ctx.setLineDash(ghost ? [3, 4] : []); // lien vers une note inexistante : pointillé
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  /** Une étoile. Une scène dérivée peut la dessiner autrement. */
  protected drawNode(n: GraphNode, p: Projected, dim: boolean, time: number): void {
    const ctx = this.ctx;
    const palette = this.palette;
    // Taille selon la profondeur (via `scale`), mais jamais plus petite qu'un point visible.
    const r = Math.max(n.radius * p.scale * this.opts.size, 1.2);
    const depthAlpha = this.fade(p.depth);

    if (n.ghost) {
      // Étoile fantôme : petit cercle pâle en pointillé, sans halo.
      ctx.strokeStyle = `rgba(${palette.star}, ${(dim ? 0.15 : 0.5) * depthAlpha})`;
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 2]);
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      return;
    }

    const alpha = depthAlpha * (dim ? 0.3 : 1);
    ctx.globalAlpha = alpha;

    // Halo : l'image pré-dessinée, étirée autour de l'étoile. Le réglage "Intensité du halo"
    // agrandit le halo (et le rend plus transparent en dessous de 1).
    const glow = this.opts.glow;
    if (glow > 0) {
      const glowSize = r * 7 * (0.5 + 0.5 * glow);
      ctx.globalAlpha = alpha * Math.min(1, glow);
      ctx.drawImage(n.gold ? this.glow.gold : this.glow.warm, p.x - glowSize / 2, p.y - glowSize / 2, glowSize, glowSize);
      ctx.globalAlpha = alpha;
    }

    // Halo doré bref si la note vient d'apparaître ou d'être modifiée (s'estompe en 1,5 s).
    const age = time - n.flashAt;
    if (n.flashAt > 0 && age < FLASH_MS) {
      const k = 1 - age / FLASH_MS;
      const flashSize = r * (8 + 14 * k);
      ctx.globalAlpha = k;
      ctx.drawImage(this.glow.gold, p.x - flashSize / 2, p.y - flashSize / 2, flashSize, flashSize);
      ctx.globalAlpha = alpha;
    }

    // Cœur de l'étoile.
    ctx.fillStyle = `rgb(${n.gold ? palette.starAccent : palette.star})`;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}

/** Dessine une fois, sur un petit canvas à part, un halo rond qui s'estompe vers l'extérieur. */
function makeGlow(rgb: string): HTMLCanvasElement {
  const size = 64;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, `rgba(${rgb}, 0.55)`);
  grad.addColorStop(0.25, `rgba(${rgb}, 0.18)`);
  grad.addColorStop(1, `rgba(${rgb}, 0)`);
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return c;
}

/** Vrai si un dossier est `sel` ou l'un de ses sous-dossiers ("" = la racine seule). */
function inFolder(folder: string, sel: string): boolean {
  return sel === "" ? folder === "" : folder === sel || folder.startsWith(sel + "/");
}
