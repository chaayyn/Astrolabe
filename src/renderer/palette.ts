// Couleurs du graphe, lues dans les variables CSS du thème actif (--sc-star, --sc-link…).
// Le canvas ne connaît pas le CSS : on lit les valeurs une fois, ici, et on les relit
// quand le thème change. Les couleurs sont gardées au format "r, g, b" pour que le
// dessin puisse y ajouter sa propre transparence : `rgba(${palette.star}, 0.5)`.

export interface Palette {
  sky: string; // fond du ciel
  star: string; // étoiles des notes, halos
  starAccent: string; // étoiles les plus connectées, survol, trou noir
  link: string; // lignes entre les notes
  orbit: string; // anneaux des dossiers
  label: string; // noms des notes sur le graphe
  nebula: string; // nuage de la nébuleuse (ciel de la scène "galaxie")
  nebulaGlow: string; // reflets froids de la nébuleuse, teinte des étoiles lointaines
  font: string; // police des noms (pile de polices du thème)
}

/** Valeurs actuelles (celles du thème "galaxie" tant que rien n'a été lu). */
export const palette: Palette = {
  sky: "1, 2, 5",
  star: "240, 233, 218",
  starAccent: "212, 175, 106",
  link: "240, 233, 218",
  orbit: "240, 233, 218",
  label: "240, 233, 218",
  nebula: "148, 125, 255",
  nebulaGlow: "43, 107, 255",
  font: '"Adwaita Sans", system-ui, sans-serif',
};

/** Relit toutes les couleurs dans les variables CSS de la page. */
export function readPalette(): void {
  const css = getComputedStyle(document.documentElement);
  const color = (name: string, fallback: string) => toRgb(css.getPropertyValue(name).trim()) ?? fallback;
  palette.sky = color("--sc-sky", palette.sky);
  palette.star = color("--sc-star", palette.star);
  palette.starAccent = color("--sc-star-accent", palette.starAccent);
  palette.link = color("--sc-link", palette.link);
  palette.orbit = color("--sc-orbit", palette.orbit);
  palette.label = color("--sc-label", palette.label);
  palette.nebula = color("--sc-nebula", palette.nebula);
  palette.nebulaGlow = color("--sc-nebula-glow", palette.nebulaGlow);
  palette.font = css.getPropertyValue("--sc-font-display").trim() || palette.font;
}

/** Convertit une couleur CSS ("#d4af6a", "rgb(…)", "gold"…) en "r, g, b", ou `null` si invalide. */
const probe = document.createElement("canvas").getContext("2d")!;
function toRgb(value: string): string | null {
  if (!value) return null;
  // Astuce : le canvas comprend toutes les couleurs CSS et les réécrit sous une forme simple.
  probe.fillStyle = "#010203";
  probe.fillStyle = value;
  const out = probe.fillStyle;
  if (out === "#010203" && value.toLowerCase() !== "#010203") return null; // couleur refusée
  if (out.startsWith("#")) {
    const n = parseInt(out.slice(1), 16);
    return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
  }
  const m = /rgba?\(([^)]+)\)/.exec(out);
  return m ? m[1].split(",").slice(0, 3).map((x) => x.trim()).join(", ") : null;
}
