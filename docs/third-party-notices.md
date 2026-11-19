# Licences des œuvres tierces

Astrolabe reprend et adapte du code d'un projet tiers, publié sous licence MIT.

## second-brain-black-hole

- Auteur : williamwasen
- Projet : second-brain-black-hole (dépôt GitHub `williamwasen/second-brain-black-hole`)
- Licence : MIT (texte complet ci-dessous, recopié tel quel depuis le fichier `LICENSE` du dépôt)

Fichiers d'Astrolabe adaptés de ce projet :

- `src/renderer/scenes/galaxie/sky.ts` — adapté de `src/sky.js` (formules de la nébuleuse procédurale, bruit, grille d'étoiles, calcul des météores, rendu plein écran du ciel).
- `src/renderer/scenes/galaxie/accretion.ts` — adapté de `src/accretion.js` (rayons lumineux courbés par le trou noir, disque d'accrétion procédural, halo en passes de flou, composition et mappage des tons), avec la logique de lentille de `src/lensing.js` (zone limitée autour du trou noir, rayon de l'ombre).
- `src/renderer/scenes/galaxie/lens.ts` — adapté de `src/lensing.js` (modèle de lentille ponctuelle : rayon d'Einstein, image principale et image secondaire, étirement en arc).
- `src/renderer/scenes/galaxie/stars.ts` — adapté de `src/blackhole.js` et `src/lensing.js` (style des étoiles : cœur, halo, vague de scintillement ; liens et lumières qui voyagent ; orbes de sections ; comètes ; étoiles étirées par la lentille).

Autres inspirations, sans code repris : le plugin Obsidian « Rho Network » (ambiance générale : trou noir au centre, dossiers en orbites, notes en étoiles), pour la seule direction visuelle.

```
MIT License

Copyright (c) 2026 williamwasen

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
