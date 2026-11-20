// Capture propre de la fenêtre d'Astrolabe (outil de développement, sans dépendance).
//
// Usage :
//   ASTROLABE_VAULT=/chemin/vers/notes npm run capture -- [--out fichier.png]
//                   [--size 1600x900] [--wait 6000] [--state graph|home|settings]
//
//   --out    fichier PNG (défaut : .local-review/captures/<état>-<date>.png)
//   --size   taille du contenu de la fenêtre, en pixels CSS (défaut 1600x900)
//   --wait   attente avant la photo, en ms, le temps que la disposition se stabilise (défaut 6000)
//   --state  graph = le graphe seul ; home = Accueil ouvert ; settings = Paramètres ouverts
//   --zoom   nombre de crans de zoom avant (touche +) : gros plan sur le trou noir (défaut 0)
//   --my-settings  reprendre VOS réglages (thème, couleurs, curseurs). Sans cette option, l'app
//                  part d'un profil vide et temporaire : les réglages PAR DÉFAUT du thème, sans
//                  compteur FPS ; les images sont donc reproductibles (README, image de partage).
//   --set    réglage=valeur, répétable, dans le profil temporaire seulement (jamais vos réglages),
//            par exemple --set hole.quality=high --set hole.brightness=2 ; theme=ambre change
//            de thème. Nombres, true/false ou texte.
//
// `npm run capture` compile d'abord l'app, puis lance la version compilée (dist/) dans un mode
// spécial (src/main/capture.ts) : la fenêtre est rendue HORS ÉCRAN (rien n'apparaît, le WebGL
// marche quand même), seul SON contenu est photographié, à la taille exacte, puis l'app quitte.
// Garde-fou : sans ASTROLABE_VAULT, rien ne démarre (on ne photographie jamais le vrai coffre).
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");

function fail(message) {
  console.error(`capture : ${message}`);
  process.exit(1);
}

if (!process.env.ASTROLABE_VAULT) {
  fail(
    "ASTROLABE_VAULT n'est pas défini. Indiquez le dossier de notes à photographier, par exemple :\n" +
      "  ASTROLABE_VAULT=/chemin/vers/notes npm run capture -- --state graph",
  );
}

// Lecture des options --nom valeur.
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
};
const state = option("state", "graph");
if (!["graph", "home", "settings"].includes(state)) fail(`--state doit valoir graph, home ou settings (reçu : ${state})`);
const size = /^(\d+)x(\d+)$/.exec(option("size", "1600x900"));
if (!size) fail("--size doit ressembler à 1600x900");
const wait = Number(option("wait", "6000"));
if (!Number.isFinite(wait) || wait < 0) fail("--wait doit être un nombre de millisecondes");
const stamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
const out = path.resolve(option("out", path.join(ROOT, ".local-review", "captures", `${state}-${stamp}.png`)));

const mySettings = args.includes("--my-settings");
const zoom = Number(option("zoom", "0"));
if (!Number.isInteger(zoom) || zoom < 0 || zoom > 40) fail("--zoom doit être un nombre entier de 0 à 40");
// Réglages imposés (--set clé=valeur), écrits dans le profil temporaire.
const params = {};
args.forEach((arg, i) => {
  if (arg !== "--set") return;
  const m = /^([\w.]+)=(.*)$/.exec(args[i + 1] ?? "");
  if (!m) fail("--set doit ressembler à hole.quality=high");
  const raw = m[2];
  params[m[1]] = raw === "true" ? true : raw === "false" ? false : raw !== "" && Number.isFinite(Number(raw)) ? Number(raw) : raw;
});
if (mySettings && Object.keys(params).length) fail("--set ne se combine pas avec --my-settings (vos réglages ne sont jamais modifiés)");
const request = { out, width: Number(size[1]), height: Number(size[2]), wait, state, mySettings, zoom, params };
console.log(`capture : ${state}, ${size[1]}x${size[2]}, ${mySettings ? "vos réglages" : "réglages par défaut (profil temporaire)"}`);
const env = { ...process.env, ASTROLABE_CAPTURE: JSON.stringify(request) };
delete env.VITE_DEV_SERVER_URL; // toujours la version compilée, sans serveur de développement

const electron = require("electron"); // depuis Node, ce module donne le chemin du programme Electron
const result = spawnSync(electron, ["."], { cwd: ROOT, env, stdio: "inherit" });
process.exit(result.status ?? 1);
