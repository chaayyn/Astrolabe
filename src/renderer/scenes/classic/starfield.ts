// Fond : un ciel de nuit noir, avec un voile de poussière à peine visible et trois couches
// d'étoiles (lointaine, moyenne, proche) qui se décalent légèrement quand la caméra tourne.
//
// Performance : le noir, la poussière et la couche lointaine (des centaines de petites
// étoiles qui ne bougent presque pas) sont dessinés UNE fois dans une image hors écran,
// recopiée en un seul geste à chaque image. Les couches moyenne et proche, peu nombreuses,
// sont dessinées directement : c'est ce qui permet leur parallaxe et leur scintillement.
import { palette } from "../../palette";

/** Une étoile dessinée à chaque image (couches moyenne et proche, et étoiles qui scintillent). */
interface LiveStar {
  x: number; // position dans la couche, en pixels CSS
  y: number;
  r: number; // rayon
  rgb: string;
  base: number; // luminosité moyenne
  /** Vitesse du scintillement (0 = ne scintille pas). */
  speed: number;
  phase: number; // décalage, pour que les étoiles ne clignotent pas ensemble
  halo: boolean;
}

/** Une couche dessinée à chaque image. */
interface LiveLayer {
  stars: LiveStar[];
  /** Décalage (pixels) par radian de rotation de la caméra : plus grand = plus proche. */
  parallax: number;
}

/** Réglages des couches. `density` = une étoile pour N pixels² d'écran. */
const FAR = { density: 1100, rMin: 0.35, rMax: 0.7, aMin: 0.3, aMax: 0.65, twinkle: 0.05 };
const MID = { density: 6000, rMin: 0.6, rMax: 1.05, aMin: 0.55, aMax: 0.85, twinkle: 0.25, parallax: 16, halo: false };
const NEAR = { density: 35000, rMin: 0.9, rMax: 1.4, aMin: 0.8, aMax: 1, twinkle: 0.5, parallax: 34, halo: true };
/** La couche lointaine se balance d'au plus 10 px quand la caméra tourne. */
const FAR_SWAY = 10;

/** Teintes : surtout blanc, blanc chaud, très légèrement bleuté ; de rares étoiles dorées. */
function starColor(): string {
  const r = Math.random();
  if (r < 0.03) return "232, 200, 140"; // dorée (rare)
  if (r < 0.4) return "255, 241, 222"; // blanc chaud
  if (r < 0.7) return "218, 226, 255"; // légèrement bleuté
  return "255, 255, 255";
}

export class Starfield {
  private width = 0;
  private height = 0;
  private dpr = 1;
  /** Fond noir + poussière + couche lointaine, un peu plus grand que l'écran (marge FAR_SWAY). */
  private backdrop = document.createElement("canvas");
  /** Étoiles lointaines qui scintillent (dessinées par-dessus l'image, avec le même décalage). */
  private farTwinklers: LiveStar[] = [];
  private layers: LiveLayer[] = [];
  /** Petit halo pré-dessiné pour les étoiles proches. */
  private haloSprite = makeHaloSprite();
  /** Réglages : multiplicateur du nombre d'étoiles (1 = normal) et force du scintillement. */
  private density = 1;
  private twinkle = 1;

  /**
   * Change la densité du ciel (régénéré seulement si elle change) et la force du
   * scintillement (appliquée dès l'image suivante, sans rien régénérer).
   */
  setOptions(density: number, twinkle: number): void {
    this.twinkle = twinkle;
    if (density === this.density) return;
    this.density = density;
    if (this.width > 0) this.resize(this.width, this.height, this.dpr);
  }

  /** (Re)crée le ciel pour une nouvelle taille d'écran. Le nombre d'étoiles suit la surface. */
  resize(width: number, height: number, dpr: number): void {
    this.width = width;
    this.height = height;
    this.dpr = dpr;
    const { canvas, twinklers } = makeBackdrop(width, height, dpr, this.density);
    this.backdrop = canvas;
    this.farTwinklers = twinklers;
    this.layers = [MID, NEAR].map((cfg) => ({
      parallax: cfg.parallax,
      stars: Array.from({ length: Math.round(((width * height) / cfg.density) * this.density) }, () =>
        randomStar(width, height, cfg, cfg.halo),
      ),
    }));
  }

  /**
   * Dessine le ciel. `t` en secondes ; `yaw` et `pitch` = orientation de la caméra,
   * pour décaler les couches (parallaxe).
   */
  draw(ctx: CanvasRenderingContext2D, t: number, yaw: number, pitch: number): void {
    const w = this.width;
    const h = this.height;

    // 1. Image de fond (opaque : elle efface aussi l'image précédente). La couche lointaine
    //    se balance doucement de quelques pixels au lieu de défiler : elle bouge "très peu".
    //    Le décalage est arrondi aux pixels réels de l'écran et l'image est copiée à sa taille
    //    exacte : le navigateur peut alors la recopier telle quelle, sans recalculer les pixels
    //    (bien plus rapide).
    const dpr = this.dpr;
    const fx = Math.round((-FAR_SWAY + FAR_SWAY * Math.sin(yaw)) * dpr) / dpr;
    const fy = Math.round((-FAR_SWAY + FAR_SWAY * Math.sin(pitch)) * dpr) / dpr;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0); // coordonnées en pixels réels
    ctx.drawImage(this.backdrop, Math.round(fx * dpr), Math.round(fy * dpr));
    ctx.restore();
    for (const s of this.farTwinklers) this.drawStar(ctx, s, s.x + fx, s.y + fy, t);

    // 2. Couches moyenne et proche : elles défilent avec la rotation et bouclent sur l'écran.
    for (const layer of this.layers) {
      const ox = -yaw * layer.parallax;
      const oy = pitch * layer.parallax;
      for (const s of layer.stars) this.drawStar(ctx, s, mod(s.x + ox, w), mod(s.y + oy, h), t);
    }
    ctx.globalAlpha = 1;
  }

  private drawStar(ctx: CanvasRenderingContext2D, s: LiveStar, x: number, y: number, t: number): void {
    // Scintillement : la luminosité oscille lentement autour de sa valeur moyenne.
    // `twinkle` règle l'amplitude : 0 = étoiles fixes, 1 = normal (de 45 % à 100 % de leur éclat).
    const wave = 0.5 + 0.5 * Math.sin(t * s.speed + s.phase);
    const a = s.speed > 0 ? s.base * (1 - 0.55 * this.twinkle * (1 - wave)) : s.base;
    if (s.halo) {
      const hr = s.r * 5;
      ctx.globalAlpha = a * 0.9;
      ctx.drawImage(this.haloSprite, x - hr, y - hr, hr * 2, hr * 2);
    }
    ctx.globalAlpha = a;
    ctx.fillStyle = `rgb(${s.rgb})`;
    ctx.beginPath();
    ctx.arc(x, y, s.r, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Une étoile au hasard selon les réglages d'une couche. */
function randomStar(w: number, h: number, cfg: typeof FAR, halo: boolean): LiveStar {
  return {
    x: Math.random() * w,
    y: Math.random() * h,
    r: cfg.rMin + Math.random() * (cfg.rMax - cfg.rMin),
    rgb: starColor(),
    base: cfg.aMin + Math.random() * (cfg.aMax - cfg.aMin),
    speed: Math.random() < cfg.twinkle ? 0.3 + Math.random() * 0.9 : 0,
    phase: Math.random() * Math.PI * 2,
    halo,
  };
}

/**
 * Pré-dessine le fond : noir presque pur, quelques halos de poussière, un grain très fin,
 * puis la couche lointaine. Les étoiles lointaines qui scintillent sont mises de côté.
 */
function makeBackdrop(
  w: number,
  h: number,
  dpr: number,
  density: number,
): { canvas: HTMLCanvasElement; twinklers: LiveStar[] } {
  const W = w + 2 * FAR_SWAY;
  const H = h + 2 * FAR_SWAY;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(W * dpr));
  canvas.height = Math.max(1, Math.round(H * dpr));
  const ctx = canvas.getContext("2d")!;
  ctx.scale(dpr, dpr); // on dessine en pixels CSS, à la résolution réelle de l'écran

  ctx.fillStyle = `rgb(${palette.sky})`; // couleur du ciel, donnée par le thème
  ctx.fillRect(0, 0, W, H);

  // Voile de nébuleuse : 4 grands halos gris-bleu ou chauds, presque invisibles.
  const big = Math.max(W, H);
  for (let i = 0; i < 4; i++) {
    const x = Math.random() * W;
    const y = Math.random() * H;
    const r = big * (0.25 + Math.random() * 0.35);
    const rgb = i % 2 === 0 ? "110, 125, 165" : "165, 140, 110";
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(${rgb}, ${0.03 + Math.random() * 0.02})`);
    g.addColorStop(1, `rgba(${rgb}, 0)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  // Grain : de minuscules points à peine plus clairs que le fond.
  ctx.fillStyle = "#ffffff";
  for (let i = 0, n = Math.round((W * H) / 70); i < n; i++) {
    ctx.globalAlpha = 0.012 + Math.random() * 0.025;
    ctx.fillRect(Math.random() * W, Math.random() * H, 1 / dpr, 1 / dpr);
  }

  // Couche lointaine : beaucoup de toutes petites étoiles ternes.
  const twinklers: LiveStar[] = [];
  for (let i = 0, n = Math.round(((W * H) / FAR.density) * density); i < n; i++) {
    const s = randomStar(W, H, FAR, false);
    if (s.speed > 0) {
      twinklers.push(s);
      continue;
    }
    ctx.globalAlpha = s.base;
    ctx.fillStyle = `rgb(${s.rgb})`;
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  return { canvas, twinklers };
}

/** Petit halo rond, blanc chaud, qui s'estompe vers l'extérieur (dessiné une fois). */
function makeHaloSprite(): HTMLCanvasElement {
  const size = 32;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, "rgba(255, 244, 228, 0.25)");
  grad.addColorStop(1, "rgba(255, 244, 228, 0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return c;
}

/** Reste de division toujours positif (pour faire boucler les décalages). */
function mod(a: number, n: number): number {
  return ((a % n) + n) % n;
}
