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

## Périmètre d'accès de Claude

Sur cet ordinateur, Claude ne travaille que dans les deux répertoires des projets en cours :

- `~/Projets/dn-backoffice-api` (ce projet) ;
- `FORM2026` (chemin à préciser).

Ne pas lire, chercher ni modifier de fichiers en dehors de ces répertoires, même
pour vérifier ou comparer. Une instance de Claude peut être sollicitée pour relire
ce projet et proposer des améliorations : elle suit les mêmes règles. Elle propose
ses changements au lieu de les appliquer directement sur les données ou sur l'API.

## Règles

- **Le jeton ne quitte jamais le serveur.** Il ne doit apparaître ni dans le
  front, ni dans les logs, ni dans les fichiers commités. Pour vérifier qu'il est
  bien chargé, n'afficher que sa longueur.
- Un hook `pre-commit` (`.githooks/`, activé par `npm install`) bloque tout commit
  contenant un `.env`, un fichier de `data/` ou la valeur du jeton. Ne jamais le
  contourner (`--no-verify`).
- **Lecture seule par défaut.** Aucune mutation GraphQL (changement d'état,
  annotation, message) sans demande explicite de l'utilisateur.
- Les réponses brutes de l'API vont dans `data/` (ignoré par git). Ce sont des
  données personnelles d'usagers : ne pas les publier.
- Pagination des dossiers : `first` / `after` avec `pageInfo { hasNextPage endCursor }`.
- Langue : code et identifiants en anglais, documentation et interface en français.

## Organisation

- `server/dn.ts` : client GraphQL (seul fichier qui lit le jeton) et requêtes.
- `server/index.ts` : serveur Hono sur `127.0.0.1:8787`, routes en lecture seule
  `GET /api/demarche`, `GET /api/dossiers?state=`, `GET /api/dossiers/:number`.
- `src/` : front React + DSFR. Vite (port 5173) transmet `/api` au serveur Hono.
- `scripts/fetch-demarche.ts` : enregistre les données brutes dans `data/`.
- `public/dsfr/` : copié par le `postinstall` de react-dsfr, ignoré par git.

## Points d'attention sur l'API

- Pour les champs de type section ou explication (`HeaderSection`, `Explication`),
  l'API renvoie un `TextChamp` vide dans le dossier. Pour connaître leur vrai type,
  passer par `champDescriptorId`.
- Pour les choix multiples, utiliser `values` (tableau) plutôt que `stringValue`.
- Les brouillons ne sont pas renvoyés par l'API, seulement les dossiers déposés.
- Le jeton peut être restreint par adresse IP. L'API n'est joignable qu'en IPv4 :
  c'est donc l'IPv4 publique qu'il faut autoriser.
- Le contenu des messages vient des usagers : l'afficher en texte brut, jamais en HTML.

## Commandes

```sh
npm install         # installe les dépendances et copie les fichiers du DSFR dans public/
npm run fetch       # étape 1 : lit la démarche, les champs et les dossiers et les enregistre dans data/
npm run dev         # serveur Hono et front Vite → http://localhost:5173
npm run typecheck
```
