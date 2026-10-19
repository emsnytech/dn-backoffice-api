# dn-backoffice-api

Back office indépendant pour instruire les dossiers de démarches
[Démarche Numérique](https://demarche.numerique.gouv.fr) (ex-Démarches Simplifiées),
branché uniquement sur son API GraphQL v2. Il n'accède qu'aux démarches déclarées dans
`config/demarches/`.

## Objectif

La feuille de route de référence est `docs/SPEC-kanban.md`, avec les maquettes dans
`docs/maquettes/`. Ces maquettes servent de référence visuelle : ne pas les exécuter
ni recopier leur format. Le chantier en cours est décrit dans
`docs/SPEC-multi-demarches.md` (étapes A à D, une validation de l'utilisateur entre
chaque étape).

1. **Étape 1 (faite)** : kanban en lecture seule (colonnes, cartes, recherche,
   filtres, bouton Synchroniser, vue Liste). Aucune mutation.
2. **Étape 2 (en test)** : la fiche dossier s'ouvre en panneau latéral par-dessus le
   tableau (route imbriquée, URL partageable). Onglets Demande,
   Annotations, Messagerie, Avis et Historique, lien « Ouvrir dans DN ». Les blocs
   répétables sont affichés ligne par ligne. Le pied de la fiche propose les décisions
   autorisées depuis l'état courant, avec la même confirmation que le tableau.
3. **Étape 3 (faite, avant l'étape 2 à la demande de l'utilisateur)** :
   changements d'état par glisser-déposer ou par le menu « Déplacer vers… » de chaque
   carte. Une confirmation est demandée, avec la motivation et l'option « Ne pas notifier
   l'usager ». Pas de mise à jour optimiste : le tableau est relu depuis DN après chaque
   succès. Tout reste désactivé tant que `DN_ENABLE_MUTATIONS` n'est pas à `1`.

Chantier multi-démarches (`docs/SPEC-multi-demarches.md`) :

- **A (en test)** : accueil avec une carte par démarche déclarée, kanban et fiche par
  démarche, ajout d'une démarche par son numéro (accès vérifié par le serveur). Réglage
  `mutations` par démarche, en plus de `DN_ENABLE_MUTATIONS`.
- **B (en test)** : fiche de paramétrage (`/demarches/:numero/parametres`), pré-remplie
  par des propositions avec leur raison, ouverte aussi à l'ajout d'une démarche (rien
  n'est déclaré avant l'enregistrement). Vocabulaire financier générique : millésime,
  lignes de financement (programme, montants demandé et accordé, assiette, taux, taux
  maximal, n° d'EJ).
- **C (C1 puis C2), D** : à faire, chacune après validation de la précédente.

## Stack

- Node 24 et TypeScript, exécuté nativement (`node --env-file=.env fichier.ts`,
  sans étape de build pour les scripts).
- `fetch` natif pour GraphQL. Pas de client GraphQL tant que ce n'est pas nécessaire.
- Serveur **Hono** qui sert d'intermédiaire avec l'API, et front **React + Vite**
  en CSS simple (plus de DSFR).
- Toutes les couleurs, polices et dimensions sont dans `src/styles/tokens.css`, qui
  applique la charte FORM 2026 (docs/SPEC-kanban.md § 8) avec ses noms de variables
  (`--paper`, `--ink`, `--admin`, `--usager`…) et son thème sombre. Bleu =
  administration, vert = usager. Police Source Sans 3, installée en local via
  `@fontsource` plutôt que chargée depuis Google Fonts. Pas de police à chasse fixe :
  la pile système `ui-monospace` sert aux seuls identifiants techniques, et les
  chiffres sont en `tabular-nums`.
- `config/demarches/<numéro>.json` (versionné, sans secret) : une fiche par démarche
  déclarée (libellé court, réglage `mutations`, délai cible, champs « objet » et
  « montant demandé », données financières), les champs étant désignés par leur
  identifiant de descripteur. Écrite uniquement par le serveur
  (`PUT /api/demarches/:numero/parametres`) : il relit la révision publiée sur DN, vérifie
  que chaque champ existe et a un type accepté pour son rôle, et reprend son libellé.

## Configuration (`.env`, jamais commité)

| Variable             | Rôle                                                    |
|----------------------|---------------------------------------------------------|
| `DN_DEMARCHE_NUMBER` | Ancien réglage à une seule démarche. Ne sert plus qu'à la migration : si aucune démarche n'est déclarée, celle-ci l'est au démarrage du serveur |
| `DN_API_TOKEN`       | Jeton d'API (profil instructeur/administrateur)         |
| `DN_API_URL`         | Optionnel, par défaut `https://demarche.numerique.gouv.fr/api/v2/graphql` |
| `DN_INSTRUCTEUR_EMAIL` | Optionnel. « Moi » pour le filtre « Suivis par moi » (masqué sans cette variable), et instructeur au nom duquel les changements d'état sont faits, sur chaque démarche |
| `DN_ENABLE_MUTATIONS` | Interrupteur général des changements d'état. Sans `1`, la route d'écriture répond 403, quel que soit le réglage `mutations` des démarches |

Authentification : en-tête `Authorization: Bearer <DN_API_TOKEN>`.

## Périmètre d'accès de Claude

Sur cet ordinateur, Claude ne travaille que dans les deux répertoires des projets en cours :

- `~/Projets/dn-backoffice-api` (ce projet) ;
- `~/Documents/cartographie` (FORM2026, dont ce projet reprend la police et les couleurs de fond).

Ne pas lire, chercher ni modifier de fichiers en dehors de ces répertoires, même
pour vérifier ou comparer. Une instance de Claude peut être sollicitée pour relire
ce projet et proposer des améliorations : elle suit les mêmes règles. **Une session de
relecture ne modifie aucun fichier du projet** (code, configuration, documentation) et
n'écrit ni sur les données ni sur l'API. Seule exception : elle peut créer ses
suggestions dans `docs/revues/` (un fichier Markdown daté par relecture). Elle peut
aussi les donner dans la conversation. Les modifications sont faites par la session de développement, après
accord de l'utilisateur.

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
- `server/index.ts` : serveur Hono sur `127.0.0.1:8787`. Toute route d'une démarche non
  déclarée répond 404, sauf `verifier`, `proposition` et la création par `PUT parametres` :
  - `GET /api/demarches` (résumé par démarche ; `?resume=0` : liste seule, sans appel à DN) ;
  - `GET /api/demarches/:numero` (démarche et descripteurs de champs), `…/kanban`,
    `…/dossiers/:n`, `…/parametres` ; `PUT …/parametres` ; `GET …/verifier` ;
  - `GET /api/demarches/:numero/proposition` (candidats par rôle, paramétrage proposé et
    ses raisons, fiche actuelle, champs disparus de la révision) ;
  - `POST /api/demarches/:numero/dossiers/:n/state` (désactivée par défaut) ;
  - `GET /api/dossiers/:n/demarche`, pour rediriger les anciennes adresses `/dossiers/:n`.
- `server/config.ts` : lecture, validation et écriture des fiches de `config/demarches/`,
  migration depuis l'ancienne configuration à une démarche.
- `server/parametrage.ts` : rôles de la fiche (types acceptés, mots-clés), propositions
  automatiques, champs désignés introuvables dans la révision publiée.
- `server/kanban.ts` : requête et mise en forme des cartes du kanban, résumé de l'accueil.
- `src/` : front React. Vite (port 5173) transmet `/api` au serveur Hono.
  Pages : accueil (`/`, `src/pages/Home.tsx`), kanban et vue Liste (`/demarches/:numero`),
  fiche en panneau latéral (`/demarches/:numero/dossiers/:n`, `src/pages/DossierDetail.tsx`),
  paramètres (`/demarches/:numero/parametres`).
  Les messages DN (souvent du HTML) passent par `src/components/MessageBody.tsx`,
  qui ne recrée qu'une liste fermée de balises.
  Règles d'affichage dans `src/board.ts`.
- `shared/transitions.ts` : transitions d'état autorisées (utilisées par le serveur).
- `scripts/fetch-demarche.ts` : enregistre les données brutes dans `data/`
  (`npm run fetch -- <numéro>`, ou toutes les démarches déclarées sans numéro).
- `logs/mutations.log` (ignoré par git) : une ligne JSON par tentative de changement
  d'état (date, démarche, dossier, départ, arrivée, notification, résultat). Ni le jeton, ni le
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
- Aucune requête ne liste les démarches ouvertes par le jeton. `demarcheDescriptors` renvoie
  le catalogue public de DN, sans les démarches non publiées : ne pas l'utiliser pour cela.
  Pour une démarche hors de portée du jeton, DN répond `not_found` (« Demarche not
  found »), comme pour une démarche inexistante.
- `IntegerNumberChamp.value` est un `BigInt`, transmis en chaîne : le convertir avec `Number`.
  `DecimalNumberChamp.value` est un `Float`. Les annotations privées utilisent les mêmes types.
- Un champ d'un bloc répétable (`RepetitionChamp.rows[].champs`) peut être désigné dans la
  fiche (rôles numériques du formulaire) : sa valeur est la somme des lignes renseignées.
  C'est le cas du montant demandé de la démarche 154701.
- DN a un type `EngagementJuridiqueChampDescriptor` (champ `engagementJuridique { montantEngage
  montantPaye }`) : il est accepté pour le n° d'EJ, en plus des annotations texte.
- Une liste déroulante n'est proposée comme millésime que si toutes ses options sont des années.
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
npm run fetch       # lit les démarches déclarées (ou: npm run fetch -- <numéro>) et les enregistre dans data/
npm run dev         # serveur Hono et front Vite → http://localhost:5173
npm run typecheck
```
