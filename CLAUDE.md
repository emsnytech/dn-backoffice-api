# dn-backoffice-api

Back office indépendant pour instruire les dossiers d'une démarche
[Démarche Numérique](https://demarche.numerique.gouv.fr) (ex-Démarches Simplifiées),
branché uniquement sur son API GraphQL v2. Pour l'instant, une seule démarche
de test est configurée.

## Objectif

1. **Étape 1 (faite)** : un script lit la démarche, son descriptif de champs
   (`champDescriptors`, `annotationDescriptors`) et la liste de ses dossiers.
   On vérifie que ces données sont lues correctement.
2. **Étape 2 (faite)** : une interface web en lecture (liste, filtres, détail d'un dossier).
3. **Étape 3 (en test)** : un tableau kanban d'instruction. On fait glisser un dossier
   d'une colonne à l'autre pour changer son état dans Démarche Numérique.

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
| `DN_INSTRUCTEUR_EMAIL` | Optionnel. Instructeur au nom duquel les changements d'état sont faits (par défaut, l'unique instructeur de la démarche) |

Authentification : en-tête `Authorization: Bearer <DN_API_TOKEN>`.

## Périmètre d'accès de Claude

Sur cet ordinateur, Claude ne travaille que dans les deux répertoires des projets en cours :

- `~/Projets/dn-backoffice-api` (ce projet) ;
- `FORM2026` (chemin à préciser).

Ne pas lire, chercher ni modifier de fichiers en dehors de ces répertoires, même
pour vérifier ou comparer. Une instance de Claude peut être sollicitée pour relire
ce projet et proposer des améliorations : elle suit les mêmes règles. Elle propose
ses changements au lieu de les appliquer directement sur les données ou sur l'API.

`.claude/settings.json` (versionné) interdit à toute session de Claude de lire ou de
modifier `.env` et `data/`, avec les outils de fichiers comme avec les commandes shell
courantes (`cat`, `grep`, `source`…). Le serveur et le hook git lisent toujours le `.env`
normalement. Pour vérifier que le jeton est chargé, `npm run fetch` suffit.

## Règles

- **Le jeton ne quitte jamais le serveur.** Il ne doit apparaître ni dans le
  front, ni dans les logs, ni dans les fichiers commités. Pour vérifier qu'il est
  bien chargé, n'afficher que sa longueur.
- Un hook `pre-commit` (`.githooks/`, activé par `npm install`) bloque tout commit
  contenant un `.env`, un fichier de `data/` ou la valeur du jeton. Ne jamais le
  contourner (`--no-verify`).
- **Écritures limitées.** La seule mutation autorisée est le changement d'état
  (`changeDossierState` dans `server/dn.ts`). Les transitions permises sont dans
  `shared/transitions.ts`, et le serveur les vérifie à partir de l'état réel du dossier.
  L'interface demande toujours une confirmation. Toute autre mutation (annotation,
  message…) demande l'accord explicite de l'utilisateur.
- Les réponses brutes de l'API vont dans `data/` (ignoré par git). Ce sont des
  données personnelles d'usagers : ne pas les publier.
- Pagination des dossiers : `first` / `after` avec `pageInfo { hasNextPage endCursor }`.
- Langue : code et identifiants en anglais, documentation et interface en français.

## Organisation

- `server/dn.ts` : client GraphQL (seul fichier qui lit le jeton) et requêtes.
- `server/index.ts` : serveur Hono sur `127.0.0.1:8787` : `GET /api/demarche`,
  `GET /api/dossiers?state=`, `GET /api/dossiers/:number` et
  `POST /api/dossiers/:number/state` (JSON obligatoire).
- `src/` : front React + DSFR. Vite (port 5173) transmet `/api` au serveur Hono.
  Pages : kanban (`/`), liste (`/liste`), détail (`/dossiers/:number`).
- `shared/transitions.ts` : transitions d'état autorisées, partagées entre le serveur et le front.
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
- Champs Carte : demander `geometry { type coordinates }` (du GeoJSON). Ils sont affichés
  avec Leaflet sur le fond Plan IGN de la Géoplateforme, public et sans clé.

## Pièges connus

- Après un `npm install` d'une nouvelle bibliothèque, arrêter puis relancer `npm run dev`.
  Sinon Vite reconstruit ses dépendances en cours de route, le navigateur se retrouve
  avec deux copies de React (« Invalid hook call »), et il faut forcer le rechargement
  avec Cmd+Maj+R. En cas de doute : `rm -rf node_modules/.vite`.

## Commandes

```sh
npm install         # installe les dépendances et copie les fichiers du DSFR dans public/
npm run fetch       # étape 1 : lit la démarche, les champs et les dossiers et les enregistre dans data/
npm run dev         # serveur Hono et front Vite → http://localhost:5173
npm run typecheck
```
