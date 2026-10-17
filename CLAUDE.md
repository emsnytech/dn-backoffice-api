# dn-backoffice-api

Back office indépendant pour instruire les dossiers d'une démarche
[Démarche Numérique](https://demarche.numerique.gouv.fr) (ex-Démarches Simplifiées),
branché uniquement sur son API GraphQL v2. Pour l'instant, une seule démarche
de test est configurée.

## Objectif

1. **Étape 1 (en cours)** : un script lit la démarche, son descriptif de champs
   (`champDescriptors`, `annotationDescriptors`) et la liste de ses dossiers.
   On vérifie que ces données sont lues correctement.
2. **Étape 2** : une interface web d'instruction (liste, filtres, détail d'un
   dossier). On ne la commence qu'une fois l'étape 1 validée.

## Stack

- Node 24 et TypeScript, exécuté nativement (`node --env-file=.env fichier.ts`,
  sans étape de build pour les scripts).
- `fetch` natif pour GraphQL. Pas de client GraphQL tant que ce n'est pas nécessaire.
- Étape 2 : serveur **Hono** qui sert d'intermédiaire avec l'API, et front
  **React + Vite + DSFR** (`@codegouvfr/react-dsfr`).

## Configuration (`.env`, jamais commité)

| Variable             | Rôle                                                    |
|----------------------|---------------------------------------------------------|
| `DN_DEMARCHE_NUMBER` | Numéro de la démarche                                   |
| `DN_API_TOKEN`       | Jeton d'API (profil instructeur/administrateur)         |
| `DN_API_URL`         | Optionnel, par défaut `https://demarche.numerique.gouv.fr/api/v2/graphql` |

Authentification : en-tête `Authorization: Bearer <DN_API_TOKEN>`.

## Règles

- **Le jeton ne quitte jamais le serveur.** Il ne doit apparaître ni dans le
  front, ni dans les logs, ni dans les fichiers commités. Pour vérifier qu'il est
  bien chargé, n'afficher que sa longueur.
- **Lecture seule par défaut.** Aucune mutation GraphQL (changement d'état,
  annotation, message) sans demande explicite de l'utilisateur.
- Les réponses brutes de l'API vont dans `data/` (ignoré par git). Ce sont des
  données personnelles d'usagers : ne pas les publier.
- Pagination des dossiers : `first` / `after` avec `pageInfo { hasNextPage endCursor }`.
- Langue : code et identifiants en anglais, documentation et interface en français.

## Commandes

```sh
node --env-file=.env scripts/fetch-demarche.ts   # étape 1 : lit la démarche, les champs et les dossiers
```
