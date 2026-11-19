// Le graphe en 3D : les notes deviennent des nœuds (étoiles), les liens des arêtes (lignes),
// les dossiers des orbites (anneaux inclinés autour du trou noir, au centre du coffre).
// Une petite simulation de forces place chaque étoile sur l'anneau de son dossier.
import type { Note } from "../shared/note";

/** Un vecteur 3D [x, y, z]. L'axe y est "vers le haut". */
export type Vec3 = [number, number, number];

/** Une étoile du graphe. */
export interface GraphNode {
  /** Identifiant stable : chemin de la note, ou "ghost:<cible>" pour une note inexistante. */
  id: string;
  /** Texte affiché au survol. */
  label: string;
  /** `true` si la note n'existe pas (cible d'un lien vers une note pas encore écrite). */
  ghost: boolean;
  /** Dossier de la note ("" = racine du coffre). Sans objet pour un fantôme. */
  folder: string;
  /** Position et vitesse dans l'espace 3D du "monde". */
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Nombre de liens touchant ce nœud (entrants + sortants). */
  degree: number;
  /** Rayon de l'étoile (unités du monde), calculé depuis `degree`. */
  radius: number;
  /** `true` pour les notes les plus connectées : dessinées en doré. */
  gold: boolean;
  /** Moment (ms, `performance.now()`) où l'étoile a été ajoutée/modifiée, pour le halo bref. */
  flashAt: number;
  /** Nombre de sections (titres ## et ###) de la note ; 0 pour un fantôme. */
  sections: number;
}

/** Une ligne entre deux étoiles. */
export interface GraphEdge {
  source: GraphNode;
  target: GraphNode;
}

/** Un anneau : l'orbite d'un dossier, un cercle incliné centré sur le trou noir. */
export interface Orbit {
  /** Chemin relatif complet du dossier : "Projets", "Projets/Archives". */
  folder: string;
  /** Rang de l'orbite (0 = la plus proche du centre). */
  index: number;
  /** Rayon visé, utilisé par la simulation. */
  radius: number;
  /** Rayon dessiné : rejoint `radius` en douceur quand les orbites se réorganisent. */
  shownRadius: number;
  /** Opacité dessinée : monte à l'apparition, descend à la disparition. */
  opacity: number;
  /** `false` quand le dossier n'a plus de note : l'anneau s'efface puis est retiré. */
  alive: boolean;
  /**
   * Plan de l'anneau : `u` et `v` sont deux directions perpendiculaires dans ce plan,
   * `normal` est perpendiculaire au plan. Un point de l'anneau = R·(cos θ·u + sin θ·v).
   */
  u: Vec3;
  v: Vec3;
  normal: Vec3;
}

// Réglages de la simulation. Les forces sont multipliées par `alpha`, la "température" :
// elle part de 1, baisse à chaque pas, et la simulation s'arrête quand elle est froide.
const REPULSION = 6000; // les étoiles se repoussent : elles s'étalent le long de leur anneau
const RADIAL_STRENGTH = 0.3; // ramène l'étoile au bon rayon, dans le plan de son anneau
const PLANE_STRENGTH = 0.05; // ramène l'étoile vers le plan de l'anneau (faible : léger écart en hauteur)
const LINK_LENGTH = 130; // longueur de repos d'un lien entre deux notes
const LINK_STRENGTH = 0.004; // faible : les liens rapprochent les étoiles sans casser l'orbite
const GHOST_LINK_LENGTH = 45; // un fantôme reste tout près de la note qui le cite
const GHOST_LINK_STRENGTH = 0.08;
const FRICTION = 0.6; // fraction de la vitesse conservée à chaque pas
const COOLING = 0.985; // alpha est multiplié par ce nombre à chaque pas
const ALPHA_MIN = 0.004; // en dessous, on considère la disposition stable
const GOLD_SHARE = 0.2; // les 20 % de notes les plus connectées sont dorées

const FIRST_ORBIT = 170; // rayon de la première orbite
const ORBIT_GAP = 130; // écart entre deux orbites successives
const ORBIT_EASING = 0.08; // vitesse des transitions d'anneaux (fraction parcourue par image)
const MAX_TILT = 0.4; // inclinaison maximale d'un anneau (radians, ~23°)
/** Distance au centre des notes de la racine : juste au-delà de l'anneau du trou noir. */
const ROOT_SHELL = 80; // juste au-delà du trou noir de la scène classique (anneau de rayon 52)

export class Graph {
  nodes: GraphNode[] = [];
  edges: GraphEdge[] = [];
  /** Orbites, dans l'ordre du centre vers l'extérieur (plus celles en train de s'effacer). */
  orbits: Orbit[] = [];
  /** Température de la simulation (0 = arrêtée). */
  alpha = 0;
  /** Orbite vivante de chaque dossier. */
  private orbitOf = new Map<string, Orbit>();

  /** Rayon de l'orbite la plus éloignée (0 s'il n'y en a pas). */
  get outerRadius(): number {
    return Math.max(0, ...[...this.orbitOf.values()].map((o) => o.radius));
  }

  /**
   * Reconstruit le graphe à partir des notes, en gardant la position des étoiles existantes.
   * `changed` : chemins des notes nouvelles ou modifiées, qui auront un halo bref.
   */
  update(notes: Note[], changed: Set<string>): void {
    const now = performance.now();
    const old = new Map(this.nodes.map((n) => [n.id, n]));
    const firstLoad = this.nodes.length === 0;

    this.updateOrbits(notes);

    // 1. Un nœud par note (on réutilise l'ancien objet s'il existe : sa position est conservée).
    const nodes = new Map<string, GraphNode>();
    for (const note of notes) {
      const node = old.get(note.path) ?? newNode(note.path, note.title, false);
      node.label = note.title;
      node.folder = note.folder;
      node.sections = note.sections;
      if (changed.has(note.path)) node.flashAt = now;
      nodes.set(node.id, node);
    }

    // 2. Une arête par lien sortant. Un lien qui ne mène à aucune note crée une étoile fantôme.
    const resolve = makeResolver(notes);
    const edges: GraphEdge[] = [];
    for (const note of notes) {
      const source = nodes.get(note.path)!;
      for (const link of note.links) {
        const targetPath = resolve(link);
        let target: GraphNode;
        if (targetPath) {
          target = nodes.get(targetPath)!;
        } else {
          const ghostId = `ghost:${link.toLowerCase()}`;
          target = nodes.get(ghostId) ?? old.get(ghostId) ?? newNode(ghostId, link, true);
          nodes.set(ghostId, target);
        }
        if (target !== source) edges.push({ source, target });
      }
    }

    // 3. Placer les nouvelles étoiles.
    const ghostByName = new Map([...old.values()].filter((n) => n.ghost).map((n) => [n.label.toLowerCase(), n]));
    for (const node of nodes.values()) {
      if (old.has(node.id)) continue;
      // Une note qui vient d'être créée part de la place de son étoile fantôme, si elle en avait une.
      const ghost = ghostByName.get(nodeName(node).toLowerCase());
      if (!node.ghost && ghost && !nodes.has(ghost.id)) {
        node.x = ghost.x;
        node.y = ghost.y;
        node.z = ghost.z;
      } else {
        this.place(node, edges, old);
      }
    }

    this.nodes = [...nodes.values()];
    this.edges = edges;
    computeSizes(this.nodes, this.edges);

    // Relancer la simulation : à fond au premier chargement, doucement ensuite
    // pour que la vue existante ne soit pas chamboulée.
    this.alpha = firstLoad ? 1 : Math.max(this.alpha, 0.3);
  }

  /**
   * Une orbite par dossier contenant au moins une note directe (la racine n'en a pas).
   * Ordre alphabétique du chemin : il ne bouge pas quand on ajoute une note,
   * et un sous-dossier ("Projets/Archives") suit toujours son parent ("Projets").
   */
  private updateOrbits(notes: Note[]): void {
    const folders = [...new Set(notes.map((n) => n.folder).filter((f) => f !== ""))].sort((a, b) =>
      a.localeCompare(b),
    );
    const existing = new Map(this.orbits.map((o) => [o.folder, o]));
    this.orbitOf.clear();

    folders.forEach((folder, index) => {
      const radius = FIRST_ORBIT + index * ORBIT_GAP;
      let orbit = existing.get(folder);
      if (orbit) {
        // Orbite déjà là : seul son rayon visé change ; le dessin la fera glisser en douceur.
        Object.assign(orbit, { index, radius, alive: true });
      } else {
        orbit = { folder, index, radius, shownRadius: radius, opacity: 0, alive: true, ...orbitPlane(folder) };
        this.orbits.push(orbit);
      }
      this.orbitOf.set(folder, orbit);
    });

    // Les dossiers disparus restent un instant, le temps que leur anneau s'efface.
    for (const orbit of this.orbits) if (this.orbitOf.get(orbit.folder) !== orbit) orbit.alive = false;
  }

  /**
   * Fait avancer les transitions d'anneaux (rayon, apparition, disparition) d'une image.
   * Renvoie `true` tant qu'une transition est en cours.
   */
  animateOrbits(): boolean {
    let moving = false;
    for (const o of this.orbits) {
      const targetOpacity = o.alive ? 1 : 0;
      o.shownRadius += (o.radius - o.shownRadius) * ORBIT_EASING;
      o.opacity += (targetOpacity - o.opacity) * ORBIT_EASING;
      if (Math.abs(o.radius - o.shownRadius) > 0.1 || Math.abs(targetOpacity - o.opacity) > 0.01) moving = true;
    }
    this.orbits = this.orbits.filter((o) => o.alive || o.opacity > 0.01);
    return moving;
  }

  /** Orbite d'une note (ou `null` : racine du coffre, ou fantôme). */
  orbitFor(node: GraphNode): Orbit | null {
    return node.ghost ? null : (this.orbitOf.get(node.folder) ?? null);
  }

  /** Place une nouvelle étoile : sur son anneau, du côté de ses voisins si possible. */
  private place(node: GraphNode, edges: GraphEdge[], placed: Map<string, GraphNode>): void {
    const neighbors = edges
      .flatMap((e) => (e.source === node ? [e.target] : e.target === node ? [e.source] : []))
      .filter((n) => placed.has(n.id));
    const jitter = () => (Math.random() - 0.5) * 30;

    // Fantôme : à côté de la note qui le cite.
    if (node.ghost) {
      const src = neighbors[0];
      node.x = (src?.x ?? 0) + jitter();
      node.y = (src?.y ?? 0) + jitter();
      node.z = (src?.z ?? 0) + jitter();
      return;
    }

    const orbit = this.orbitFor(node);
    if (!orbit) {
      // Racine : juste autour du trou noir, dans une direction au hasard (plutôt à plat).
      const angle = Math.random() * Math.PI * 2;
      node.x = Math.cos(angle) * ROOT_SHELL;
      node.y = jitter();
      node.z = Math.sin(angle) * ROOT_SHELL;
      return;
    }

    // Angle sur l'anneau : direction moyenne des voisins déjà placés, sinon au hasard.
    let angle = Math.random() * Math.PI * 2;
    if (neighbors.length > 0) {
      const m: Vec3 = [0, 0, 0];
      for (const n of neighbors) {
        m[0] += n.x;
        m[1] += n.y;
        m[2] += n.z;
      }
      const cu = dot(m, orbit.u);
      const cv = dot(m, orbit.v);
      if (cu !== 0 || cv !== 0) angle = Math.atan2(cv, cu);
    }
    const r = orbit.radius;
    node.x = r * (Math.cos(angle) * orbit.u[0] + Math.sin(angle) * orbit.v[0]) + jitter();
    node.y = r * (Math.cos(angle) * orbit.u[1] + Math.sin(angle) * orbit.v[1]) + jitter() * 0.3;
    node.z = r * (Math.cos(angle) * orbit.u[2] + Math.sin(angle) * orbit.v[2]) + jitter();
  }

  /** Un pas de simulation. Renvoie `false` quand la disposition est stable (rien à calculer). */
  tick(): boolean {
    if (this.alpha < ALPHA_MIN) return false;
    const a = this.alpha;
    const nodes = this.nodes;

    // Répulsion entre toutes les paires d'étoiles (force en 1/distance²).
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const n1 = nodes[i];
        const n2 = nodes[j];
        let dx = n2.x - n1.x;
        let dy = n2.y - n1.y;
        let dz = n2.z - n1.z;
        if (dx === 0 && dy === 0 && dz === 0) {
          dx = Math.random() - 0.5; // deux étoiles superposées : on les décale un peu
          dy = Math.random() - 0.5;
          dz = Math.random() - 0.5;
        }
        const d2 = Math.max(dx * dx + dy * dy + dz * dz, 25);
        const d = Math.sqrt(d2);
        const push = (REPULSION * a) / d2 / d; // divisé par d : (dx, dy, dz) devient une direction
        n1.vx -= dx * push;
        n1.vy -= dy * push;
        n1.vz -= dz * push;
        n2.vx += dx * push;
        n2.vy += dy * push;
        n2.vz += dz * push;
      }
    }

    // Attraction le long des liens : un ressort qui ramène vers sa longueur de repos.
    for (const { source, target } of this.edges) {
      const ghost = target.ghost; // un fantôme est toujours la cible d'un lien
      const length = ghost ? GHOST_LINK_LENGTH : LINK_LENGTH;
      const strength = ghost ? GHOST_LINK_STRENGTH : LINK_STRENGTH;
      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const dz = target.z - source.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
      const pull = ((d - length) * strength * a) / d;
      // Lien vers un fantôme : seul le fantôme bouge, pour ne pas tirer la note hors de son orbite.
      if (!ghost) {
        source.vx += dx * pull;
        source.vy += dy * pull;
        source.vz += dz * pull;
      }
      target.vx -= dx * pull;
      target.vy -= dy * pull;
      target.vz -= dz * pull;
    }

    for (const n of nodes) {
      if (!n.ghost) this.pullToOrbit(n, a);
      // Frottement, puis déplacement.
      n.vx *= FRICTION;
      n.vy *= FRICTION;
      n.vz *= FRICTION;
      n.x += n.vx;
      n.y += n.vy;
      n.z += n.vz;
    }

    this.alpha *= COOLING;
    return true;
  }

  /**
   * Rappel vers l'anneau. On découpe la position en deux morceaux :
   * - la hauteur au-dessus du plan de l'anneau → tirée doucement vers 0 ;
   * - la partie dans le plan → poussée ou tirée jusqu'au rayon de l'orbite.
   * Les notes de la racine sont tirées vers une coquille juste autour du trou noir.
   */
  private pullToOrbit(n: GraphNode, a: number): void {
    const orbit = this.orbitFor(n);
    if (!orbit) {
      // Racine : sur une "coquille" juste autour du trou noir (sans le recouvrir).
      const d = Math.hypot(n.x, n.y, n.z);
      if (d > 0.01) {
        const k = ((ROOT_SHELL - d) / d) * RADIAL_STRENGTH * a;
        n.vx += n.x * k;
        n.vy += n.y * k;
        n.vz += n.z * k;
      }
      return;
    }
    const p: Vec3 = [n.x, n.y, n.z];
    const h = dot(p, orbit.normal); // hauteur au-dessus du plan
    const inPlane: Vec3 = [p[0] - h * orbit.normal[0], p[1] - h * orbit.normal[1], p[2] - h * orbit.normal[2]];
    const d = Math.hypot(...inPlane);
    if (d > 0.01) {
      const k = ((orbit.radius - d) / d) * RADIAL_STRENGTH * a;
      n.vx += inPlane[0] * k;
      n.vy += inPlane[1] * k;
      n.vz += inPlane[2] * k;
    }
    n.vx -= h * orbit.normal[0] * PLANE_STRENGTH * a;
    n.vy -= h * orbit.normal[1] * PLANE_STRENGTH * a;
    n.vz -= h * orbit.normal[2] * PLANE_STRENGTH * a;
  }
}

/**
 * Plan d'un anneau, déduit du nom du dossier (toujours le même pour un même dossier).
 * On part du plan horizontal (x, z), on l'incline d'un petit angle autour de l'axe x,
 * puis on le tourne autour de l'axe vertical : chaque orbite a sa propre inclinaison.
 */
function orbitPlane(folder: string): { u: Vec3; v: Vec3; normal: Vec3 } {
  const h1 = hash(folder);
  const h2 = hash(folder + "#");
  const tilt = (h1 * 2 - 1) * MAX_TILT; // entre -MAX_TILT et +MAX_TILT
  const phase = h2 * Math.PI * 2;
  const turn = (p: Vec3): Vec3 => rotateY(rotateX(p, tilt), phase);
  return { u: turn([1, 0, 0]), v: turn([0, 0, 1]), normal: turn([0, 1, 0]) };
}

function rotateX([x, y, z]: Vec3, a: number): Vec3 {
  return [x, y * Math.cos(a) - z * Math.sin(a), y * Math.sin(a) + z * Math.cos(a)];
}

function rotateY([x, y, z]: Vec3, a: number): Vec3 {
  return [x * Math.cos(a) + z * Math.sin(a), y, -x * Math.sin(a) + z * Math.cos(a)];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/** Transforme un texte en un nombre entre 0 et 1, toujours le même pour le même texte. */
function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

/** Crée une étoile sans position (elle sera placée juste après). */
function newNode(id: string, label: string, ghost: boolean): GraphNode {
  return {
    id,
    label,
    ghost,
    folder: "",
    x: 0,
    y: 0,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    degree: 0,
    radius: 3,
    gold: false,
    flashAt: 0,
    sections: 0,
  };
}

/** Nom "court" d'un nœud, tel qu'écrit dans un lien : nom de fichier, ou cible du fantôme. */
function nodeName(node: GraphNode): string {
  return node.ghost ? node.label : (node.id.split("/").pop() ?? node.id).replace(/\.md$/i, "");
}

/**
 * Fabrique une fonction qui trouve la note visée par un lien, comme Obsidian :
 * [[Architecture]] → la note nommée "Architecture" ; [[Projets/Architecture]] → par chemin.
 * Insensible à la casse. Renvoie le chemin de la note, ou `null` si elle n'existe pas.
 */
function makeResolver(notes: Note[]): (link: string) => string | null {
  const byName = new Map<string, string>();
  const byPath = new Map<string, string>();
  for (const note of notes) {
    if (!byName.has(note.name.toLowerCase())) byName.set(note.name.toLowerCase(), note.path);
    byPath.set(note.path.replace(/\.md$/i, "").toLowerCase(), note.path);
  }
  return (link) => {
    const key = link.replace(/\.md$/i, "").toLowerCase();
    return byPath.get(key) ?? byName.get(key) ?? null;
  };
}

/** Calcule degré, rayon et couleur (dorée ou non) de chaque étoile. */
function computeSizes(nodes: GraphNode[], edges: GraphEdge[]): void {
  for (const n of nodes) n.degree = 0;
  for (const e of edges) {
    e.source.degree++;
    e.target.degree++;
  }
  for (const n of nodes) n.radius = n.ghost ? 3 : 3 + Math.sqrt(n.degree) * 1.6;

  // Les notes les plus connectées (au moins une) sont dorées.
  const real = nodes.filter((n) => !n.ghost && n.degree > 0).sort((a, b) => b.degree - a.degree);
  const goldCount = Math.ceil(real.length * GOLD_SHARE);
  const threshold = goldCount > 0 ? real[goldCount - 1].degree : Infinity;
  for (const n of nodes) n.gold = !n.ghost && n.degree > 0 && n.degree >= threshold;
}
