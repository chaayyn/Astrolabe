# Astrolabe

Astrolabe est une application de bureau locale qui affiche un coffre de notes Markdown
(compatible Obsidian) comme une galaxie en 3D : chaque note est une étoile, les liens entre
notes sont des traits, chaque dossier forme une orbite autour d'un trou noir central.

- **Scène « galaxie »** : ciel profond, nébuleuse et trou noir calculés par la carte graphique
  (WebGL2 : disque d'accrétion, lentille gravitationnelle, halo). Sans WebGL2, une scène
  « classique » en 2D prend le relais.
- **Thèmes** : couleurs, polices et scène choisies par simples fichiers CSS.
- **Entièrement local** : aucune connexion réseau, aucun compte, aucune IA. Les notes ne sont
  jamais modifiées : l'app les lit seulement.

## Lancer

Il faut [Node.js](https://nodejs.org/) (version récente).

```bash
npm install      # une seule fois : installe les outils (Electron, Vite, TypeScript)
npm run dev      # lance l'app en mode développement
npm run build    # compile l'app dans dist/
```

## Vos notes

Placez vos notes dans un dossier `vault/` à la racine du projet (des fichiers `.md`, rangés
dans des sous-dossiers si vous le souhaitez). Ce dossier n'est **pas** livré avec le dépôt :
créez le vôtre, ou copiez-y un coffre Obsidian existant. L'app suit les modifications en direct.
S'il manque, l'app l'indique simplement.

Les réglages (thème choisi, couleurs, curseurs) sont rangés dans le dossier de données de
l'app (`~/.config/astrolabe` sous Linux), jamais dans le coffre.

## Raccourcis

`H` ouvre l'Accueil et la recherche, `,` les Paramètres, `B` replie la barre latérale.
La liste complète s'affiche avec `?` dans l'app.

## Thèmes

Pour créer un thème, voir [`themes/README.md`](themes/README.md).

## Crédits

La scène « galaxie » (ciel et trou noir) est adaptée du projet
[second-brain-black-hole](https://github.com/williamwasen/second-brain-black-hole) de
williamwasen, sous licence MIT. Détails et texte de la licence :
[`THIRD_PARTY_LICENSES.md`](THIRD_PARTY_LICENSES.md).
