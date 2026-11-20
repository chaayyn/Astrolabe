// Le graphe en 3D : les notes deviennent des nœuds (étoiles), les liens des arêtes (lignes),
// les dossiers des orbites : des anneaux concentriques autour du trou noir, tous dans un même
// disque presque à plat (légèrement incliné).
//
// Placement DÉTERMINISTE (pas de simulation) : chaque note est posée sur l'anneau de son
// dossier, à un angle qui ne change plus ensuite ; une note ajoutée prend le plus grand
// intervalle libre de son anneau ; un anneau s'agrandit s'il le faut pour qu'aucune étoile
// n'en recouvre une autre. Les changements (ajout, suppression, déplacement, réglages) sont
// animés en douceur (≈ 600 ms) : seule la note concernée bouge.
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
  /** Position affichée dans l'espace 3D du "monde" (elle rejoint sa place en douceur). */
  x: number;
  y: number;
  z: number;
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
  /** Rayon visé de l'anneau. */
  radius: number;
  /** Rayon dessiné : rejoint `radius` en douceur quand les orbites se réorganisent. */
  shownRadius: number;
  /** Opacité dessinée : monte à l'apparition, descend à la disparition. */
  opacity: number;
  /** `false` quand le dossier n'a plus de note : l'anneau s'efface puis est retiré. */
  alive: boolean;
  /**
   * Plan de l'anneau (le même pour tous : le disque) : `u` et `v` sont deux directions
   * perpendiculaires dans ce plan, `normal` est perpendiculaire au plan.
   * Un point de l'anneau = R·(cos θ·u + sin θ·v).
   */
  u: Vec3;
  v: Vec3;
  normal: Vec3;
  /** Angle (radians) où s'écrit le nom du dossier : décalé d'un anneau à l'autre. */
  labelAngle: number;
}

// Disposition. Distances en unités du monde (le trou noir : ombre de 32, disque jusqu'à ~160).
const FIRST_RING = 215; // rayon du premier anneau : nettement au-delà du disque d'accrétion (~160)
const RING_GAP = 56; // écart entre deux anneaux (× réglage "Espacement des orbites")
const STAR_SPACING = 26; // écart minimal entre deux étoiles d'un anneau (le long de l'anneau)
const DEPTH_JITTER = 8; // petit décalage en hauteur par note, pour la profondeur
const EASING = 0.1; // fraction du chemin parcourue par image (≈ 600 ms pour arriver)
const ORBIT_EASING = 0.08; // même chose pour le rayon et l'apparition des anneaux
const GOLDEN_ANGLE = 2.39996; // les noms des dossiers tournent de ~137° d'un anneau au suivant
const GOLD_SHARE = 0.2; // les 20 % de notes les plus connectées sont dorées

export class Graph {
  nodes: GraphNode[] = [];
  edges: GraphEdge[] = [];
  /** Orbites, dans l'ordre du centre vers l'extérieur (plus celles en train de s'effacer). */
  orbits: Orbit[] = [];
  /** Orbite vivante de chaque dossier ("" = racine du coffre, si elle a des notes). */
  private orbitOf = new Map<string, Orbit>();
  /** Angle de chaque note sur son anneau, et le dossier pour lequel il a été choisi. */
  private angleOf = new Map<string, { angle: number; folder: string }>();
  /** Réglages : espacement des anneaux (×) et inclinaison du disque (degrés). */
  private spacing = 1;
  private tilt = 10;
  /** Mouvement réduit : les changements de place sont immédiats. */
  instant = false;
  /** Plan commun du disque. */
  private plane = diskPlane(10);

  /** Rayon de l'anneau le plus éloigné (0 s'il n'y en a pas). */
  get outerRadius(): number {
    return Math.max(0, ...[...this.orbitOf.values()].map((o) => o.radius));
  }

  /** Rayon de la bande des étoiles fantômes, au-delà du dernier anneau. */
  private get ghostRadius(): number {
    const shown = Math.max(FIRST_RING * 0.6, ...this.orbits.filter((o) => o.alive).map((o) => o.shownRadius));
    return shown + RING_GAP * this.spacing * 1.15;
  }

  /** Nouveaux réglages de disposition : les anneaux et les étoiles glissent vers leur nouvelle place. */
  setLayout(spacing: number, tiltDegrees: number): void {
    if (spacing === this.spacing && tiltDegrees === this.tilt) return;
    this.spacing = spacing;
    this.tilt = tiltDegrees;
    this.plane = diskPlane(tiltDegrees);
    for (const o of this.orbits) Object.assign(o, this.plane);
    this.sizeOrbits();
  }

  /**
   * Reconstruit le graphe à partir des notes, en gardant la place des étoiles existantes.
   * `changed` : chemins des notes nouvelles ou modifiées (elles brillent un instant).
   */
  update(notes: Note[], changed: Set<string>): void {
    const now = performance.now();
    const old = new Map(this.nodes.map((n) => [n.id, n]));
    const firstLoad = this.nodes.length === 0;

    // 1. Un nœud par note (on réutilise l'ancien objet s'il existe : sa place est conservée).
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

    this.nodes = [...nodes.values()];
    this.edges = edges;
    computeSizes(this.nodes, this.edges);

    // 3. Anneaux (un par dossier) et angle de chaque note sur le sien.
    this.updateOrbits();
    this.assignAngles();
    for (const id of [...this.angleOf.keys()]) if (!nodes.has(id)) this.angleOf.delete(id);

    // 4. Point de départ des nouvelles étoiles : directement à leur place au premier
    //    chargement ; sinon à la place de leur étoile fantôme (une note qui vient d'être
    //    écrite), ou déjà à leur place, d'où elles apparaissent.
    const ghostByName = new Map([...old.values()].filter((n) => n.ghost).map((n) => [n.label.toLowerCase(), n]));
    for (const node of this.nodes) {
      if (old.has(node.id) && !firstLoad) continue;
      const ghost = ghostByName.get(nodeName(node).toLowerCase());
      const from = !firstLoad && !node.ghost && ghost && !nodes.has(ghost.id) ? ghost : null;
      const [x, y, z] = from ? [from.x, from.y, from.z] : this.target(node, true);
      node.x = x;
      node.y = y;
      node.z = z;
    }
  }

  /**
   * Un anneau par dossier contenant au moins une note directe ; la racine du coffre (notes
   * hors dossier) a le premier, le plus proche du trou noir. Ordre alphabétique ensuite :
   * il ne bouge pas quand on ajoute une note, et "Projets/Archives" suit toujours "Projets".
   */
  private updateOrbits(): void {
    const real = this.nodes.filter((n) => !n.ghost);
    const folders = [...new Set(real.map((n) => n.folder))].sort((a, b) =>
      a === "" ? -1 : b === "" ? 1 : a.localeCompare(b),
    );
    const existing = new Map(this.orbits.map((o) => [o.folder, o]));
    this.orbitOf.clear();
    folders.forEach((folder, index) => {
      let orbit = existing.get(folder);
      if (orbit) {
        Object.assign(orbit, { index, alive: true, labelAngle: 0.6 + index * GOLDEN_ANGLE });
      } else {
        orbit = { folder, index, radius: 0, shownRadius: 0, opacity: 0, alive: true, labelAngle: 0.6 + index * GOLDEN_ANGLE, ...this.plane };
        this.orbits.push(orbit);
      }
      this.orbitOf.set(folder, orbit);
    });
    // Les dossiers disparus restent un instant, le temps que leur anneau s'efface.
    for (const orbit of this.orbits) if (this.orbitOf.get(orbit.folder) !== orbit) orbit.alive = false;
    this.sizeOrbits();
  }

  /**
   * Rayons des anneaux : réguliers (écart réglable), mais un anneau s'élargit pour que ses
   * étoiles tiennent toutes sans se recouvrir (circonférence ≥ nombre × écart minimal).
   */
  private sizeOrbits(): void {
    const count = new Map<string, number>();
    for (const n of this.nodes) if (!n.ghost) count.set(n.folder, (count.get(n.folder) ?? 0) + 1);
    const gap = RING_GAP * this.spacing;
    let previous = -Infinity;
    for (const orbit of [...this.orbitOf.values()].sort((a, b) => a.index - b.index)) {
      const needed = ((count.get(orbit.folder) ?? 0) * STAR_SPACING) / (Math.PI * 2);
      orbit.radius = Math.max(orbit.index === 0 ? FIRST_RING : previous + gap, previous + gap, needed);
      if (orbit.shownRadius === 0) orbit.shownRadius = orbit.radius; // nouvel anneau : il apparaît à sa place
      previous = orbit.radius;
    }
  }

  /**
   * Angle de chaque note sur son anneau. Au premier placement d'un anneau, ses notes sont
   * réparties régulièrement (dans un ordre tiré de leur nom, toujours le même). Ensuite, une
   * note qui arrive (nouvelle, ou venue d'un autre dossier) prend le milieu du plus grand
   * intervalle libre ; les autres ne bougent pas.
   */
  private assignAngles(): void {
    const byFolder = new Map<string, GraphNode[]>();
    for (const n of this.nodes) {
      if (n.ghost) continue;
      if (!byFolder.has(n.folder)) byFolder.set(n.folder, []);
      byFolder.get(n.folder)!.push(n);
    }
    for (const [folder, members] of byFolder) {
      const placed = members.filter((n) => this.angleOf.get(n.id)?.folder === folder);
      const arriving = members.filter((n) => this.angleOf.get(n.id)?.folder !== folder).sort((a, b) => hash(a.id) - hash(b.id));
      if (placed.length === 0) {
        const start = hash(folder) * Math.PI * 2;
        arriving.forEach((n, i) => this.angleOf.set(n.id, { angle: start + (i * Math.PI * 2) / arriving.length, folder }));
        continue;
      }
      const angles = placed.map((n) => normalize(this.angleOf.get(n.id)!.angle));
      for (const n of arriving) {
        const angle = widestGap(angles);
        angles.push(angle);
        this.angleOf.set(n.id, { angle, folder });
      }
    }
  }

  /** Place visée d'une étoile (sur son anneau, ou dans la bande des fantômes). */
  private target(n: GraphNode, settled = false): Vec3 {
    const p = this.plane;
    let r: number;
    let angle: number;
    const orbit = n.ghost ? null : this.orbitOf.get(n.folder);
    if (orbit) {
      r = settled ? orbit.radius : orbit.shownRadius;
      angle = this.angleOf.get(n.id)?.angle ?? 0;
    } else {
      r = this.ghostRadius;
      angle = hash(n.id) * Math.PI * 2;
    }
    const h = (hash(n.id + "↕") - 0.5) * DEPTH_JITTER;
    const c = Math.cos(angle) * r;
    const s = Math.sin(angle) * r;
    return [
      c * p.u[0] + s * p.v[0] + h * p.normal[0],
      c * p.u[1] + s * p.v[1] + h * p.normal[1],
      c * p.u[2] + s * p.v[2] + h * p.normal[2],
    ];
  }

  /**
   * Fait avancer les étoiles d'une image vers leur place (transition douce, ou immédiate en
   * mouvement réduit). Renvoie `true` tant qu'une étoile bouge encore.
   */
  tick(): boolean {
    const k = this.instant ? 1 : EASING;
    let moving = false;
    for (const n of this.nodes) {
      const [x, y, z] = this.target(n);
      const dx = x - n.x;
      const dy = y - n.y;
      const dz = z - n.z;
      if (Math.abs(dx) + Math.abs(dy) + Math.abs(dz) < 0.01) continue;
      n.x += dx * k;
      n.y += dy * k;
      n.z += dz * k;
      moving = true;
    }
    return moving;
  }

  /**
   * Fait avancer les transitions d'anneaux (rayon, apparition, disparition) d'une image.
   * Renvoie `true` tant qu'une transition est en cours.
   */
  animateOrbits(): boolean {
    const k = this.instant ? 1 : ORBIT_EASING;
    let moving = false;
    for (const o of this.orbits) {
      const targetOpacity = o.alive ? 1 : 0;
      o.shownRadius += (o.radius - o.shownRadius) * k;
      o.opacity += (targetOpacity - o.opacity) * k;
      if (Math.abs(o.radius - o.shownRadius) > 0.1 || Math.abs(targetOpacity - o.opacity) > 0.01) moving = true;
    }
    this.orbits = this.orbits.filter((o) => o.alive || o.opacity > 0.01);
    return moving;
  }

  /** Orbite d'une note (ou `null` pour un fantôme). */
  orbitFor(node: GraphNode): Orbit | null {
    return node.ghost ? null : (this.orbitOf.get(node.folder) ?? null);
  }

  /** Orbite vivante d'un dossier ("" = racine), ou `null`. */
  orbitOfFolder(folder: string): Orbit | null {
    return this.orbitOf.get(folder) ?? null;
  }
}

/** Plan du disque : horizontal, incliné de `degrees` autour de l'axe x. */
function diskPlane(degrees: number): { u: Vec3; v: Vec3; normal: Vec3 } {
  const t = (degrees * Math.PI) / 180;
  return { u: [1, 0, 0], v: rotateX([0, 0, 1], t), normal: rotateX([0, 1, 0], t) };
}

/** Angle ramené entre 0 et 2π. */
function normalize(a: number): number {
  const t = Math.PI * 2;
  return ((a % t) + t) % t;
}

/** Milieu du plus grand intervalle libre entre des angles (entre 0 et 2π). */
function widestGap(angles: number[]): number {
  const sorted = [...angles].sort((a, b) => a - b);
  let best = 0;
  let at = 0;
  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i];
    const b = i + 1 < sorted.length ? sorted[i + 1] : sorted[0] + Math.PI * 2;
    if (b - a > best) {
      best = b - a;
      at = a + (b - a) / 2;
    }
  }
  return normalize(at);
}

function rotateX([x, y, z]: Vec3, a: number): Vec3 {
  return [x, y * Math.cos(a) - z * Math.sin(a), y * Math.sin(a) + z * Math.cos(a)];
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
