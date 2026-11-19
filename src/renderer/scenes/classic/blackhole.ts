// Le trou noir au centre du graphe : un disque noir, un anneau d'accrétion lumineux
// vu en perspective, un arc de lumière "déformée" au-dessus (effet de lentille, approximation
// visuelle), une brillance qui tourne le long de l'anneau et un halo qui pulse doucement.
// Tout est dessiné en Canvas 2D, à partir de la caméra 3D.
import type { Camera, Projected } from "../../camera";
import { palette } from "../../palette";

/** Rayon du disque noir (unités du monde). Les étoiles font 3 à 8. */
export const HOLE_RADIUS = 16;
/** Anneau d'accrétion : du bord intérieur au bord extérieur (unités du monde). */
const DISK_INNER = 22;
export const DISK_OUTER = 52;
const DISK_BANDS = 8; // l'anneau est dessiné comme 8 cercles concentriques collés
const DISK_SEGMENTS = 72; // chaque cercle est découpé en 72 petits segments
const SPIN = 0.5; // vitesse de rotation de la brillance (radians par seconde)

/** Couleurs du thème actif, en tableaux [r, g, b]. */
const rgbOf = (value: string) => value.split(",").map(Number);

/** Un petit morceau d'anneau, déjà projeté à l'écran. */
interface Segment {
  a: Projected;
  b: Projected;
  color: string;
  width: number;
}

/**
 * Dessine le trou noir centré sur l'origine du monde.
 * `time` en millisecondes. L'anneau est dans le plan horizontal (y = 0).
 */
export function drawBlackHole(ctx: CanvasRenderingContext2D, camera: Camera, time: number): void {
  const GOLD = rgbOf(palette.starAccent);
  const WARM = rgbOf(palette.star);
  const c = camera.project(0, 0, 0);
  if (!c.visible) return;
  const t = time / 1000;
  const s = c.scale; // pixels par unité du monde, à la profondeur du trou noir

  // L'anneau, découpé en segments. Ceux plus loin que le centre forment la moitié
  // "arrière" (cachée en partie par le disque noir), les autres la moitié "avant".
  const back: Segment[] = [];
  const front: Segment[] = [];
  const bandWidth = (DISK_OUTER - DISK_INNER) / DISK_BANDS;
  for (let band = 0; band < DISK_BANDS; band++) {
    const k = band / (DISK_BANDS - 1); // 0 = bord intérieur, 1 = bord extérieur
    const r = DISK_INNER + bandWidth * (band + 0.5);
    // Couleur : doré à l'intérieur, vers le blanc chaud à l'extérieur ; de plus en plus pâle.
    const rgb = GOLD.map((g, i) => Math.round(g + (WARM[i] - g) * k)).join(", ");
    const baseAlpha = 0.9 * (1 - k) ** 1.4 + 0.06;
    for (let i = 0; i < DISK_SEGMENTS; i++) {
      const a0 = (i / DISK_SEGMENTS) * Math.PI * 2;
      const a1 = ((i + 1) / DISK_SEGMENTS) * Math.PI * 2;
      const mid = (a0 + a1) / 2;
      // Brillance qui tourne : un grand reflet + des stries plus fines qui défilent.
      const glint = 0.5 + 0.5 * Math.cos(mid - t * SPIN);
      const streak = 0.5 + 0.5 * Math.sin(5 * mid - t * SPIN * 1.7 + band);
      const light = 0.35 + 0.5 * glint * glint + 0.15 * streak;
      const pa = camera.project(Math.cos(a0) * r, 0, Math.sin(a0) * r);
      const pb = camera.project(Math.cos(a1) * r, 0, Math.sin(a1) * r);
      if (!pa.visible || !pb.visible) continue;
      const seg = {
        a: pa,
        b: pb,
        color: `rgba(${rgb}, ${Math.min(1, baseAlpha * light * 1.35)})`,
        width: Math.max(bandWidth * s * 1.05, 0.8), // un peu plus large : les bandes se touchent
      };
      ((pa.depth + pb.depth) / 2 > c.depth ? back : front).push(seg);
    }
  }

  const holeR = HOLE_RADIUS * s;

  // 1. Halo doré qui pulse très légèrement.
  ctx.globalCompositeOperation = "lighter"; // les lumières s'additionnent : effet lumineux
  const pulse = 0.16 + 0.04 * Math.sin(t * 1.3);
  const haloR = DISK_OUTER * 2.2 * s;
  const halo = ctx.createRadialGradient(c.x, c.y, holeR, c.x, c.y, haloR);
  halo.addColorStop(0, `rgba(${GOLD.join(", ")}, ${pulse})`);
  halo.addColorStop(0.4, `rgba(${GOLD.join(", ")}, ${pulse * 0.35})`);
  halo.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = halo;
  ctx.fillRect(c.x - haloR, c.y - haloR, haloR * 2, haloR * 2);

  // 2. Moitié arrière de l'anneau (dessinée normalement, sans addition de lumière :
  //    les segments qui se chevauchent ne créent pas de "perles" plus claires).
  ctx.globalCompositeOperation = "source-over";
  drawSegments(ctx, back);

  // 3. Lentille : la lumière de l'arrière de l'anneau, "pliée" par la gravité, entoure
  //    le disque noir d'un anneau lumineux, plus brillant en haut qu'en bas.
  ctx.globalCompositeOperation = "lighter";
  drawLensRing(ctx, c, HOLE_RADIUS * 1.38 * s, HOLE_RADIUS * 0.45 * s);

  // 4. Le disque noir lui-même : il cache tout ce qui a été dessiné derrière lui.
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = "#000";
  ctx.beginPath();
  ctx.arc(c.x, c.y, holeR, 0, Math.PI * 2);
  ctx.fill();

  // 5. Très fin liseré doré collé au bord du disque noir ("anneau de photons").
  ctx.strokeStyle = `rgba(${GOLD.join(", ")}, 0.45)`;
  ctx.lineWidth = Math.max(0.8, 0.06 * HOLE_RADIUS * s);
  ctx.beginPath();
  ctx.arc(c.x, c.y, holeR * 1.03, 0, Math.PI * 2);
  ctx.stroke();

  // 6. Moitié avant de l'anneau : elle passe devant le disque noir.
  drawSegments(ctx, front);
}

/** Dessine des morceaux d'anneau. */
function drawSegments(ctx: CanvasRenderingContext2D, segments: Segment[]): void {
  for (const seg of segments) {
    ctx.strokeStyle = seg.color;
    ctx.lineWidth = seg.width;
    ctx.beginPath();
    ctx.moveTo(seg.a.x, seg.a.y);
    ctx.lineTo(seg.b.x, seg.b.y);
    ctx.stroke();
  }
}

/**
 * Anneau de lentille autour du disque noir, à l'écran : un cercle épais dont la lumière
 * vient du haut (l'arrière de l'anneau, vu "par-dessus" le trou noir) et faiblit vers le bas.
 */
function drawLensRing(ctx: CanvasRenderingContext2D, c: Projected, radius: number, width: number): void {
  const GOLD = rgbOf(palette.starAccent);
  const WARM = rgbOf(palette.star);
  const grad = ctx.createLinearGradient(c.x, c.y - radius, c.x, c.y + radius);
  grad.addColorStop(0, `rgba(${WARM.join(", ")}, 0.75)`);
  grad.addColorStop(0.35, `rgba(${GOLD.join(", ")}, 0.55)`);
  grad.addColorStop(0.65, `rgba(${GOLD.join(", ")}, 0.25)`);
  grad.addColorStop(1, `rgba(${GOLD.join(", ")}, 0.35)`);
  ctx.strokeStyle = grad;
  ctx.lineWidth = Math.max(width, 1);
  ctx.beginPath();
  ctx.arc(c.x, c.y, radius, 0, Math.PI * 2);
  ctx.stroke();
}
