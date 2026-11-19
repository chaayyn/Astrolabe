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
  },
});
