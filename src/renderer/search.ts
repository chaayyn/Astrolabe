// Recherche de notes : insensible à la casse et aux accents, triée par pertinence simple
// (titre > nom > tags > dossier > texte), avec un extrait du texte où le mot est surligné.
import type { Note } from "../shared/note";

/** Un résultat de recherche. */
export interface SearchHit {
  note: Note;
  score: number;
  /** Extrait du texte autour du mot trouvé (ou début de la note). */
  snippet: string;
}

const MAX_RESULTS = 8;
const SNIPPET_LENGTH = 90;

/**
 * "Replie" un texte pour comparer sans casse ni accents : "Décisions" → "decisions".
 * Renvoie aussi, pour chaque lettre repliée, sa position dans le texte d'origine
 * (utile pour surligner au bon endroit dans le texte original).
 */
export function fold(text: string): { folded: string; map: number[] } {
  let folded = "";
  const map: number[] = [];
  for (let i = 0; i < text.length; i++) {
    // NFD sépare la lettre de son accent ("é" → "e" + accent), puis on retire les accents.
    const part = text[i].normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
    for (const ch of part) {
      folded += ch;
      map.push(i);
    }
  }
  return { folded, map };
}

/** Cherche `query` dans les notes ; au plus 8 résultats, les plus pertinents d'abord. */
export function search(notes: Note[], query: string): SearchHit[] {
  const q = fold(query.trim()).folded;
  if (q === "") return [];

  const hits: SearchHit[] = [];
  for (const note of notes) {
    const title = fold(note.title).folded;
    const name = fold(note.name).folded;
    const text = fold(note.text);
    const textAt = text.folded.indexOf(q);

    // Score selon l'endroit où le mot apparaît (le meilleur endroit compte).
    let score = 0;
    if (title.includes(q)) score = title.startsWith(q) ? 120 : 100;
    else if (name.includes(q)) score = 80;
    else if (note.tags.some((t) => fold(t).folded.includes(q))) score = 60;
    else if (fold(note.folder).folded.includes(q)) score = 40;
    else if (textAt >= 0) score = 20;
    if (score === 0) continue;
    // Petit bonus si le mot revient souvent dans le texte (plafonné).
    if (textAt >= 0) score += Math.min(10, text.folded.split(q).length - 1);

    hits.push({ note, score, snippet: makeSnippet(note.text, text, textAt, q.length) });
  }
  return hits.sort((a, b) => b.score - a.score || a.note.title.localeCompare(b.note.title)).slice(0, MAX_RESULTS);
}

/** Extrait d'environ 90 caractères centré sur le mot trouvé, ou début du texte. */
function makeSnippet(original: string, text: ReturnType<typeof fold>, at: number, length: number): string {
  if (at < 0) return original.slice(0, SNIPPET_LENGTH) + (original.length > SNIPPET_LENGTH ? "…" : "");
  const start = Math.max(0, text.map[at] - 30);
  const end = Math.min(original.length, text.map[Math.min(at + length, text.map.length - 1)] + SNIPPET_LENGTH - 30);
  return (start > 0 ? "…" : "") + original.slice(start, end) + (end < original.length ? "…" : "");
}

/**
 * Construit des éléments où chaque apparition de `query` (sans casse ni accents)
 * est entourée d'un <mark>. Tout passe par textContent : pas d'injection HTML.
 */
export function highlight(text: string, query: string): Node[] {
  const q = fold(query.trim()).folded;
  if (q === "") return [document.createTextNode(text)];
  const { folded, map } = fold(text);
  const nodes: Node[] = [];
  let last = 0; // position dans le texte d'origine jusqu'où on a déjà ajouté
  let from = 0;
  for (let at = folded.indexOf(q, from); at >= 0; at = folded.indexOf(q, from)) {
    const start = map[at];
    const end = map[at + q.length - 1] + 1;
    if (start > last) nodes.push(document.createTextNode(text.slice(last, start)));
    const mark = document.createElement("mark");
    mark.textContent = text.slice(start, end);
    nodes.push(mark);
    last = end;
    from = at + q.length;
  }
  if (last < text.length) nodes.push(document.createTextNode(text.slice(last)));
  return nodes;
}
