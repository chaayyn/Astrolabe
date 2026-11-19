// Adapté de second-brain-black-hole (MIT, © williamwasen) — voir THIRD_PARTY_LICENSES.md
//
// Le CIEL de la scène "galaxie", dessiné par la carte graphique (WebGL2).
//
// Principe : on ne colle pas une photo. Le ciel est une grande sphère autour de nous ; pour
// chaque pixel de l'écran, un petit programme (le "shader") calcule la direction qu'il
// regarde et ce qu'on voit dans cette direction :
//   - une nébuleuse très discrète (bande de poussière, cœur chaud, reflets froids),
//   - des milliers d'étoiles fines, qui scintillent doucement,
//   - de rares météores.
//
// D'après le dépôt de référence : les formules de la nébuleuse (bande inclinée, bruit en
// plusieurs octaves, cœur, reflets bleus, grain), la grille d'étoiles et le calcul des
// météores. Adaptations : TypeScript strict ; nébuleuse calculée UNE fois par la carte
// graphique dans une "cube map" (6 faces, pas de pôles déformés, rien de lourd côté
// processeur) ; étoiles placées sur une grille des 6 faces d'un cube, rondes et nettes à
// toute orientation ; scintillement ; couleurs lues dans le thème ; météores plus rares ;
// gestion de la perte du contexte graphique.
import type { Camera } from "../../camera";
import type { Palette } from "../../palette";

/** Réglages du ciel (panneau Paramètres, groupe "Ciel"). 1 = rendu prévu. */
export interface SkyOptions {
  nebula: number; // intensité de la nébuleuse
  density: number; // nombre d'étoiles
  brightness: number; // luminosité générale
  meteors: boolean;
}

/** Nombre de "couloirs" de météores (au plus un météore à la fois par couloir). */
const METEOR_COUNT = 10;
/** Côté d'une face de la cube map de la nébuleuse, en pixels. */
const CUBE_SIZE = 1024;
/**
 * Plafond de pixels réellement calculés pour le ciel (≈ un écran 1920×1080). Au-delà, le
 * ciel est calculé un peu plus petit puis agrandi par le navigateur : invisible sur une
 * nébuleuse aussi douce, et cela garde la carte graphique largement sous les 60 fps.
 */
const PIXEL_BUDGET = 2_100_000;
/**
 * Rayon de la sphère du ciel, en unités du monde. Elle est très loin mais pas infiniment :
 * quand la caméra tourne autour du graphe (et donc se déplace), le ciel glisse à peine
 * (légère parallaxe), comme dans le dépôt de référence.
 */
const SHELL = 40000;

// --- Petits outils GLSL communs aux deux programmes ---------------------------------------

/** Bruit "valeur" en 3D : un nombre pseudo-aléatoire lissé, entre 0 et 1. */
const NOISE_GLSL = /* glsl */ `
  float skyHash(vec3 p) {
    p = fract(p * vec3(.1031, .11369, .13787));
    p += dot(p, p.yzx + 19.19);
    return fract((p.x + p.y) * p.z);
  }
  float skyNoise(vec3 p) {
    vec3 i = floor(p), f = fract(p);
    f = f * f * (3. - 2. * f);
    return mix(mix(mix(skyHash(i), skyHash(i + vec3(1, 0, 0)), f.x),
                   mix(skyHash(i + vec3(0, 1, 0)), skyHash(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(skyHash(i + vec3(0, 0, 1)), skyHash(i + vec3(1, 0, 1)), f.x),
                   mix(skyHash(i + vec3(0, 1, 1)), skyHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
  }
`;

/** Un triangle qui couvre tout l'écran (aucun tampon de sommets nécessaire). */
const FULLSCREEN_VERTEX = /* glsl */ `#version 300 es
  void main() {
    vec2 p = vec2(gl_VertexID == 1 ? 3. : -1., gl_VertexID == 2 ? 3. : -1.);
    gl_Position = vec4(p, 0., 1.);
  }
`;

/**
 * Programme n°1, exécuté une seule fois par face du cube : calcule la nébuleuse dans
 * chaque direction et la range dans la cube map (des quantités, pas des couleurs : les
 * couleurs du thème sont appliquées à l'affichage, donc changer de couleur est gratuit).
 *   R = densité du nuage · G = part "chaude" du cœur · B = bande de la galaxie · A = grain
 */
const BAKE_FRAGMENT = /* glsl */ `#version 300 es
  precision highp float;
  uniform int uFace;
  uniform float uSize;
  out vec4 outValue;
  ${NOISE_GLSL}
  // Même mélange d'octaves que le dépôt de référence.
  float field(vec3 p) {
    return skyNoise(p * 2.2 + vec3(11, 0, 0)) * .45
         + skyNoise(p * 5.3 + vec3(0, 23, 0)) * .27
         + skyNoise(p * 13.1 + vec3(0, 0, 7)) * .17
         + skyNoise(p * 31.7 + vec3(41, 0, 0)) * .08
         + skyNoise(p * 75.3 + vec3(0, 19, 0)) * .03;
  }
  // Direction regardée par un pixel d'une face (convention des cube maps OpenGL).
  vec3 faceDirection(int face, vec2 st) {
    if (face == 0) return vec3(1., -st.y, -st.x);
    if (face == 1) return vec3(-1., -st.y, st.x);
    if (face == 2) return vec3(st.x, 1., st.y);
    if (face == 3) return vec3(st.x, -1., -st.y);
    if (face == 4) return vec3(st.x, -st.y, 1.);
    return vec3(-st.x, -st.y, -1.);
  }
  void main() {
    vec2 st = gl_FragCoord.xy / uSize * 2. - 1.;
    vec3 d = normalize(faceDirection(uFace, st));
    float n = field(d);
    float warp = (skyNoise(d * 3. + vec3(8, -2, 0)) - .5) * .20;
    float latitude = dot(d, vec3(.706, .706, .055)) + warp;
    float band = exp(-latitude * latitude / .035);
    float core = pow(max(0., dot(d, vec3(-.32, .14, -.937))), 7.);
    float dust = .06 + .94 * smoothstep(0., 1., clamp((n - .36) * 4.6, 0., 1.));
    float cloud = band * (10. + 32. * core) * dust * (.30 + n); // de 0 à ~55 (sur 255)
    float rust = core * skyNoise(d * 4. + vec3(71, 0, 0));
    float grain = skyNoise(d * 34.) * .5 + skyNoise(d * 93.) * .28 + skyNoise(d * 241.) * .22;
    outValue = vec4(cloud / 64., rust, band, grain);
  }
`;

/** Programme n°2, à chaque image : la nébuleuse (lue dans la cube map), les étoiles, les météores. */
const SKY_FRAGMENT = /* glsl */ `#version 300 es
  precision highp float;
  uniform samplerCube uNebulaMap;
  uniform vec2 uCenter;      // centre optique, en pixels du canvas du ciel
  uniform float uFocal;      // focale de la caméra, en pixels du canvas du ciel
  uniform vec4 uRotation;    // cos(yaw), sin(yaw), cos(pitch), sin(pitch)
  uniform vec3 uObserver;    // position de la caméra, rapportée au rayon de la sphère du ciel
  uniform float uTime;       // secondes
  uniform vec2 uViewport;    // taille du canvas du ciel, en pixels
  uniform vec3 uSky, uStar, uAccent, uNebula, uGlow; // couleurs du thème (0 à 1)
  uniform float uNebulaAmount, uDensity, uBrightness;
  uniform vec4 uMeteorHead[${METEOR_COUNT}]; // xyz = tête, w = éclat
  uniform vec4 uMeteorTail[${METEOR_COUNT}]; // xyz = queue, w = épaisseur (radians)
  out vec4 outColor;
  ${NOISE_GLSL}

  // L'étoile de la case de la grille où tombe la direction d. Grille posée sur les 6 faces
  // d'un cube (G cases de côté par face). Renvoie : distance en pixels, puis 3 tirages.
  vec4 starCell(vec3 d, float G, float salt) {
    vec3 a = abs(d), n, u, v;
    if (a.x >= a.y && a.x >= a.z) { n = vec3(sign(d.x), 0, 0); u = vec3(0, 1, 0); v = vec3(0, 0, 1); }
    else if (a.y >= a.z) { n = vec3(0, sign(d.y), 0); u = vec3(1, 0, 0); v = vec3(0, 0, 1); }
    else { n = vec3(0, 0, sign(d.z)); u = vec3(1, 0, 0); v = vec3(0, 1, 0); }
    vec2 f = vec2(dot(d, u), dot(d, v)) / dot(d, n) * G;
    vec2 cell = floor(f);
    vec3 key = vec3(cell, dot(n, vec3(1, 2, 3)) * 13. + salt);
    // Position de l'étoile dans sa case (jamais collée au bord, pour ne pas être coupée).
    vec2 offset = vec2(skyHash(key + 31.), skyHash(key + 71.)) * .5 + .25;
    vec2 sf = (cell + offset) / G;
    vec3 s = normalize(n + u * sf.x + v * sf.y);
    float distPx = length(d - s) * uFocal; // écart angulaire converti en pixels
    return vec4(distPx, skyHash(key), skyHash(key + 101.), skyHash(key + 151.));
  }

  void main() {
    // 1. Direction regardée par ce pixel (mêmes rotations que camera.ts, à l'envers).
    vec3 v = normalize(vec3((gl_FragCoord.xy - uCenter) / uFocal, 1.));
    float cy = uRotation.x, sy = uRotation.y, cp = uRotation.z, sp = uRotation.w;
    float y1 = v.y * cp - v.z * sp, z1 = v.y * sp + v.z * cp;
    vec3 ray = vec3(v.x * cy + z1 * sy, y1, -v.x * sy + z1 * cy);
    // 2. Point touché sur la sphère du ciel (rayon 1) : légère parallaxe quand la caméra bouge.
    float b = dot(uObserver, ray);
    float t = -b + sqrt(max(0., b * b + 1. - dot(uObserver, uObserver)));
    vec3 d = normalize(uObserver + ray * t);

    // 3. Nébuleuse : quantités lues dans la cube map, couleurs du thème.
    vec4 m = texture(uNebulaMap, d);
    float cloud = m.r * 64. / 255.;
    vec3 cloudColor = mix(uNebula * 1.48, uAccent * 1.25, m.g * .55);
    float blue = pow(max(0., dot(d, vec3(.78, -.25, .573))), 3.) * m.b;
    float veins = smoothstep(.38, .7, m.a);
    vec3 nebula = cloud * cloudColor + blue * uGlow * (12. / 255.) + m.b * veins * uGlow * .09;
    nebula *= .66 + .7 * smoothstep(.25, .64, m.a);
    vec3 color = uSky + nebula * uNebulaAmount;

    // 4. Étoiles fines (beaucoup) : un peu plus nombreuses dans la bande de la galaxie.
    //    Cases assez grandes (≈ 6 px) pour qu'une étoile ne soit jamais coupée par leur bord.
    vec4 s = starCell(d, 260., 17.);
    float present = step(1. - .04 * uDensity * (1. + 1.2 * m.b), s.y);
    float core = 1. - smoothstep(.45, 1.05, s.x);
    float twinkle = 1. - .35 * (.5 + .5 * sin(uTime * (1.2 + 3. * s.z) + s.w * 40.));
    vec3 tint = mix(mix(uStar, uGlow, .45), uStar, s.z);
    color += present * core * tint * (.25 + .45 * fract(s.w * 13.)) * twinkle;

    // 5. Étoiles brillantes (rares), avec un petit halo et un scintillement plus marqué.
    vec4 g = starCell(d, 90., 53.);
    float bright = step(1. - .02 * uDensity, g.y);
    float glow = (1. - smoothstep(.6, 1.4, g.x)) + .35 * exp(-g.x * g.x / 5.);
    float sparkle = 1. - .6 * (.5 + .5 * sin(uTime * (.7 + 2.2 * g.z) + g.w * 60.));
    color += bright * glow * mix(uStar, uAccent, step(.85, g.z) * .6) * (.55 + .4 * g.y) * sparkle;

    // 6. Météores : un trait fin qui s'estompe vers la queue.
    float pixel = .62 / uFocal;
    for (int i = 0; i < ${METEOR_COUNT}; ++i) {
      vec4 head = uMeteorHead[i], tail = uMeteorTail[i];
      if (head.w <= .0001 || dot(ray, head.xyz) < .995) continue;
      vec3 span = tail.xyz - head.xyz;
      float k = clamp(dot(ray - head.xyz, span) / max(dot(span, span), .000001), 0., 1.);
      float dist = length(ray - normalize(mix(head.xyz, tail.xyz, k)));
      float width = max(tail.w, pixel);
      float profile = exp(-dist * dist / (width * width)) * pow(1. - k, 1.45);
      color += mix(uStar, vec3(1), .5) * profile * head.w * min(1., tail.w / pixel);
    }

    // 7. Léger assombrissement des bords, luminosité générale, et un grain infime qui évite
    //    les "marches" visibles dans les dégradés très sombres.
    vec2 ndc = gl_FragCoord.xy / uViewport * 2. - 1.;
    color *= (1. - .24 * smoothstep(.15, 1.42, length(ndc))) * uBrightness;
    color += (skyHash(vec3(gl_FragCoord.xy, 3.)) - .5) / 255.;
    outColor = vec4(color, 1.);
  }
`;

// --- Météores (calculés par le processeur, quelques nombres par image) -------------------

function meteorRandom(n: number): number {
  let v = Math.imul(n ^ 0x6ac690c5, 0x45d9f3b);
  v = Math.imul(v ^ (v >>> 16), 0x45d9f3b);
  return ((v ^ (v >>> 16)) >>> 0) / 4294967296;
}

/**
 * Où en est le météore du couloir `lane` au temps `time` (secondes) : tête, queue, éclat.
 * Même calcul que le dépôt de référence, avec des passages environ 3 fois plus espacés
 * (des météores RARES : de l'ordre d'un toutes les dix secondes à l'écran).
 */
function meteorAt(lane: number, time: number, out: { head: number[]; tail: number[]; brightness: number; width: number }): void {
  const period = (3.75 + meteorRandom(lane * 37 + 1) * 1.35) * 3;
  const offset = lane * 1.23;
  const cycle = Math.floor((time + offset) / period);
  const seed = cycle * 173 + lane * 4099;
  const start = 0.24 + meteorRandom(seed + 13) * (period - 2.2);
  const duration = 1.16 + meteorRandom(seed + 29) * 0.48;
  const progress = (time + offset - cycle * period - start) / duration;
  const lon = meteorRandom(seed + 43) * Math.PI * 2 - Math.PI;
  const lat = (meteorRandom(seed + 71) - 0.5) * 1.1;
  const axis = [Math.sin(lon) * Math.cos(lat), Math.sin(lat), -Math.cos(lon) * Math.cos(lat)];
  const angle = meteorRandom(seed + 97) * Math.PI * 2;
  const east = [Math.cos(lon), 0, Math.sin(lon)];
  const north = [-Math.sin(lon) * Math.sin(lat), Math.cos(lat), Math.cos(lon) * Math.sin(lat)];
  const tangent = east.map((e, i) => e * Math.cos(angle) + north[i] * Math.sin(angle));
  const arc = 0.075 + meteorRandom(seed + 113) * 0.09;
  const along = (a: number) => axis.map((x, i) => x * Math.cos(a) + tangent[i] * Math.sin(a));
  const distance = (progress - 0.5) * arc;
  const active = progress > 0 && progress < 1;
  out.head = along(distance);
  out.tail = along(distance - (0.015 + meteorRandom(seed + 139) * 0.023));
  out.brightness = active ? Math.pow(Math.sin(Math.PI * progress), 0.75) * (0.23 + meteorRandom(seed + 157) * 0.15) : 0;
  out.width = 0.00016 + meteorRandom(seed + 179) * 0.00015;
}

// --- Le ciel lui-même ---------------------------------------------------------------------

/** Ce qui vit dans la carte graphique (à refaire si le contexte est perdu puis rendu). */
interface GpuResources {
  program: WebGLProgram;
  nebulaMap: WebGLTexture;
  vao: WebGLVertexArrayObject;
  uniforms: Record<string, WebGLUniformLocation | null>;
}

const UNIFORMS = [
  "uNebulaMap", "uCenter", "uFocal", "uRotation", "uObserver", "uTime", "uViewport",
  "uSky", "uStar", "uAccent", "uNebula", "uGlow", "uNebulaAmount", "uDensity", "uBrightness",
  "uMeteorHead[0]", "uMeteorTail[0]",
] as const;

export class Sky {
  readonly canvas = document.createElement("canvas");
  private gl: WebGL2RenderingContext;
  private gpu: GpuResources | null = null;
  private options: SkyOptions = { nebula: 1, density: 1, brightness: 1, meteors: true };
  /** Taille actuelle (pixels CSS) et facteur pixels réels / pixels CSS du canvas du ciel. */
  private size = { w: 0, h: 0, dpr: 0, scale: 1 };
  private heads = new Float32Array(METEOR_COUNT * 4);
  private tails = new Float32Array(METEOR_COUNT * 4);
  private meteor = { head: [0, 0, 0], tail: [0, 0, 0], brightness: 0, width: 0 };
  /** Couleurs du thème converties pour le shader (recalculées seulement si elles changent). */
  private colorKey = "";
  private colors: Record<"uSky" | "uStar" | "uAccent" | "uNebula" | "uGlow", number[]> = {
    uSky: [0, 0, 0], uStar: [1, 1, 1], uAccent: [1, 1, 1], uNebula: [1, 1, 1], uGlow: [1, 1, 1],
  };
  /** Prévenu quand le ciel devient indisponible (contexte perdu) ou revient (`true`). */
  onAvailability: (available: boolean) => void = () => {};

  /** Lance une erreur si WebGL2 manque ou si un shader ne compile pas (la scène se repliera). */
  constructor() {
    const gl = this.canvas.getContext("webgl2", {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: "high-performance",
    });
    if (!gl) throw new Error("WebGL2 indisponible sur cet ordinateur");
    this.gl = gl;
    try {
      this.gpu = this.build();
    } catch (err) {
      this.release();
      throw err;
    }
    this.canvas.className = "scene-canvas";
    this.canvas.addEventListener("webglcontextlost", this.handleLost);
    this.canvas.addEventListener("webglcontextrestored", this.handleRestored);
  }

  setOptions(options: SkyOptions): void {
    this.options = options;
  }

  /** Le contexte WebGL du ciel (le trou noir dessine dans le même canvas, juste après). */
  get context(): WebGL2RenderingContext {
    return this.gl;
  }

  /** Pixels réels du canvas du ciel par pixel CSS (le ciel peut être calculé un peu plus petit). */
  get pixelScale(): number {
    return this.size.scale;
  }

  /**
   * Dessine le ciel pour la caméra actuelle. `time` en millisecondes. Renvoie `false` si rien
   * n'a été dessiné (contexte perdu, fenêtre cachée).
   */
  render(camera: Camera, time: number, palette: Palette): boolean {
    const gl = this.gl;
    const gpu = this.gpu;
    // Rien à faire si le contexte est perdu, ou si la fenêtre est cachée (économie).
    if (!gpu || gl.isContextLost() || document.hidden) return false;
    this.fitToScreen(camera.width, camera.height);
    this.refreshColors(palette);
    const u = gpu.uniforms;
    const k = this.size.scale;
    const seconds = time / 1000;

    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(gpu.program);
    gl.bindVertexArray(gpu.vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_CUBE_MAP, gpu.nebulaMap);
    gl.uniform1i(u.uNebulaMap, 0);
    // Centre optique et focale exactement comme camera.ts, convertis en pixels du ciel
    // (l'axe vertical de WebGL monte, celui de l'écran descend : même centre, symétrique).
    gl.uniform2f(u.uCenter, (camera.width / 2 + camera.offsetX) * k, (camera.height / 2) * k);
    gl.uniform1f(u.uFocal, camera.focal * k);
    gl.uniform2f(u.uViewport, this.canvas.width, this.canvas.height);
    const cy = Math.cos(camera.yaw), sy = Math.sin(camera.yaw);
    const cp = Math.cos(camera.pitch), sp = Math.sin(camera.pitch);
    gl.uniform4f(u.uRotation, cy, sy, cp, sp);
    // Position de la caméra dans le monde (elle tourne autour du point visé, à `distance`).
    const d = camera.distance / SHELL;
    const [tx, ty, tz] = camera.target.map((x) => x / SHELL);
    gl.uniform3f(u.uObserver, tx - d * cp * sy, ty + d * sp, tz - d * cp * cy);
    gl.uniform1f(u.uTime, seconds % 3600); // reste précis même après des heures
    for (const name of ["uSky", "uStar", "uAccent", "uNebula", "uGlow"] as const) gl.uniform3fv(u[name], this.colors[name]);
    gl.uniform1f(u.uNebulaAmount, this.options.nebula);
    gl.uniform1f(u.uDensity, this.options.density);
    gl.uniform1f(u.uBrightness, this.options.brightness);

    for (let i = 0; i < METEOR_COUNT; i++) {
      meteorAt(i, seconds, this.meteor);
      const m = this.meteor;
      this.heads.set([m.head[0], m.head[1], m.head[2], this.options.meteors ? m.brightness : 0], i * 4);
      this.tails.set([m.tail[0], m.tail[1], m.tail[2], m.width], i * 4);
    }
    gl.uniform4fv(u["uMeteorHead[0]"], this.heads);
    gl.uniform4fv(u["uMeteorTail[0]"], this.tails);

    gl.drawArrays(gl.TRIANGLES, 0, 3);
    return true;
  }

  /** Libère tout : programme, texture, contexte graphique, canvas. */
  dispose(): void {
    this.canvas.removeEventListener("webglcontextlost", this.handleLost);
    this.canvas.removeEventListener("webglcontextrestored", this.handleRestored);
    this.release();
    this.canvas.remove();
    this.canvas.width = this.canvas.height = 0;
  }

  // --- Interne ----------------------------------------------------------------------------

  /** Taille du canvas : celle de la fenêtre, sans dépasser PIXEL_BUDGET pixels calculés. */
  private fitToScreen(w: number, h: number): void {
    const dpr = window.devicePixelRatio || 1;
    if (w === this.size.w && h === this.size.h && dpr === this.size.dpr) return;
    const scale = Math.min(dpr, Math.sqrt(PIXEL_BUDGET / Math.max(1, w * h)));
    this.size = { w, h, dpr, scale };
    this.canvas.width = Math.max(1, Math.round(w * scale));
    this.canvas.height = Math.max(1, Math.round(h * scale));
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
  }

  /** Convertit les couleurs du thème ("r, g, b") en nombres de 0 à 1, si elles ont changé. */
  private refreshColors(p: Palette): void {
    const key = [p.sky, p.star, p.starAccent, p.nebula, p.nebulaGlow].join("|");
    if (key === this.colorKey) return;
    this.colorKey = key;
    const rgb = (value: string) => value.split(",").map((x) => Number(x) / 255);
    this.colors = { uSky: rgb(p.sky), uStar: rgb(p.star), uAccent: rgb(p.starAccent), uNebula: rgb(p.nebula), uGlow: rgb(p.nebulaGlow) };
  }

  /** Crée les programmes et calcule la nébuleuse dans la cube map. */
  private build(): GpuResources {
    const gl = this.gl;
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);

    // 1. La nébuleuse, calculée une fois pour toutes, face par face.
    const nebulaMap = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_CUBE_MAP, nebulaMap);
    gl.texStorage2D(gl.TEXTURE_CUBE_MAP, 1, gl.RGBA8, CUBE_SIZE, CUBE_SIZE);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const bake = this.program(FULLSCREEN_VERTEX, BAKE_FRAGMENT);
    const framebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.useProgram(bake);
    gl.uniform1f(gl.getUniformLocation(bake, "uSize"), CUBE_SIZE);
    gl.viewport(0, 0, CUBE_SIZE, CUBE_SIZE);
    for (let face = 0; face < 6; face++) {
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_CUBE_MAP_POSITIVE_X + face, nebulaMap, 0);
      gl.uniform1i(gl.getUniformLocation(bake, "uFace"), face);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(framebuffer);
    gl.deleteProgram(bake);

    // 2. Le programme dessiné à chaque image.
    const program = this.program(FULLSCREEN_VERTEX, SKY_FRAGMENT);
    const uniforms: GpuResources["uniforms"] = {};
    for (const name of UNIFORMS) uniforms[name] = gl.getUniformLocation(program, name);
    this.colorKey = ""; // couleurs à renvoyer au nouveau programme
    return { program, nebulaMap, vao, uniforms };
  }

  /** Compile et relie un programme ; lance une erreur lisible en cas d'échec. */
  private program(vertex: string, fragment: string): WebGLProgram {
    const gl = this.gl;
    const program = gl.createProgram();
    for (const [type, source] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]] as const) {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS) && !gl.isContextLost()) {
        const log = gl.getShaderInfoLog(shader);
        gl.deleteShader(shader);
        gl.deleteProgram(program);
        throw new Error(`shader du ciel : ${log}`);
      }
      gl.attachShader(program, shader);
      gl.deleteShader(shader); // il reste attaché au programme : seul le programme compte
    }
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS) && !gl.isContextLost()) {
      const log = gl.getProgramInfoLog(program);
      gl.deleteProgram(program);
      throw new Error(`programme du ciel : ${log}`);
    }
    return program;
  }

  /** Rend la mémoire de la carte graphique, puis le contexte lui-même. */
  private release(): void {
    const gl = this.gl;
    if (this.gpu && !gl.isContextLost()) {
      gl.deleteProgram(this.gpu.program);
      gl.deleteTexture(this.gpu.nebulaMap);
      gl.deleteVertexArray(this.gpu.vao);
    }
    this.gpu = null;
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  }

  /**
   * Le système a repris la carte graphique (pilote relancé, mise en veille…). On l'accepte
   * (preventDefault : on veut pouvoir la récupérer) et la scène affiche le ciel classique.
   */
  private handleLost = (e: Event): void => {
    e.preventDefault();
    this.gpu = null;
    console.warn("[ciel] contexte WebGL perdu : ciel classique en attendant son retour.");
    this.onAvailability(false);
  };

  /** La carte graphique est rendue : tout ce qu'elle contenait est à refaire. */
  private handleRestored = (): void => {
    try {
      this.gpu = this.build();
      this.size = { w: 0, h: 0, dpr: 0, scale: 1 };
      console.info("[ciel] contexte WebGL rendu : ciel WebGL rétabli.");
      this.onAvailability(true);
    } catch (err) {
      console.warn("[ciel] impossible de rétablir le ciel WebGL :", err);
    }
  };
}
