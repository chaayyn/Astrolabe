// Registre des scènes livrées avec l'app : nom (celui du champ "scene" d'un manifest) → fabrique.
// Un thème ne fait que NOMMER une scène : aucun code n'est jamais chargé depuis le dossier themes/.
import { ClassicScene } from "./classic/classic-scene";
import { GalaxieScene } from "./galaxie/galaxie-scene";
import type { Scene } from "./scene";

/** Scène par défaut, et repli si un thème demande une scène inconnue. */
export const DEFAULT_SCENE = "classique";

const SCENES: Record<string, () => Scene> = {
  classique: () => new ClassicScene(),
  galaxie: () => new GalaxieScene(), // ciel WebGL2 + dessin classique par-dessus
};

/** Fabrique la scène demandée ; si le nom est absent ou inconnu, la scène classique. */
export function createScene(name: string | undefined): Scene {
  const key = name ?? DEFAULT_SCENE;
  const make = SCENES[key];
  if (make) return make();
  console.warn(`[scènes] scène "${key}" inconnue : repli sur "${DEFAULT_SCENE}".`);
  return SCENES[DEFAULT_SCENE]();
}

/** Nom réellement utilisé pour une demande (pour savoir s'il faut changer de scène). */
export function resolveSceneName(name: string | undefined): string {
  return name && name in SCENES ? name : DEFAULT_SCENE;
}
