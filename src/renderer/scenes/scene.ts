// Le contrat entre le MOTEUR et une SCÈNE.
//
// Le moteur (engine.ts) calcule tout ce qui ne dépend pas du style : positions des étoiles,
// caméra, projection à l'écran, survol, clic, vol de caméra, noms des notes.
// Une scène ne fait que DESSINER : le ciel, l'objet central, les étoiles, les liens, les anneaux.
// Chaque thème choisit sa scène par son nom (champ "scene" du manifest.json).
import type { Camera, Projected } from "../camera";
import type { GraphEdge, GraphNode, Orbit } from "../graph";
import type { Palette } from "../palette";
import type { ParamDef, ParamValues } from "../params";

export type { Palette };

/** Les données du graphe, telles que le moteur les tient à jour (positions comprises). */
export interface SceneGraph {
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
  readonly orbits: readonly Orbit[];
  /** Rayon de l'orbite la plus éloignée (sert à doser la profondeur). */
  readonly outerRadius: number;
}

/** Ce que le moteur donne à la scène pour dessiner une image. */
export interface SceneFrame {
  /** Temps en millisecondes (horloge de requestAnimationFrame). */
  time: number;
  /** Caméra : taille de l'écran, orientation, et `project()` pour placer un point 3D. */
  camera: Camera;
  /** Position à l'écran de chaque étoile, déjà calculée par le moteur pour cette image. */
  screen: ReadonlyMap<GraphNode, Projected>;
  /** Étoile mise en évidence (survol, panneau ou sélection), ou `null`. */
  highlighted: GraphNode | null;
  /** Dossier choisi dans Home : son orbite reste éclairée. */
  selectedFolder: string | null;
}

/** Une scène : quatre gestes, toujours dans cet ordre de vie, plus ses réglages. */
export interface Scene {
  /**
   * Les réglages propres à cette scène (curseurs, cases…), affichés par le panneau
   * Paramètres. Les valeurs par défaut doivent donner le rendu "normal" de la scène.
   */
  readonly params: readonly ParamDef[];
  /**
   * Reçoit les valeurs courantes de ses réglages (après init, puis à chaque changement).
   * Doit être léger : il est appelé à chaque cran d'un curseur, sans recréer la scène.
   */
  setParams(values: ParamValues): void;
  /** Crée ce qu'il faut pour dessiner (canvas, contextes) dans `layer`, avec les couleurs du thème. */
  init(layer: HTMLElement, palette: Palette): void;
  /** Les données ont changé (nouveau scan du coffre). */
  update(graph: SceneGraph): void;
  /** Dessine une image. La scène suit elle-même la taille de l'écran (frame.camera). */
  render(frame: SceneFrame): void;
  /** Libère tout : canvas retirés de la page, mémoire rendue. Aucune boucle ne doit rester. */
  dispose(): void;
}

/**
 * Opacité selon la profondeur : 1 au premier plan, de plus en plus pâle vers le fond.
 * Partagée par les scènes et par les noms des notes que dessine le moteur.
 */
export function depthFade(depth: number, camera: Camera, outerRadius: number): number {
  const range = Math.max(outerRadius, 200);
  const f = (depth - camera.distance) / range; // environ -1 (devant) à +1 (derrière)
  return Math.min(1, Math.max(0.25, 0.9 - 0.4 * f));
}
