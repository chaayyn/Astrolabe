// Lecture du coffre : parcourt le dossier, lit chaque .md et en extrait une `Note`.
// Lecture seule : ce module n'écrit jamais dans les fichiers.
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { Note, VaultResult } from "../shared/note";

/** Dossiers qu'on ne parcourt jamais (en plus de tout ce qui commence par "."). */
const IGNORED_DIRS = new Set(["node_modules"]);

/**
 * Lit tout le coffre situé dans `vaultDir`. Ne lève jamais d'exception :
 * renvoie les notes triées par chemin, ou un message d'erreur lisible.
 */
export async function scanVault(vaultDir: string): Promise<VaultResult> {
  try {
    const files = await listMarkdownFiles(vaultDir);
    // Un fichier peut disparaître entre le listing et sa lecture : on l'ignore simplement.
    const notes = (await Promise.all(files.map((file) => readNote(vaultDir, file).catch(() => null))))
      .filter((note): note is Note => note !== null);
    return { ok: true, notes: notes.sort((a, b) => a.path.localeCompare(b.path)) };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    // Dossier absent, ou chemin qui n'est pas un dossier (ex. ASTROLABE_VAULT vers un fichier).
    const error = code === "ENOENT" || code === "ENOTDIR" ? `Coffre introuvable : ${vaultDir}` : `Lecture du coffre impossible (${code ?? String(err)})`;
    return { ok: false, error };
  }
}

/** Liste récursivement les fichiers .md (chemins absolus). */
async function listMarkdownFiles(dir: string, isRoot = true): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    // Le coffre lui-même introuvable : vraie erreur. Un sous-dossier supprimé
    // pendant le parcours : on l'ignore.
    if (isRoot) throw err;
    return [];
  }
  const result: string[] = [];

  for (const entry of entries) {
    // Fichiers et dossiers cachés ignorés : couvre .obsidian/, .git/, .DS_Store...
    if (entry.name.startsWith(".")) continue;

    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name)) result.push(...(await listMarkdownFiles(full, false)));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
      result.push(full);
    }
  }
  return result;
}

/** Lit un fichier .md et construit la `Note` correspondante. */
async function readNote(vaultDir: string, file: string): Promise<Note> {
  const [text, info] = await Promise.all([readFile(file, "utf8"), stat(file)]);

  // Chemin relatif avec des "/" même sous Windows, pour rester comme Obsidian.
  const relPath = path.relative(vaultDir, file).split(path.sep).join("/");
  const name = path.basename(file, path.extname(file));
  const folder = path.posix.dirname(relPath) === "." ? "" : path.posix.dirname(relPath);

  const { data, body } = splitFrontmatter(text);
  const cleanBody = removeCode(body);

  const title = typeof data.title === "string" && data.title !== "" ? data.title : name;
  const frontTags = Array.isArray(data.tags) ? data.tags : typeof data.tags === "string" ? [data.tags] : [];

  return {
    path: relPath,
    name,
    folder,
    title,
    tags: unique([...frontTags.map((t) => t.replace(/^#/, "")), ...findTags(cleanBody)]),
    links: unique(findLinks(cleanBody)),
    modified: info.mtimeMs,
    created: creationDate(info.birthtimeMs, data.date, info.mtimeMs),
    tasks: findOpenTasks(body),
    sections: countSections(body),
    text: body.replace(/\s+/g, " ").trim(),
  };
}

/** Compte les titres de niveau 2 et 3 (`## ...`, `### ...`), sans ceux des blocs de code. */
function countSections(text: string): number {
  const withoutBlocks = text.replace(/```[\s\S]*?```/g, "");
  return [...withoutBlocks.matchAll(/^#{2,3}[ \t]+\S/gm)].length;
}

/**
 * Date de création : celle du fichier si le disque la fournit (ext4, APFS, NTFS : oui ;
 * certains disques réseau : 0), sinon `date` du frontmatter, sinon la date de modification.
 */
function creationDate(birthtime: number, frontDate: string | string[] | undefined, mtime: number): number {
  if (birthtime > 0) return birthtime;
  const parsed = typeof frontDate === "string" ? Date.parse(frontDate) : NaN;
  return Number.isNaN(parsed) ? mtime : parsed;
}

/**
 * Trouve les tâches ouvertes : lignes `- [ ] texte` (aussi `* [ ]` et `+ [ ]`, indentées ou non).
 * Les cases cochées `- [x]` sont ignorées, comme tout ce qui est dans un bloc ``` ```.
 */
function findOpenTasks(text: string): string[] {
  const withoutBlocks = text.replace(/```[\s\S]*?```/g, "");
  const tasks: string[] = [];
  for (const m of withoutBlocks.matchAll(/^[ \t]*[-*+] \[ \][ \t]+(.+)$/gm)) tasks.push(m[1].trim());
  return tasks;
}

// ---------------------------------------------------------------------------
// Frontmatter
// ---------------------------------------------------------------------------

/** Valeurs du frontmatter : texte simple, ou liste de textes. */
type Frontmatter = Record<string, string | string[]>;

/**
 * Sépare le frontmatter YAML (entre deux lignes "---" tout en haut) du reste.
 * Parseur volontairement minimal : il comprend `clé: valeur`, `clé: [a, b]`
 * et les listes sur plusieurs lignes (`- a`). Ça couvre le frontmatter usuel d'Obsidian.
 */
function splitFrontmatter(text: string): { data: Frontmatter; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!match) return { data: {}, body: text };

  const data: Frontmatter = {};
  let currentListKey: string | null = null; // clé dont on lit les lignes "- item"

  for (const line of match[1].split(/\r?\n/)) {
    const item = /^\s*-\s+(.*)$/.exec(line);
    if (item && currentListKey) {
      (data[currentListKey] as string[]).push(unquote(item[1]));
      continue;
    }

    const pair = /^([\w-]+)\s*:\s*(.*)$/.exec(line);
    if (!pair) continue;
    const [, key, raw] = pair;
    const value = raw.trim();

    if (value === "") {
      // "tags:" seul sur sa ligne : une liste suit.
      data[key] = [];
      currentListKey = key;
    } else if (value.startsWith("[") && value.endsWith("]")) {
      data[key] = value.slice(1, -1).split(",").map(unquote).filter((v) => v !== "");
      currentListKey = null;
    } else {
      data[key] = unquote(value);
      currentListKey = null;
    }
  }
  return { data, body: text.slice(match[0].length) };
}

/** Retire les espaces et les guillemets autour d'une valeur YAML. */
function unquote(value: string): string {
  return value.trim().replace(/^(["'])(.*)\1$/, "$2");
}

// ---------------------------------------------------------------------------
// Tags et liens
// ---------------------------------------------------------------------------

/** Enlève les blocs ``` ``` et le code `inline` : ce qui est dedans n'est ni tag ni lien. */
function removeCode(text: string): string {
  return text.replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]*`/g, "");
}

/**
 * Trouve les #tags du texte. Comme Obsidian : le # doit être en début de ligne
 * ou après un espace, et le tag ne peut pas être fait uniquement de chiffres.
 * "# Titre" n'est pas un tag (espace après le #).
 */
function findTags(text: string): string[] {
  const tags: string[] = [];
  for (const m of text.matchAll(/(?:^|\s)#([\p{L}\p{N}_\-/]+)/gu)) {
    if (!/^\d+$/.test(m[1])) tags.push(m[1]);
  }
  return tags;
}

/**
 * Trouve les liens [[...]] et ne garde que la note visée :
 * [[note|alias]] → "note", [[note#titre]] → "note", ![[image.png]] → "image.png".
 */
function findLinks(text: string): string[] {
  const links: string[] = [];
  for (const m of text.matchAll(/\[\[([^\]\n]+)\]\]/g)) {
    const target = m[1].split("|")[0].split("#")[0].trim();
    if (target !== "") links.push(target);
  }
  return links;
}

/** Supprime les doublons en gardant l'ordre. */
function unique(values: string[]): string[] {
  return [...new Set(values)];
}
