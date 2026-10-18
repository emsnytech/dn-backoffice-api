# dn-backoffice-api

Back office indépendant pour instruire les dossiers d'une démarche
[Démarche Numérique](https://demarche.numerique.gouv.fr) (ex-Démarches Simplifiées),
branché uniquement sur son API GraphQL v2. Pour l'instant, une seule démarche
de test est configurée.

## Objectif

La feuille de route de référence est `docs/SPEC-kanban.md`, avec les maquettes dans
`docs/maquettes/`. Ces maquettes servent de référence visuelle : ne pas les exécuter
ni recopier leur format.

1. **Étape 1 (faite)** : kanban en lecture seule (colonnes, cartes, recherche,
   filtres, bouton Synchroniser, vue Liste). Aucune mutation.
2. **Étape 2** : la fiche dossier en panneau latéral (champs, PJ, avis, messages).
   En attendant, `/dossiers/:number` affiche une fiche provisoire.
3. **Étape 3 (faite, avant l'étape 2 à la demande de l'utilisateur)** :
   changements d'état par glisser-déposer ou par le menu « Déplacer vers… » de chaque
   carte. Une confirmation est demandée, avec la motivation et l'option « Ne pas notifier
   l'usager ». Pas de mise à jour optimiste : le tableau est relu depuis DN après chaque
   succès. Tout reste désactivé tant que `DN_ENABLE_MUTATIONS` n'est pas à `1`. Les
   boutons de décision de la fiche viendront avec l'étape 2.

## Stack

- Node 24 et TypeScript, exécuté nativement (`node --env-file=.env fichier.ts`,
  sans étape de build pour les scripts).
- `fetch` natif pour GraphQL. Pas de client GraphQL tant que ce n'est pas nécessaire.
- Serveur **Hono** qui sert d'intermédiaire avec l'API, et front **React + Vite**
  en CSS simple (plus de DSFR).
- Toutes les couleurs, polices et dimensions sont dans `src/styles/tokens.css`. Ce
  fichier reprend la police (Source Sans 3, installée en local via `@fontsource`) et les
  couleurs de fond de FORM2026.
- `config/demarche.json` (versionné, sans secret) : champs « objet » et « montant »
  (désignés par leur id de descripteur ou leur libellé exact) et délai cible en jours.

## Configuration (`.env`, jamais commité)

| Variable             | Rôle                                                    |
|----------------------|---------------------------------------------------------|
| `DN_DEMARCHE_NUMBER` | Numéro de la démarche (`DN_DEMARCHE_NUMERO`, le nom utilisé par la spec, est accepté) |
| `DN_API_TOKEN`       | Jeton d'API (profil instructeur/administrateur)         |
| `DN_API_URL`         | Optionnel, par défaut `https://demarche.numerique.gouv.fr/api/v2/graphql` |
| `DN_INSTRUCTEUR_EMAIL` | Optionnel. « Moi » pour le filtre « Suivis par moi » (masqué sans cette variable), et instructeur au nom duquel les changements d'état sont faits |
| `DN_ENABLE_MUTATIONS` | `1` seulement à l'étape 3. Sinon, la route d'écriture répond 403 |

Authentification : en-tête `Authorization: Bearer <DN_API_TOKEN>`.

## Périmètre d'accès de Claude

Sur cet ordinateur, Claude ne travaille que dans les deux répertoires des projets en cours :

- `~/Projets/dn-backoffice-api` (ce projet) ;
- `~/Documents/cartographie` (FORM2026, dont ce projet reprend la police et les couleurs de fond).

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
- **Aucune mutation avant l'étape 3** (docs/SPEC-kanban.md). La seule mutation prévue
  est le changement d'état (`changeDossierState` dans `server/dn.ts`). Elle est
  désactivée sans `DN_ENABLE_MUTATIONS=1`. Les transitions permises sont dans
  `shared/transitions.ts`, et le serveur les vérifie à partir de l'état réel du dossier.
  Toute autre mutation (annotation, message…) demande l'accord explicite de l'utilisateur.
- Les réponses brutes de l'API vont dans `data/` (ignoré par git). Ce sont des
  données personnelles d'usagers : ne pas les publier.
- Pagination des dossiers : `first` / `after` avec `pageInfo { hasNextPage endCursor }`.
- Langue : code et identifiants en anglais, documentation et interface en français.

## Organisation

- `server/dn.ts` : client GraphQL (seul fichier qui lit le jeton) et requêtes.
- `server/index.ts` : serveur Hono sur `127.0.0.1:8787` : `GET /api/kanban` (cartes
  réduites), `GET /api/demarche`, `GET /api/dossiers?state=`, `GET /api/dossiers/:number`,
  et `POST /api/dossiers/:number/state` (désactivée par défaut).
- `server/kanban.ts` : requête et mise en forme des cartes du kanban, lecture de
  `config/demarche.json`.
- `src/` : front React. Vite (port 5173) transmet `/api` au serveur Hono.
  Pages : kanban et vue Liste (`/`), fiche provisoire (`/dossiers/:number`).
  Les messages DN (souvent du HTML) passent par `src/components/MessageBody.tsx`,
  qui ne recrée qu'une liste fermée de balises.
  Règles d'affichage dans `src/board.ts`.
- `shared/transitions.ts` : transitions d'état autorisées (utilisées par le serveur).
- `scripts/fetch-demarche.ts` : enregistre les données brutes dans `data/`.
- `logs/mutations.log` (ignoré par git) : une ligne JSON par tentative de changement
  d'état (date, dossier, départ, arrivée, notification, résultat). Ni le jeton, ni le
  texte de la motivation.

## Points d'attention sur l'API

- Pour les champs de type section ou explication (`HeaderSection`, `Explication`),
  l'API renvoie un `TextChamp` vide dans le dossier. Pour connaître leur vrai type,
  passer par `champDescriptorId`.
- Pour les choix multiples, utiliser `values` (tableau) plutôt que `stringValue`.
- Les brouillons ne sont pas renvoyés par l'API, seulement les dossiers déposés.
- Le jeton peut être restreint par adresse IP. L'API n'est joignable qu'en IPv4 :
  c'est donc l'IPv4 publique qu'il faut autoriser.
- Le contenu des messages vient des usagers : l'afficher en texte brut, jamais en HTML.
- Écarts avec la spec, constatés dans le schéma : pas de statut lu ou non lu sur les
  messages (le filtre s'appelle donc « Avec messages ») ; les instructeurs n'ont que
  `id` et `email`, sans nom (les initiales viennent de l'e-mail) ; pas de requête
  « qui suis-je » (d'où `DN_INSTRUCTEUR_EMAIL`) ; la raison sociale est dans
  `PersonneMorale.entreprise.raisonSociale` ou `association.titre` ; il existe un
  troisième type de demandeur, `PersonneMoraleIncomplete`, qui n'a que le `siret`.
- Champs Carte : demander `geometry { type coordinates }` (du GeoJSON). Ils sont affichés
  avec Leaflet sur le fond Plan IGN de la Géoplateforme, public et sans clé.

## Pièges connus

- Après un `npm install` d'une nouvelle bibliothèque, arrêter puis relancer `npm run dev`.
  Sinon Vite reconstruit ses dépendances en cours de route, le navigateur se retrouve
  avec deux copies de React (« Invalid hook call »), et il faut forcer le rechargement
  avec Cmd+Maj+R. En cas de doute : `rm -rf node_modules/.vite`.

## Commandes

```sh
npm install         # installe les dépendances et active le hook pre-commit
npm run fetch       # étape 1 : lit la démarche, les champs et les dossiers et les enregistre dans data/
npm run dev         # serveur Hono et front Vite → http://localhost:5173
npm run typecheck
```
