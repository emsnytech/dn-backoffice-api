# Spécification — Vue kanban d'instruction des dossiers DN

Back office indépendant, connecté par l'API GraphQL de Démarche Numérique (DN) à une démarche de test.
DN reste la **source de vérité** : le back office lit les dossiers et déclenche les changements d'état par mutation, il ne stocke aucun état métier en propre.

Maquettes de référence (structure, textes, couleurs) : `docs/maquettes/Main.dc.html` (tableau) et `docs/maquettes/Dossier.dc.html` (fiche). Ce sont des sources d'un outil de maquettage : **s'en servir comme référence visuelle et de balisage, ne pas les exécuter ni recopier leur format** (`<x-dc>`, `<sc-for>`, `{{…}}`, `support.js`).

---

## 1. Périmètre et ordre de livraison

Livrer par étapes, chacune vérifiable avant la suivante :

1. **Lecture seule.** Récupérer la démarche, ses dossiers et les afficher en kanban. Aucune mutation.
2. **Fiche dossier.** Panneau latéral au clic sur une carte : champs, PJ, avis, messages.
3. **Écriture.** Glisser-déposer entre colonnes et boutons de décision, qui déclenchent les mutations. Uniquement après validation explicite de l'étape 2 par l'utilisateur.

Ne jamais écrire de mutation tant que l'étape 3 n'est pas demandée.

---

## 2. Configuration

Lue depuis `.env` à la racine (déjà présent, ignoré par Git — ne jamais l'afficher, le logger ni le commiter) :

```
DN_API_TOKEN=...
DN_DEMARCHE_NUMERO=...
```

À ajouter pour l'étape 3 :

```
DN_INSTRUCTEUR_ID=...   # identifiant GraphQL de l'instructeur au nom duquel agir
```

- Endpoint : `https://demarche.numerique.gouv.fr/api/v2/graphql`
- En-têtes : `Authorization: Bearer <DN_API_TOKEN>`, `Content-Type: application/json`
- **Le jeton ne doit jamais atteindre le navigateur.** Les appels à DN passent par un petit serveur (proxy) côté back office ; le front n'appelle que ce serveur.

---

## 3. Données (étape 1)

Requête de départ : la démarche par son numéro, puis ses dossiers (paginés, `first` + `after` / `pageInfo`). Récupérer au minimum, par dossier :

| Besoin carte / fiche | Donnée DN |
|---|---|
| N° | `number` |
| État (colonne) | `state` |
| Demandeur | `demandeur` (personne morale : raison sociale, SIRET ; personne physique : nom) |
| Objet | un champ du formulaire, choisi dans la config (voir § 6) |
| Montant | un champ du formulaire, choisi dans la config |
| Ancienneté | `dateDepot`, `datePassageEnInstruction`, `dateTraitement` |
| Instructeur | `instructeurs` (ou groupe instructeur) |
| Messages | `messages` (compter ceux non lus si l'API le permet, sinon le total) |
| Avis | `avis` (demandé / reçu) |
| PJ | champs de type pièce justificative (fournie / manquante) |
| Annotations | `annotations` (annotations privées) |

**Vérifier chaque nom de champ dans le schéma réel** (introspection ou `https://demarche.numerique.gouv.fr/graphql/schema`) avant de coder. En cas d'écart avec ce tableau, le schéma l'emporte ; signaler l'écart.

Rafraîchissement : à l'ouverture, puis bouton « Synchroniser » et rappel discret de l'heure de dernière synchro (bandeau vert de l'en-tête).

---

## 4. Tableau kanban (maquette `Main.dc.html`)

### Colonnes

| Colonne | `state` DN | Texte d'aide |
|---|---|---|
| En construction | `en_construction` | Déposés, encore modifiables par le demandeur. |
| En instruction | `en_instruction` | Gelés pour le demandeur. Avis, messages et annotations en cours. |
| Décision | `accepte`, `refuse`, `sans_suite` | Trois sous-groupes titrés dans la même colonne. |

Les dossiers `brouillon` ne sont pas affichés.

### Carte

De haut en bas :
1. `N° <number>` (police mono, accent) — à droite l'ancienneté `J+<jours>` ; en badge rouge si le délai cible est dépassé (seuil configurable, défaut 45 jours en instruction).
2. Demandeur (gras), puis objet du projet.
3. Badges : messages, avis demandé / reçu, PJ manquante, étiquettes. Initiales de l'instructeur à droite.
4. Montant demandé (masqué en mode compact).

Toute la carte est un lien / bouton accessible qui ouvre la fiche.

### En-tête et filtres

- Titre : « Démarche test n° X — <libellé de la démarche> ».
- Bascule Kanban / Liste (la vue Liste peut rester un tableau simple).
- Recherche : n° de dossier, demandeur, SIRET.
- Filtres en pastilles avec compteur : Tous, Suivis par moi, Messages non lus, Avis en attente, Délai dépassé.

### Bandeau « Transitions autorisées »

Affiché sous le tableau, il liste les déplacements possibles et la mutation correspondante (§ 7).

---

## 5. Fiche dossier (maquette `Dossier.dc.html`)

Panneau latéral de 560 px à droite, le tableau restant visible derrière (plein écran sur mobile).

- En-tête : retour au tableau, lien « Ouvrir dans DN », n°, badge d'état, ancienneté, titre, date de dépôt, instructeur.
- Onglets : Demande, Annotations, Messagerie (compteur), Avis (compteur), Historique.
- Onglet Demande : blocs Demandeur, Champs du formulaire, Pièces justificatives (fournie / manquante), Avis externe.
- Pied fixe : Accepter, Refuser, Sans suite ; lien « Repasser en construction ». Les boutons n'apparaissent que si la transition est autorisée depuis l'état courant. Inactifs avant l'étape 3.

---

## 6. Configuration par démarche

Un fichier `config/demarche.json` (versionné, sans secret) mappe les champs propres à la démarche de test :

```json
{
  "champObjet": "<id ou libellé du champ>",
  "champMontant": "<id ou libellé du champ>",
  "delaiCibleJours": 45
}
```

Ainsi le même back office fonctionne sur une autre démarche en changeant ce fichier.

---

## 7. Transitions (étape 3)

| Déplacement | Mutation |
|---|---|
| Construction → Instruction | `dossierPasserEnInstruction` |
| Instruction → Construction | `dossierRepasserEnConstruction` |
| Instruction → Accepté | `dossierAccepter` |
| Instruction → Refusé | `dossierRefuser` |
| Instruction → Sans suite | `dossierClasserSansSuite` |
| Décision → Instruction | `dossierRepasserEnInstruction` |

Règles :
- Les mutations demandent `dossierId` et `instructeurId` ; refus et sans suite demandent une **motivation** : ouvrir une boîte de saisie avant l'appel. Vérifier les champs exacts de chaque `input` dans le schéma.
- Toute autre transition est refusée côté interface (la colonne cible ne s'illumine pas).
- Confirmation avant chaque mutation (« Accepter le dossier n° X ? »).
- Pas de mise à jour optimiste : la carte ne change de colonne qu'après la réponse de DN. Afficher `errors[].message` de DN en cas d'échec et laisser la carte en place.
- Journaliser chaque mutation (date, dossier, transition, résultat) dans un fichier local, sans le jeton.
- Le glisser-déposer doit avoir un équivalent clavier (menu « Déplacer vers… » sur la carte).

---

## 8. Design

Tirés des maquettes :

| Jeton | Valeur | Usage |
|---|---|---|
| fond | `#F4F3EF` | page |
| surface | `#FFFFFF` | en-tête, cartes, fiche |
| colonne | `#EAE8E1` | fond des colonnes |
| bordure | `#DDDAD2` | |
| texte | `#1B1F2A` | |
| texte secondaire | `#4A4F5C` | aides, libellés |
| accent | `#2B3F8F` | n° de dossier, liens, filtre actif |
| succès | `#3D6B3A` / `#EAF3E8` | synchro, PJ fournie, accepté |
| alerte | `#8C1D18` / `#F9DEDC` | délai dépassé, refuser |
| avis | `#5E2463` / `#F3E3F4` | badges d'avis |
| PJ manquante | `#7A3500` / `#FBE7D3` | |

- Polices : IBM Plex Sans (texte), IBM Plex Mono (n°, montants, noms d'état API).
- Rayons : 12 px colonnes, 10 px cartes, 8 px boutons, pastilles arrondies.
- Cibles cliquables ≥ 44 px ; contraste texte ≥ 4.5:1 ; vrais `<button>`, `<a>`, `<label>`.
- Largeur : colonnes de 300 px minimum ; en dessous, le tableau défile horizontalement.

---

## 9. Choix techniques

Proposer la stack à l'utilisateur **avant** de coder, en privilégiant la simplicité : un petit serveur (Node ou Python) qui fait proxy vers DN et sert une interface légère. Pas de base de données à l'étape 1.

## 10. Critères d'acceptation de l'étape 1

- Les dossiers de la démarche de test apparaissent dans la bonne colonne, avec un compteur juste.
- Le jeton n'apparaît ni dans le code front, ni dans les réponses réseau du navigateur, ni dans Git.
- Aucune requête `mutation` n'est émise.
- La page reste utilisable à 390 px de large.
