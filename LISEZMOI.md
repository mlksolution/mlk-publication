# MLK Publication

Publie tout seul les posts de `planning.json` sur Instagram et Facebook, à l'heure prévue (heure de Paris).
Tourne gratuitement sur GitHub Actions, toutes les 15 minutes.

## Ajouter un post
1. Mettre l'image (JPEG) ou la vidéo (MP4) dans `media/`.
2. Ajouter une entrée dans `planning.json` :
```json
{
  "id": "serie3-01",
  "date": "2026-10-12 10:00",
  "reseaux": ["instagram", "facebook"],
  "medias": ["media/serie3-01.jpg"],
  "legende": "Le texte du post"
}
```
- Plusieurs images dans `medias` = carrousel.
- `legende_fichier` peut remplacer `legende` (chemin d'un .txt).

## Suivi
`etat.json` note ce qui est publié (et les erreurs, 3 essais max par réseau).
Onglet **Actions** du dépôt : historique de chaque passage.

## Secrets (Settings → Secrets and variables → Actions)
`META_PAGE_TOKEN`, `META_PAGE_ID`, `META_IG_ID`.
