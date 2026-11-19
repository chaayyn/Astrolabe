// Types partagés entre le process principal (qui lit les fichiers)
// et le renderer (qui les affiche). Ce fichier ne contient que des types :
// rien n'est exécuté, il disparaît à la compilation.

/** Une note du coffre, telle que l'app la comprend. */
export interface Note {
  /** Chemin relatif au coffre, avec des "/" : "Projets/Architecture.md". */
  path: string;
  /** Nom du fichier sans l'extension : "Architecture". C'est ce que vise un lien [[Architecture]]. */
  name: string;
  /** Dossier relatif au coffre : "Projets". Chaîne vide pour la racine. */
  folder: string;
  /** `title` du frontmatter s'il existe, sinon le nom du fichier. */
  title: string;
  /** Tags sans le "#", sans doublons : frontmatter `tags` + #tags du texte. */
  tags: string[];
  /** Cibles des liens [[...]], sans alias ni ancre, sans doublons : "Architecture". */
  links: string[];
  /** Date de dernière modification du fichier, en millisecondes depuis 1970. */
  modified: number;
  /**
   * Date de création, en millisecondes : celle du fichier si le disque la connaît,
   * sinon le champ `date` du frontmatter, sinon la date de modification.
   */
  created: number;
  /** Tâches ouvertes de la note : le texte des cases `- [ ]` non cochées. */
  tasks: string[];
  /** Nombre de sections : titres `##` et `###` (hors blocs de code). */
  sections: number;
  /** Texte de la note sans le frontmatter, espaces resserrés : sert à la recherche. */
  text: string;
}

/**
 * Résultat d'une lecture du coffre : soit les notes, soit un message d'erreur
 * lisible (ex. coffre introuvable). Le main ne plante jamais, il renvoie l'un ou l'autre.
 */
export type VaultResult = { ok: true; notes: Note[] } | { ok: false; error: string };

/** Ce que le preload expose à la page sous `window.vault`. */
export interface VaultApi {
  /** Lit tout le coffre maintenant. */
  scan(): Promise<VaultResult>;
  /**
   * Appelle `callback` à chaque changement dans le coffre, avec le nouveau résultat.
   * Renvoie une fonction à appeler pour se désabonner.
   */
  onChange(callback: (result: VaultResult) => void): () => void;
}
