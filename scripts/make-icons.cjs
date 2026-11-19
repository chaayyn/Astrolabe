// Fabrique les icônes PNG de l'application à partir des SVG de assets/brand/.
//
// Usage :  npm run icons
//          (équivaut à : electron scripts/make-icons.cjs)
//
// Pourquoi ce script : Electron (nativeImage) ne lit pas le SVG, il faut des PNG. Plutôt
// qu'un outil externe (ImageMagick dessine mal les contours SVG), on demande à Electron lui-même
// d'afficher chaque SVG dans une fenêtre invisible de la bonne taille, puis on photographie la
// page. Aucune dépendance en plus ; le résultat est identique à ce qu'affiche Chromium.
//
// Règle de lisibilité : jusqu'à 32 px, on part de symbol-small.svg (trait épais) posé sur un
// fond noir ; au-delà, de icon.svg. Les PNG vont dans assets/brand/png/icon-<taille>.png.
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const BRAND = path.join(__dirname, "..", "assets", "brand");
const OUT = path.join(BRAND, "png");
const SIZES = [16, 32, 48, 64, 128, 256, 512, 1024];
const SMALL_MAX = 32;

// Une image = un pixel pour un pixel : pas d'agrandissement selon l'écran.
app.commandLine.appendSwitch("force-device-scale-factor", "1");
app.disableHardwareAcceleration(); // rendu logiciel : même résultat sur toutes les machines
// Chaque taille a sa fenêtre, fermée aussitôt : l'app ne doit pas quitter entre deux.
app.on("window-all-closed", () => {});

/** Page HTML (en mémoire) qui affiche le SVG en plein cadre, sur fond noir. */
function page(svgFile, size) {
  const svg = fs.readFileSync(path.join(BRAND, svgFile), "utf8");
  const src = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
  const html = `<!doctype html><html><body style="margin:0;background:#000;overflow:hidden">
    <img src="${src}" width="${size}" height="${size}" style="display:block"></body></html>`;
  return `data:text/html;base64,${Buffer.from(html).toString("base64")}`;
}

app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  for (const size of SIZES) {
    const win = new BrowserWindow({
      width: size,
      height: size,
      useContentSize: true,
      show: false,
      frame: false,
      transparent: false,
      backgroundColor: "#000000",
      webPreferences: { offscreen: true },
    });
    win.setContentSize(size, size);
    await win.loadURL(page(size <= SMALL_MAX ? "symbol-small.svg" : "icon.svg", size));
    await new Promise((r) => setTimeout(r, 300)); // laisse le temps à l'image de s'afficher
    let image = await win.webContents.capturePage({ x: 0, y: 0, width: size, height: size });
    const got = image.getSize();
    if (got.width !== size || got.height !== size) image = image.resize({ width: size, height: size, quality: "best" });
    fs.writeFileSync(path.join(OUT, `icon-${size}.png`), image.toPNG());
    console.log(`icon-${size}.png (${size}×${size})`);
    win.destroy();
  }
  app.quit();
});
