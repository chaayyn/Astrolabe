# Thèmes d'Astrolabe

Un thème = un dossier ici, avec deux fichiers : `manifest.json` et `theme.css`.

**Créer un thème**

1. Copier un dossier existant (par exemple `ambre/`) et le renommer, par exemple `ocean/`. Lettres, chiffres et tirets seulement.
2. Dans `manifest.json` : mettre `"id": "ocean"` (identique au nom du dossier), un `name` et une `version`. Les champs `author` et `description` sont facultatifs. `style` donne le nom du fichier CSS, `theme.css` par défaut. `scene` (facultatif) nomme la scène qui dessine le graphe, parmi celles livrées avec l'app (aujourd'hui : `classique`, utilisée aussi si le champ est absent, et `galaxie`, le même dessin devant un ciel profond calculé par la carte graphique ; sans WebGL2, `galaxie` se replie sur `classique`).
3. Dans `theme.css` : changer les valeurs des variables `--sc-*`. Ne redéfinir que des variables : la mise en page reste celle de l'app.
4. Le choisir dans l'app : Paramètres (touche ,), section « Thème ». Chaque modification du fichier s'applique tout de suite, sans relancer.

**Variables disponibles**

- Interface : `--sc-bg`, `--sc-surface` (fond des barres, tiroirs et fenêtres), `--sc-text`, `--sc-text-muted`, `--sc-text-dim`, `--sc-text-faint` (trois niveaux de gris), `--sc-hairline` (filets), `--sc-border`, `--sc-border-strong` (contours), `--sc-hover`, `--sc-focus` (anneau du focus clavier), `--sc-accent` (le seul accent coloré : repère de l'élément actif et données), `--sc-accent-soft`, `--sc-backdrop` (derrière les fenêtres), `--sc-shadow` (lisibilité du texte posé sur le ciel).
- Graphe : `--sc-sky` (ciel), `--sc-star`, `--sc-star-accent`, `--sc-link`, `--sc-orbit`, `--sc-label`. Ciel de la scène `galaxie` : `--sc-nebula` (nuage de la nébuleuse), `--sc-nebula-glow` (reflets froids) ; il utilise aussi `--sc-sky`, `--sc-star` et `--sc-star-accent`.
- Texte : `--sc-font-display`, `--sc-font-mono` (polices installées sur l'ordinateur), `--sc-weight-regular`, `--sc-weight-bold`, `--sc-size-label`, `--sc-size-body`, `--sc-size-lead`, `--sc-size-title`, `--sc-size-figure`, `--sc-tracking-tight`.
- Formes : `--sc-radius` (coins), `--sc-border-width`, `--sc-control` (côté des petits boutons carrés).
- Espaces et mouvement : `--sc-space-1` à `--sc-space-5`, `--sc-edge`, `--sc-sidebar-width`, `--sc-drawer-width`, `--sc-drawer-wide`, `--sc-fade`, `--sc-fade-slow`.

Un thème invalide est ignoré, avec un message dans la console de l'app.
