// Petite caméra 3D : elle tourne autour d'un point visé et projette l'espace 3D sur l'écran.
//
// Principe de la projection perspective : on exprime chaque point "vu depuis la caméra"
// (deux rotations), ce qui donne sa profondeur z = distance devant l'objectif. Ensuite on
// divise x et y par cette profondeur : plus un point est loin, plus il est ramené vers le
// centre de l'écran et plus il paraît petit. C'est exactement l'effet d'une perspective.

/** Un point projeté à l'écran. */
export interface Projected {
  /** Position à l'écran, en pixels CSS. */
  x: number;
  y: number;
  /** Profondeur : distance devant la caméra (plus grand = plus loin). */
  depth: number;
  /** Facteur de taille : 1 unité du monde = `scale` pixels à cette profondeur. */
  scale: number;
  /** `false` si le point est derrière la caméra (à ne pas dessiner). */
  visible: boolean;
}

const NEAR = 20; // en deçà de cette profondeur, un point est considéré derrière la caméra
const MIN_PITCH = -1.45; // on ne passe pas tout à fait à la verticale (évite de basculer)
const MAX_PITCH = 1.45;
const MIN_DISTANCE = 120; // zoom maximal (caméra au plus près)
const MAX_DISTANCE = 6000; // zoom minimal (caméra au plus loin)

export class Camera {
  /** Rotation autour de l'axe vertical (gauche/droite), en radians. */
  yaw = 0;
  /** Inclinaison (vue de dessus quand c'est positif), en radians. */
  pitch = 0.6;
  /** Distance entre la caméra et le point visé. */
  distance = 900;
  /** Point visé (le centre de la rotation). */
  target: [number, number, number] = [0, 0, 0];

  /** Taille de l'écran (pixels CSS), mise à jour au redimensionnement. */
  width = 0;
  height = 0;
  /** Décalage horizontal du centre de l'image (pixels), pour laisser la place au panneau. */
  offsetX = 0;

  /** Distance focale : règle "l'ouverture" de l'objectif. Proportionnelle à la taille de l'écran. */
  get focal(): number {
    return Math.min(this.width, this.height) * 1.1;
  }

  /** Projette un point 3D du monde sur l'écran. */
  project(x: number, y: number, z: number): Projected {
    // 1. Coordonnées relatives au point visé.
    const qx = x - this.target[0];
    const qy = y - this.target[1];
    const qz = z - this.target[2];
    // 2. Rotation autour de l'axe vertical (yaw)...
    const cy = Math.cos(this.yaw);
    const sy = Math.sin(this.yaw);
    const x1 = qx * cy - qz * sy;
    const z1 = qx * sy + qz * cy;
    // 3. ...puis inclinaison (pitch), pour regarder un peu d'en haut.
    const cp = Math.cos(this.pitch);
    const sp = Math.sin(this.pitch);
    const y2 = qy * cp + z1 * sp;
    const z2 = -qy * sp + z1 * cp;
    // 4. La caméra est reculée de `distance` : profondeur du point devant elle.
    const depth = z2 + this.distance;
    // 5. Perspective : on divise par la profondeur.
    const scale = this.focal / Math.max(depth, NEAR);
    return {
      x: this.width / 2 + this.offsetX + x1 * scale,
      y: this.height / 2 - y2 * scale,
      depth,
      scale,
      visible: depth > NEAR,
    };
  }

  /** Tourne la caméra (glisser à la souris). */
  rotate(dx: number, dy: number): void {
    this.yaw -= dx * 0.005;
    this.pitch = Math.min(MAX_PITCH, Math.max(MIN_PITCH, this.pitch + dy * 0.005));
  }

  /** Rapproche/éloigne la caméra (molette). */
  zoom(deltaY: number): void {
    this.distance = Camera.clampDistance(this.distance * Math.exp(deltaY * 0.0012));
  }

  /** Ramène une distance dans les bornes du zoom (les mêmes pour la molette et les boutons). */
  static clampDistance(d: number): number {
    return Math.min(MAX_DISTANCE, Math.max(MIN_DISTANCE, d));
  }

  /** Déplace le point visé dans le plan de l'écran (clic droit ou Maj + glisser). */
  pan(dx: number, dy: number): void {
    // Un pixel à l'écran vaut `distance / focal` unités du monde au niveau du point visé.
    const k = this.distance / this.focal;
    const right = this.toWorld(1, 0, 0);
    const up = this.toWorld(0, 1, 0);
    for (let i = 0; i < 3; i++) this.target[i] += (-dx * right[i] + dy * up[i]) * k;
  }

  /** Convertit une direction "vue depuis la caméra" en direction du monde (rotations inverses). */
  private toWorld(x: number, y: number, z: number): [number, number, number] {
    const cp = Math.cos(this.pitch);
    const sp = Math.sin(this.pitch);
    const y1 = y * cp - z * sp;
    const z1 = y * sp + z * cp;
    const cy = Math.cos(this.yaw);
    const sy = Math.sin(this.yaw);
    return [x * cy + z1 * sy, y1, -x * sy + z1 * cy];
  }
}
