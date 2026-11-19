// Adapté de second-brain-black-hole (MIT, © williamwasen) — voir THIRD_PARTY_LICENSES.md
//
// Le TROU NOIR de la scène "galaxie", dessiné par la carte graphique (WebGL2), dans le même
// canvas que le ciel (sky.ts), juste après lui.
//
// Principe (comme le dépôt de référence) : pour chaque pixel proche du trou noir, on lance un
// rayon de lumière depuis la caméra et on le fait avancer pas à pas. La gravité COURBE sa
// trajectoire (formule approchée de Schwarzschild). Si le rayon tombe dans l'horizon, le pixel
// est noir (l'ombre). S'il traverse le disque d'accrétion, il en ramasse la lumière : c'est
// ainsi qu'apparaissent les arcs de lumière AU-DESSUS et EN DESSOUS du trou noir (la partie du
// disque cachée derrière, vue grâce aux rayons courbés : l'effet de lentille).
// Ensuite, un halo doux (lumière floutée en deux passes) est ajouté autour.
//
// Distances internes en "rayons de Schwarzschild" (Rs). L'ombre apparente mesure 2,598 Rs :
// on la cale sur le rayon du trou noir de la scène classique (16 unités du monde), pour que
// tout le reste (étoiles, orbites) garde exactement la même échelle.
//
// Repris du dépôt de référence : l'intégrateur de rayons, le disque procédural (bruit animé,
// rotation différentielle, effet Doppler, épaisseur gaussienne intégrée), le flou du halo et
// la composition avec mappage des tons. Adaptations : TypeScript strict ; caméra de notre
// moteur (lacet, tangage, distance, point visé, décalage du rail) ; un seul trou noir au
// centre du monde ; couleurs tirées du thème ; réglages (luminosité, lentille, rotation,
// halo, inclinaison, qualité) ; pas de ciel dévié recalculé ici (le ciel reste celui de
// sky.ts, visible à travers) ; départ du rayon possible depuis l'intérieur de la zone.
import type { Camera } from "../../camera";
import type { Palette } from "../../palette";
import { HOLE_RADIUS } from "../classic/blackhole";

/** Réglages du trou noir (panneau Paramètres, groupe "Trou noir"). */
export interface HoleOptions {
  brightness: number; // luminosité du disque (1 = normal)
  lens: number; // force de la courbure des rayons (1 = normal)
  spin: number; // vitesse de rotation du disque (1 = normal)
  halo: number; // intensité du halo (1 = normal)
  tilt: number; // inclinaison du disque, en degrés
  quality: "low" | "medium" | "high";
}

/** Rayon de Schwarzschild en unités du monde : l'ombre (2,598 Rs) = HOLE_RADIUS. */
export const RS = HOLE_RADIUS / 2.598076211;
/** Au-delà de ce paramètre d'impact (en Rs), un rayon n'est plus calculé. */
const LENS_EXTENT = 14.5;

/** Qualité : nombre maximal de pas par rayon, et résolution du calcul (part de celle du ciel). */
const QUALITY = {
  low: { steps: 72, scale: 0.5 },
  medium: { steps: 120, scale: 0.75 },
  high: { steps: 176, scale: 1 },
} as const;

/**
 * Rayon (unités du monde) de la zone où le trou noir paraît noir, selon la force de la
 * lentille : c'est là que la scène classique efface ce qui passe DERRIÈRE lui.
 */
export function shadowRadius(lens: number): number {
  return Math.max(1.015, 2.598 * Math.sqrt(Math.max(0, lens))) * RS;
}

const FULLSCREEN_VERTEX = /* glsl */ `#version 300 es
  out vec2 vUV;
  void main() {
    vec2 p = vec2(gl_VertexID == 1 ? 2. : 0., gl_VertexID == 2 ? 2. : 0.);
    vUV = p;
    gl_Position = vec4(p * 2. - 1., 0., 1.);
  }
`;

/** Le carré autour du trou noir (les rayons ne sont calculés que là). */
const RAY_VERTEX = /* glsl */ `#version 300 es
  uniform vec2 uCenter;   // centre du trou noir, en pixels de la cible
  uniform float uBound;   // demi-côté du carré, en pixels de la cible
  uniform vec2 uTarget;   // taille de la cible, en pixels
  void main() {
    vec2 corner = vec2((gl_VertexID & 1) == 0 ? -1. : 1., gl_VertexID < 2 ? -1. : 1.);
    gl_Position = vec4((uCenter + corner * uBound) / uTarget * 2. - 1., 0., 1.);
  }
`;

const rayFragment = (hdr: boolean) => /* glsl */ `#version 300 es
  precision highp float;
  precision highp int;
  uniform vec2 uOptic;    // centre optique de la caméra, en pixels de la cible
  uniform float uFocal;   // focale, en pixels de la cible
  uniform vec3 uOrigin;   // caméra, relative au trou noir, en Rs (repère de la caméra)
  uniform vec3 uNormal, uBasis; // axe du disque et direction de référence (repère de la caméra)
  uniform float uTime, uSeed, uLens, uBright, uStepScale;
  uniform int uSteps;
  uniform vec3 uHot, uMid, uDeep; // couleurs du disque : blanc chaud, doré, profond
  out vec4 color;
  const float STORE = ${hdr ? "1." : "0.0625"};

  float hash(vec3 p) { p = fract(p * .1031); p += dot(p, p.yzx + 33.33); return fract((p.x + p.y) * p.z); }
  float noise(vec3 p) {
    vec3 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
    return mix(mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
  }
  float fbm(vec3 p) { return .56 * noise(p) + .28 * noise(p * 2.03 + 7.1) + .16 * noise(p * 4.07 - 3.8); }

  // Lumière émise par le disque au point p (densité renvoyée à part).
  vec3 plasma(vec3 p, vec3 direction, out float density) {
    vec3 tangent = normalize(cross(uNormal, uBasis));
    float x = dot(p, uBasis), y = dot(p, tangent), r = length(vec2(x, y));
    float window = smoothstep(2.85, 3.5, r) * (1. - smoothstep(8.5, 12.8, r));
    if (window < .0001) { density = 0.; return vec3(0); }
    float a = atan(y, x);
    // Rotation différentielle : l'intérieur tourne plus vite que l'extérieur.
    float omega = .31 * pow(3.4 / r, 1.5);
    float phase = a - uTime * omega + uSeed;
    float drift = r + uTime * .018;
    vec3 q = vec3(cos(phase), sin(phase), drift * .30);
    float flow = fbm(q * vec3(4., 4., 5.) + vec3(0, 0, uTime * .065));
    float detail = fbm(vec3(cos(phase) * 13., sin(phase) * 13., drift * 2.7) + flow * 2.7 + uTime * .038);
    float filament = fbm(vec3(cos(phase) * 5., sin(phase) * 5., drift * 3.8) + vec3(flow * 2., flow * 2., flow * 4.));
    float lanes = pow(smoothstep(.24, .80, filament), 3.);
    float knots = pow(smoothstep(.25, .88, detail), 2.);
    float energy = (.10 + lanes * 2.2 + knots * 2.8) * (.30 + 1.1 * flow);
    energy *= .28 + 1.55 * noise(vec3(cos(phase) * 2.2, sin(phase) * 2.2, uSeed + uTime * .13));
    float falloff = pow(3.8 / r, 3.0);
    density = window * (.22 + energy * .55);
    // Effet Doppler : le côté qui vient vers nous est plus brillant.
    vec3 velocity = normalize(cross(uNormal, p)) * sqrt(.5 / max(r - 1., 1.));
    float doppler = clamp(1. / (1. + dot(velocity, direction)), .65, 1.65);
    float heat = clamp(.85 - (r - 3.) * .075 + knots * .25, 0., 1.);
    vec3 tint = mix(uDeep, uMid, heat);
    tint = mix(tint, uHot, smoothstep(.72, 1., heat) * .62);
    return tint * (3.8 * falloff * energy * window * pow(doppler, 2.3)) * uBright;
  }

  float erfApprox(float x) {
    float a = abs(x), t = 1. / (1. + .3275911 * a);
    float poly = (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - .284496736) * t + .254829592) * t;
    return sign(x) * (1. - poly * exp(-a * a));
  }
  // Accélération qui courbe le rayon (h2 = carré du paramètre d'impact).
  vec3 acceleration(vec3 p, float h2) { float r2 = dot(p, p); return -1.5 * uLens * h2 * p / (r2 * r2 * sqrt(r2)); }

  void main() {
    vec3 incoming = normalize(vec3((gl_FragCoord.xy - uOptic) / uFocal, 1.));
    vec3 origin = uOrigin;
    float closest = -dot(origin, incoming);
    float b2 = max(0., dot(origin, origin) - closest * closest);
    float b = sqrt(b2);
    bool inside = dot(origin, origin) < 26. * 26.;
    if (b > 14.3 || (!inside && closest < 0.)) discard;
    float coverage = 1. - smoothstep(10., 14.3, b);
    vec3 p, velocity;
    if (inside) {
      p = origin; velocity = incoming; // caméra très proche : le rayon part d'ici
    } else {
      // On saute directement à l'entrée de la zone utile (sphère de 26 Rs).
      p = origin + incoming * (closest - sqrt(max(0., 26. * 26. - b2)));
      vec3 radial = normalize(p);
      float vr = dot(incoming, radial);
      velocity = incoming - radial * vr - radial * sqrt(max(.0001, vr * vr + b2 / (26. * 26. * 26.)));
    }
    vec3 emission = vec3(0); float transmission = 1.; bool captured = false;
    for (int i = 0; i < 176; i++) {
      if (i >= uSteps) break;
      float r = length(p);
      if (r < 1.015) { captured = true; break; }
      if (r > 26.5 && dot(p, velocity) > 0.) break;
      float ds = clamp(r * .105, .055, 1.6) * uStepScale;
      vec3 a = acceleration(p, b2);
      vec3 next = p + velocity * ds + .5 * a * ds * ds;
      vec3 nextV = velocity + .5 * (a + acceleration(next, b2)) * ds;
      float h0 = dot(p, uNormal), h1 = dot(next, uNormal);
      float across = clamp(h0 / (abs(h0 - h1) < .00001 ? .00001 : h0 - h1), 0., 1.);
      vec3 sampleP = mix(p, next, across);
      float diskR = length(sampleP - uNormal * dot(sampleP, uNormal));
      float thickness = .075 + .009 * diskR;
      if (min(abs(h0), abs(h1)) < thickness * 3. || h0 * h1 < 0.) {
        float density;
        vec3 light = plasma(sampleP, normalize(velocity), density);
        // Colonne gaussienne intégrée sur le pas (évite des bandes aux angles rasants).
        float dh = abs(h1 - h0);
        float column = dh > .0001
          ? abs(erfApprox(h1 / thickness) - erfApprox(h0 / thickness)) * .8862269 * length(next - p) / dh
          : exp(-pow((h0 + h1) * .5 / thickness, 2.)) * length(next - p) / thickness;
        float optical = column * .22;
        emission += transmission * light * optical;
        transmission *= exp(-density * optical * .65);
      }
      p = next; velocity = nextV;
    }
    // Ombre : noire et opaque. Ailleurs : la lumière du disque, et le ciel visible à travers.
    float alpha = captured ? 1. : 1. - transmission;
    color = vec4(emission * coverage * STORE, alpha * coverage);
  }
`;

/** Flou gaussien séparable (horizontal ou vertical), avec extraction des zones très claires. */
const blurFragment = (hdr: boolean) => /* glsl */ `#version 300 es
  precision highp float;
  in vec2 vUV; out vec4 color;
  uniform sampler2D uInput; uniform vec2 uDirection; uniform bool uExtract;
  vec3 value(vec2 uv) {
    vec3 c = texture(uInput, uv).rgb${hdr ? "" : " * 16."};
    if (uExtract) c = max(c - vec3(1.), vec3(0));
    return c;
  }
  void main() {
    vec3 c = value(vUV) * .227027;
    c += (value(vUV + uDirection * 1.384615) + value(vUV - uDirection * 1.384615)) * .316216;
    c += (value(vUV + uDirection * 3.230769) + value(vUV - uDirection * 3.230769)) * .070270;
    color = vec4(c * ${hdr ? "1." : ".0625"}, 1.);
  }
`;

/** Composition finale par-dessus le ciel : disque + halo, mappage des tons doux. */
const compositeFragment = (hdr: boolean) => /* glsl */ `#version 300 es
  precision highp float;
  in vec2 vUV; out vec4 color;
  uniform sampler2D uScene, uBloom, uWide;
  uniform float uHalo;
  void main() {
    vec4 scene = texture(uScene, vUV);
    float decode = ${hdr ? "1." : "16."};
    vec3 base = scene.rgb * decode;
    vec3 bloom = (texture(uBloom, vUV).rgb * .38 + texture(uWide, vUV).rgb * .38) * decode * uHalo;
    // L'ombre (opaque et sombre) reste noire : le halo n'y déborde presque pas.
    float shade = scene.a * (1. - clamp(max(base.r, max(base.g, base.b)) * 4., 0., 1.));
    bloom *= 1. - .85 * shade;
    float glow = max(bloom.r, max(bloom.g, bloom.b));
    float alpha = scene.a + (1. - scene.a) * clamp(glow * 2., 0., 1.);
    if (alpha < .0001) { color = vec4(0); return; }
    vec3 mapped = pow(1. - exp(-(base + bloom) / max(alpha, .001)), vec3(1. / 2.2));
    color = vec4(mapped * alpha, alpha);
  }
`;

interface Program {
  program: WebGLProgram;
  uniform(name: string): WebGLUniformLocation | null;
}

interface Target {
  texture: WebGLTexture;
  framebuffer: WebGLFramebuffer;
  w: number;
  h: number;
}

/** Le trou noir : à créer avec le contexte du ciel ; lance une erreur si un shader échoue. */
export class Accretion {
  private hdr: boolean;
  private vao: WebGLVertexArrayObject;
  private ray: Program;
  private blur: Program;
  private composite: Program;
  /** 0 = rayons (résolution de la qualité), 1-2 = flou au tiers, 3-4 = flou au douzième. */
  private targets: Target[] = [];
  private options: HoleOptions = { brightness: 1, lens: 1, spin: 1, halo: 1, tilt: 8, quality: "medium" };
  /** Temps du disque (secondes), qui avance à la vitesse réglée (et presque pas en mouvement réduit). */
  private diskTime = 0;
  private lastTime = -1;
  private reduceMotion = false;
  private colorKey = "";
  private colors = { hot: [1, 0.95, 0.82], mid: [1, 0.8, 0.49], deep: [1, 0.27, 0.055] };

  constructor(private gl: WebGL2RenderingContext) {
    this.hdr = !!gl.getExtension("EXT_color_buffer_float");
    this.vao = gl.createVertexArray();
    const made: WebGLProgram[] = [];
    try {
      this.ray = this.program(RAY_VERTEX, rayFragment(this.hdr), made);
      this.blur = this.program(FULLSCREEN_VERTEX, blurFragment(this.hdr), made);
      this.composite = this.program(FULLSCREEN_VERTEX, compositeFragment(this.hdr), made);
    } catch (err) {
      for (const p of made) gl.deleteProgram(p);
      gl.deleteVertexArray(this.vao);
      throw err;
    }
    for (let i = 0; i < 5; i++) {
      const texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this.targets.push({ texture, framebuffer: gl.createFramebuffer(), w: 0, h: 0 });
    }
  }

  setOptions(options: HoleOptions, reduceMotion: boolean): void {
    this.options = options;
    this.reduceMotion = reduceMotion;
  }

  /**
   * Dessine le trou noir par-dessus ce que contient déjà le canvas (le ciel).
   * `canvasScale` : pixels réels du canvas du ciel par pixel CSS. `time` en millisecondes.
   */
  render(camera: Camera, time: number, palette: Palette, canvasScale: number): void {
    const gl = this.gl;
    const o = this.options;
    const seconds = time / 1000;
    // Le disque tourne à la vitesse réglée ; en mouvement réduit, il est presque immobile.
    const dt = this.lastTime < 0 ? 0 : Math.min(0.1, seconds - this.lastTime);
    this.lastTime = seconds;
    this.diskTime += dt * o.spin * (this.reduceMotion ? 0.04 : 1);

    // Position du trou noir (centre du monde) vue depuis la caméra : mêmes formules que camera.ts.
    const cy = Math.cos(camera.yaw), sy = Math.sin(camera.yaw);
    const cp = Math.cos(camera.pitch), sp = Math.sin(camera.pitch);
    const toView = (x: number, y: number, z: number): [number, number, number] => {
      const x1 = x * cy - z * sy;
      const z1 = x * sy + z * cy;
      return [x1, y * cp + z1 * sp, -y * sp + z1 * cp];
    };
    const [t0, t1, t2] = camera.target;
    const hole = toView(-t0, -t1, -t2);
    hole[2] += camera.distance; // profondeur devant la caméra
    if (hole[2] + LENS_EXTENT * RS < 1) return; // tout est derrière la caméra

    // Taille de la cible des rayons (résolution de la qualité choisie).
    const q = QUALITY[o.quality];
    const scale = canvasScale * q.scale;
    const w = Math.max(1, Math.round(camera.width * scale));
    const h = Math.max(1, Math.round(camera.height * scale));
    this.resize(w, h);

    // Carré utile autour du trou noir, en pixels de la cible (plein écran si on est tout près).
    const focal = camera.focal * scale;
    const optic: [number, number] = [(camera.width / 2 + camera.offsetX) * scale, (camera.height / 2) * scale];
    const near = hole[2] - LENS_EXTENT * RS;
    let center: [number, number] = [w / 2, h / 2];
    let bound = Math.hypot(w, h);
    if (near > 1) {
      center = [optic[0] + (hole[0] * focal) / hole[2], optic[1] + (hole[1] * focal) / hole[2]];
      bound = (LENS_EXTENT * RS * focal) / near;
      // Hors de l'écran : rien à calculer.
      if (Math.abs(center[0] - w / 2) > w / 2 + bound || Math.abs(center[1] - h / 2) > h / 2 + bound) return;
    }

    // Axe du disque : vertical, incliné de `tilt` degrés autour de l'axe x du monde.
    const tilt = (o.tilt * Math.PI) / 180;
    const normal = toView(0, Math.cos(tilt), Math.sin(tilt));
    const basis = toView(1, 0, 0);
    this.refreshColors(palette);

    gl.bindVertexArray(this.vao);
    gl.disable(gl.BLEND);
    // 1. Les rayons, dans le carré autour du trou noir.
    this.bindTarget(this.targets[0]);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const r = this.ray;
    gl.useProgram(r.program);
    gl.uniform2f(r.uniform("uCenter"), center[0], center[1]);
    gl.uniform1f(r.uniform("uBound"), bound);
    gl.uniform2f(r.uniform("uTarget"), w, h);
    gl.uniform2f(r.uniform("uOptic"), optic[0], optic[1]);
    gl.uniform1f(r.uniform("uFocal"), focal);
    gl.uniform3f(r.uniform("uOrigin"), -hole[0] / RS, -hole[1] / RS, -hole[2] / RS);
    gl.uniform3fv(r.uniform("uNormal"), normal);
    gl.uniform3fv(r.uniform("uBasis"), basis);
    gl.uniform1f(r.uniform("uTime"), this.diskTime % 10000);
    gl.uniform1f(r.uniform("uSeed"), 1.73);
    gl.uniform1f(r.uniform("uLens"), o.lens);
    // Pulsation discrète de la luminosité (aucune en mouvement réduit).
    const pulse = this.reduceMotion ? 1 : 1 + 0.05 * Math.sin(seconds * 1.1);
    gl.uniform1f(r.uniform("uBright"), o.brightness * pulse);
    gl.uniform1i(r.uniform("uSteps"), q.steps);
    gl.uniform1f(r.uniform("uStepScale"), 176 / q.steps);
    gl.uniform3fv(r.uniform("uHot"), this.colors.hot);
    gl.uniform3fv(r.uniform("uMid"), this.colors.mid);
    gl.uniform3fv(r.uniform("uDeep"), this.colors.deep);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // 2. Le halo : les zones très claires, floutées au tiers puis au douzième de la taille.
    const b = this.blur;
    gl.useProgram(b.program);
    gl.uniform1i(b.uniform("uInput"), 0);
    for (const [from, to, dx, dy, extract] of [
      [0, 1, 1, 0, true],
      [1, 2, 0, 1, false],
      [2, 3, 1, 0, false],
      [3, 4, 0, 1, false],
    ] as const) {
      this.bindTarget(this.targets[to]);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.targets[from].texture);
      gl.uniform2f(b.uniform("uDirection"), dx / this.targets[to].w, dy / this.targets[to].h);
      gl.uniform1i(b.uniform("uExtract"), extract ? 1 : 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    // 3. Composition sur le canvas, par-dessus le ciel.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    const c = this.composite;
    gl.useProgram(c.program);
    for (const [unit, index, name] of [
      [0, 0, "uScene"],
      [1, 2, "uBloom"],
      [2, 4, "uWide"],
    ] as const) {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, this.targets[index].texture);
      gl.uniform1i(c.uniform(name), unit);
    }
    gl.uniform1f(c.uniform("uHalo"), o.halo);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.disable(gl.BLEND);
    gl.activeTexture(gl.TEXTURE0);
  }

  /** Libère programmes, textures et cibles (le contexte, lui, appartient au ciel). */
  dispose(): void {
    const gl = this.gl;
    if (gl.isContextLost()) return;
    gl.deleteVertexArray(this.vao);
    for (const p of [this.ray, this.blur, this.composite]) gl.deleteProgram(p.program);
    for (const t of this.targets) {
      gl.deleteTexture(t.texture);
      gl.deleteFramebuffer(t.framebuffer);
    }
    this.targets = [];
  }

  // --- Interne ----------------------------------------------------------------------------

  /** Couleurs du disque tirées du thème : blanc chaud (étoiles), doré (accent), et sa teinte profonde. */
  private refreshColors(p: Palette): void {
    const key = `${p.star}|${p.starAccent}`;
    if (key === this.colorKey) return;
    this.colorKey = key;
    const rgb = (value: string) => value.split(",").map((x) => Number(x) / 255);
    const hot = rgb(p.star);
    const mid = rgb(p.starAccent);
    // Teinte profonde : l'accent assombri vers le rouge (plus de rouge que de vert, peu de bleu).
    const deep = mid.map((v, i) => Math.pow(v, [1.2, 2.6, 4][i]));
    this.colors = { hot, mid, deep };
  }

  /** (Re)dimensionne les cibles : la première à la taille donnée, les autres réduites. */
  private resize(w: number, h: number): void {
    const gl = this.gl;
    this.targets.forEach((t, i) => {
      const divisor = i === 0 ? 1 : i > 2 ? 12 : 3;
      const tw = Math.max(1, Math.ceil(w / divisor));
      const th = Math.max(1, Math.ceil(h / divisor));
      if (t.w === tw && t.h === th) return;
      t.w = tw;
      t.h = th;
      gl.bindTexture(gl.TEXTURE_2D, t.texture);
      if (this.hdr) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, tw, th, 0, gl.RGBA, gl.HALF_FLOAT, null);
      else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, tw, th, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, t.framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t.texture, 0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error("trou noir : cible de rendu incomplète");
    });
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  private bindTarget(t: Target): void {
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, t.framebuffer);
    this.gl.viewport(0, 0, t.w, t.h);
  }

  /** Compile et relie un programme ; en cas d'échec, l'erreur contient le message du shader. */
  private program(vertex: string, fragment: string, made: WebGLProgram[]): Program {
    const gl = this.gl;
    const program = gl.createProgram();
    made.push(program);
    for (const [type, source] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]] as const) {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS) && !gl.isContextLost()) {
        const log = gl.getShaderInfoLog(shader);
        gl.deleteShader(shader);
        throw new Error(`shader du trou noir : ${log}`);
      }
      gl.attachShader(program, shader);
      gl.deleteShader(shader);
    }
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS) && !gl.isContextLost()) {
      throw new Error(`programme du trou noir : ${gl.getProgramInfoLog(program)}`);
    }
    const cache = new Map<string, WebGLUniformLocation | null>();
    return {
      program,
      uniform(name: string) {
        if (!cache.has(name)) cache.set(name, gl.getUniformLocation(program, name));
        return cache.get(name)!;
      },
    };
  }
}
