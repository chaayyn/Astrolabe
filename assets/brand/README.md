# Identité visuelle d'Astrolabe

Palette : noir `#000000`, blanc chaud `#F4EFE6`, or `#C9A25B`, quasi-noir `#0B0B0C` (version sur fond clair).

| Fichier | Usage |
| --- | --- |
| `icon.svg` | Icône de l'application : carré plein sur fond noir, sans coins arrondis (le système applique son masque). |
| `symbol-on-dark.svg` | Symbole seul, fond transparent, pour fonds sombres. |
| `symbol-on-light.svg` | Symbole seul, fond transparent, pour fonds clairs. |
| `symbol-small.svg` | Version à trait épais pour les très petites tailles (16 à 32 px). |
| `lockup-on-dark.svg` | Symbole + mot « Astrolabe », fond transparent, pour fonds sombres. |
| `lockup-on-light.svg` | Symbole + mot « Astrolabe », fond transparent, pour fonds clairs. |

Le texte du logotype est converti en tracés : aucune police n'est nécessaire.

## Icônes PNG

Electron n'accepte pas le SVG pour l'icône de fenêtre : les PNG de `png/` sont fabriqués à
partir des SVG par la commande

```bash
npm run icons
```

(script `scripts/make-icons.cjs`, sans dépendance : Electron affiche chaque SVG dans une
fenêtre invisible et en fait une capture). Tailles : 16, 32, 48, 64, 128, 256, 512 et 1024 px,
fichiers `png/icon-<taille>.png`. À relancer si un SVG change.

**Règle des petites tailles :** jusqu'à 32 px, on utilise `symbol-small.svg` (trait épais) posé
sur fond noir ; au-delà, `icon.svg`. Dans l'app, l'en-tête de la barre latérale (18 px) et
l'icône de la page utilisent aussi `symbol-small.svg` ; la fenêtre utilise `png/icon-512.png`.

