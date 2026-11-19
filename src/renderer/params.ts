// Réglages : de petites "fiches" qui décrivent un réglage (curseur, couleur, case, choix).
// Le moteur et chaque scène déclarent leurs fiches ; le panneau Paramètres les lit et
// fabrique les champs tout seul, sans rien savoir d'une scène en particulier.

interface ParamBase {
  /** Identifiant stable (sert à la mémorisation), ex. "stars.glow". */
  id: string;
  /** Texte affiché à côté du champ. */
  label: string;
  /** Groupe du panneau où il apparaît, ex. "Étoiles". */
  group: string;
}

/** Curseur numérique. */
export interface SliderParam extends ParamBase {
  type: "slider";
  min: number;
  max: number;
  step: number;
  /** Unité affichée après la valeur ("×", "%", "px"…). */
  unit?: string;
  default: number;
}

/** Case à cocher. */
export interface ToggleParam extends ParamBase {
  type: "toggle";
  default: boolean;
}

/** Choix parmi une liste. */
export interface ChoiceParam extends ParamBase {
  type: "choice";
  options: { value: string; label: string }[];
  default: string;
}

/** Couleur (format "#rrggbb"). */
export interface ColorParam extends ParamBase {
  type: "color";
  default: string;
}

export type ParamDef = SliderParam | ToggleParam | ChoiceParam | ColorParam;
export type ParamValue = number | boolean | string;
export type ParamValues = Record<string, ParamValue>;

/** Valeurs par défaut d'une liste de fiches. */
export function defaultsOf(defs: readonly ParamDef[]): ParamValues {
  return Object.fromEntries(defs.map((d) => [d.id, d.default]));
}

/**
 * Vérifie une valeur venue du fichier de réglages (ou d'un champ) pour une fiche :
 * renvoie une valeur sûre (bornée, du bon type), ou `undefined` si elle est inutilisable.
 */
export function sanitize(def: ParamDef, value: unknown): ParamValue | undefined {
  switch (def.type) {
    case "slider": {
      const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
      if (!Number.isFinite(n)) return undefined;
      const stepped = Math.round((n - def.min) / def.step) * def.step + def.min;
      return Math.min(def.max, Math.max(def.min, Number(stepped.toFixed(6))));
    }
    case "toggle":
      return typeof value === "boolean" ? value : undefined;
    case "choice":
      return typeof value === "string" && def.options.some((o) => o.value === value) ? value : undefined;
    case "color":
      return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : undefined;
  }
}

/** Fusionne des valeurs mémorisées avec les valeurs par défaut ; l'inconnu et l'invalide sont ignorés. */
export function resolveValues(defs: readonly ParamDef[], saved: Record<string, unknown> | undefined): ParamValues {
  const values = defaultsOf(defs);
  for (const def of defs) {
    const v = sanitize(def, saved?.[def.id]);
    if (v !== undefined) values[def.id] = v;
  }
  return values;
}
