# Lunemur — Boutique papier peint

Site vitrine statique (HTML/CSS/JS, sans build) pour la boutique **Lunemur**
(papier peint — gammes multiples + sur-mesure 100% personnalisé).

## Ouvrir et modifier

Aucune installation requise. Pour prévisualiser en local :

```bash
python3 -m http.server 8000
```

puis ouvrez `http://localhost:8000`.

## Structure

- `index.html` — toute la structure et le contenu (textes en français, facilement modifiables directement dans le HTML)
- `css/style.css` — couleurs, typographies, mise en page (variables CSS en haut du fichier pour changer la palette rapidement)
- `js/main.js` — menu mobile, effet header au scroll, formulaire de contact (front-end uniquement, sans backend)

## Personnaliser

- **Couleurs** : modifiez les variables `--bg`, `--accent`, `--ink` en haut de `css/style.css`.
- **Textes** : tout le contenu (gammes, FAQ, engagements) est directement dans `index.html`.
- **Images** : la photo du hero et de la section "sur-mesure" pointent vers des fichiers Google Drive
  (format `https://lh3.googleusercontent.com/d/<ID>=w...`). Remplacez ces URLs par vos propres visuels
  dès que possible — pour que l'image s'affiche pour tous les visiteurs, le fichier Drive doit être
  partagé en "Anyone with the link" (ou hébergez l'image ailleurs).
- **Gammes de produits** : les 6 cartes de la section "Nos gammes" utilisent des swatches en CSS
  (dégradés) plutôt que des photos, pour un rendu épuré et cohérent. Remplacez `.swatch-xxx` par
  `background-image` si vous avez de vraies photos de motifs.
- **Formulaire de contact** : actuellement front-end uniquement (aucun e-mail n'est envoyé). Branchez-le
  à un service (Formspree, Netlify Forms, etc.) ou à votre back-end quand vous serez prêt.
