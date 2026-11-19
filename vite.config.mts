import { defineConfig } from "vite";

// Vite ne s'occupe que de la page (le "renderer").
export default defineConfig({
  root: "src/renderer",
  // Chemins relatifs : nécessaire pour que la page buildée s'ouvre en file:// dans Electron.
  base: "./",
  server: { port: 5173, strictPort: true },
  build: {
    outDir: "../../dist/renderer",
    emptyOutDir: true,
    // Jamais d'image glissée dans la page en "data:" : la politique de sécurité (CSP) n'autorise
    // que les fichiers de l'app elle-même. Le logo reste donc un vrai fichier.
    assetsInlineLimit: 0,
  },
});
