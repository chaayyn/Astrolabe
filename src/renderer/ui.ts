// Petites aides d'affichage partagées par la barre latérale et ses tiroirs.

/** Crée un élément avec une classe et un texte (textContent : pas d'injection HTML). */
export function span(className: string, text: string, tag = "span"): HTMLElement {
  const s = document.createElement(tag);
  if (className) s.className = className;
  s.textContent = text;
  return s;
}

/** Change une valeur affichée avec un léger fondu, seulement si elle a changé. */
export function setValue(el: HTMLElement, text: string): void {
  if (el.textContent === text) return;
  el.textContent = text;
  el.classList.remove("fade");
  void el.offsetWidth; // relance l'animation
  el.classList.add("fade");
}

/** Une journée en millisecondes. */
export const DAY = 86_400_000;

/** Minuit du jour (heure locale) contenant `ms`. */
export function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Durée courte depuis une date : "now", "5m", "2h", "3d", "4mo". */
export function shortAge(ms: number): string {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 30 * 86400) return `${Math.floor(s / 86400)}d`;
  return `${Math.floor(s / (30 * 86400))}mo`;
}

/**
 * Nombre de notes par jour sur les `days` derniers jours (le plus ancien d'abord),
 * d'après la date donnée par `dateOf` (modification, création…).
 */
export function perDay<T>(items: T[], days: number, dateOf: (item: T) => number, weight: (item: T) => number = () => 1): number[] {
  const today = startOfDay(Date.now());
  const counts = new Array<number>(days).fill(0);
  for (const item of items) {
    const index = days - 1 - Math.floor((today - startOfDay(dateOf(item))) / DAY);
    if (index >= 0 && index < days) counts[index] += weight(item);
  }
  return counts;
}

// --- Courbe d'activité ------------------------------------------------------------------

const SVG_NS = "http://www.w3.org/2000/svg";

/** Crée un élément SVG avec ses attributs. */
export function svgEl(tag: string, attrs: Record<string, string>, children: SVGElement[] = []): SVGElement {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  el.append(...children);
  return el;
}

/**
 * Dessine dans `svg` (viewBox `w` × `h`) une courbe fine et lissée passant par les valeurs,
 * avec un point lumineux sur la dernière. `label` décrit la courbe aux lecteurs d'écran.
 */
export function drawSparkline(svg: SVGSVGElement, values: number[], w: number, h: number, label: string): void {
  const max = Math.max(1, ...values);
  const pts = values.map((v, i) => [(i / Math.max(1, values.length - 1)) * w, h - 4 - (v / max) * (h - 10)]);

  // Courbe lissée : entre deux points, une courbe de Bézier dont les "poignées" suivent
  // la direction donnée par les points voisins (méthode dite de Catmull-Rom).
  let line = `M ${pts[0][0]} ${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    line += ` C ${c1[0]} ${c1[1]}, ${c2[0]} ${c2[1]}, ${p2[0]} ${p2[1]}`;
  }
  const last = pts[pts.length - 1];
  svg.replaceChildren(
    svgEl("path", { d: line, class: "spark-line" }),
    svgEl("circle", { cx: String(last[0]), cy: String(last[1]), r: "2", class: "spark-dot" }),
  );
  svg.setAttribute("aria-label", `${label} : ${values.join(", ")}`);
}
