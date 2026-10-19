# Spécification — Multi-démarches, fiche de paramétrage et suivi d'enveloppe

Suite de `docs/SPEC-kanban.md`, dont les règles restent valables : DN est la source de vérité,
le jeton ne quitte jamais le serveur, charte FORM 2026 (§ 8), pas de mise à jour optimiste.

Le back office ne connaît aujourd'hui qu'une démarche (`DN_DEMARCHE_NUMBER`, `config/demarche.json`).
Ce chantier le rend générique : **chaque démarche a sa fiche de paramétrage, et l'interface se
construit d'après elle.**

Livrer dans cet ordre, un commit par étape, chacune vérifiée avant la suivante :

- **A.** Multi-démarches (socle).
- **B.** Fiche de paramétrage, avec propositions automatiques.
- **C.** Enveloppes et suivi financier (C1, puis C2).
- **D.** Indicateur « en attente de réponse » (petit, sans stockage).

La boîte de réception transverse de l'agent est **hors périmètre** (voir § 6).

---

## 0. Vérifications préalables dans le schéma

Avant de coder, vérifier par introspection et signaler les écarts :

1. Existe-t-il une requête qui liste les démarches accessibles **au jeton** ? `demarcheDescriptors`
   semble ne lister que les démarches publiques en open data : ne pas l'utiliser pour cela.
2. Arguments de `Demarche.dossiers` : `updatedSince`, `state`, `order`… (utile pour § 6).
3. Types des descripteurs numériques : `DecimalNumberChampDescriptor`, `IntegerNumberChampDescriptor`
   (et équivalents en annotation), et le champ `value` des champs correspondants.
4. Avant l'étape B : types des listes déroulantes et de leurs options, types des annotations
   texte, présence de `dateDepot` sur `Dossier`.

---

## A. Multi-démarches

### Liste des démarches

- Une démarche est **déclarée** par un fichier `config/demarches/<numéro>.json` (§ B). Le back office
  n'accède qu'aux démarches déclarées, même si le jeton en ouvre d'autres.
- Migration : si `DN_DEMARCHE_NUMBER` est défini et qu'aucun fichier n'existe, créer celui de cette
  démarche à partir de `config/demarche.json`, puis supprimer l'usage de ces deux sources.
- Ajout depuis l'interface : bouton « Ajouter une démarche », saisie du **numéro**. Le serveur vérifie
  l'accès (`demarche(number)`) ; en cas de refus, afficher le message de DN. En cas de succès, ouvrir
  directement la fiche de paramétrage pré-remplie (§ B), **sans enregistrer** avant validation.
- Si le § 0.1 révèle une requête listant les démarches du jeton, proposer en plus « Démarches
  disponibles » avec un bouton d'ajout. La déclaration reste explicite.

### Adresses

| Front | Contenu |
|---|---|
| `/` | Accueil : une carte par démarche déclarée |
| `/demarches/:numero` | Kanban de la démarche |
| `/demarches/:numero/dossiers/:n` | Fiche dossier (panneau, inchangé) |
| `/demarches/:numero/parametres` | Fiche de paramétrage |

Rediriger les anciennes adresses `/dossiers/:n` vers la démarche du dossier.

| Serveur | Méthode |
|---|---|
| `/api/demarches` | GET : démarches déclarées + résumé (compteurs par état, jauges des enveloppes alimentées) |
| `/api/demarches/:numero/kanban` | GET |
| `/api/demarches/:numero/dossiers/:n` | GET |
| `/api/demarches/:numero/dossiers/:n/state` | POST |
| `/api/demarches/:numero/parametres` | GET, PUT |
| `/api/demarches/:numero/proposition` | GET : paramétrage proposé (§ B), non enregistré |
| `/api/demarches/:numero/verifier` | GET : accès à une démarche non encore déclarée |

- Toute route refuse un `:numero` non déclaré (404), sauf `verifier` et `proposition`.
- `fetchDossier` vérifie que le dossier appartient **à la démarche de l'adresse**.
- Le numéro de démarche n'est plus une constante globale : le passer en paramètre partout.
- L'identifiant d'instructeur pour les mutations est résolu **par démarche** (cache par numéro).

### Accueil

Une carte par démarche, dans la charte : titre, n°, état de la démarche (publiée, close…),
compteurs par colonne du kanban, jauges des enveloppes qu'elle alimente (§ C), lien
« Paramètres ». Si une démarche est inaccessible (jeton révoqué…), la carte l'indique sans bloquer
les autres.

En-tête du kanban : sélecteur de démarche (liste déroulante accessible), lien « Paramètres ».

### Changements d'état

`DN_ENABLE_MUTATIONS=1` reste l'interrupteur général. **En plus**, chaque démarche a un réglage
`mutations` (faux par défaut) dans sa fiche : une démarche nouvellement ajoutée est en lecture seule
tant que l'agent ne l'a pas autorisée explicitement.

---

## B. Fiche de paramétrage

### Fichier

`config/demarches/<numéro>.json`, versionné (aucun secret), écrit **uniquement** par le serveur
(route PUT, entrée validée), jamais à la main par le front.

```json
{
  "numero": 103080,
  "libelle": "Libellé court affiché dans le back office",
  "mutations": false,
  "delaiCibleJours": 45,
  "champs": {
    "objet":          { "id": "<descripteur>", "libelle": "Intitulé du projet" },
    "montantDemande": { "id": "<descripteur>", "libelle": "Montant demandé" }
  },
  "finances": {
    "millesime": { "source": "anneeDepot" },
    "lignes": [
      {
        "programme":      { "source": "fixe", "valeur": "DSIL" },
        "montantDemande": null,
        "assiette":       { "id": "<descripteur>", "libelle": "Coût total HT" },
        "montantAccorde": { "id": "<annotation>", "libelle": "Montant accordé DSIL" },
        "taux":           null,
        "tauxMax":        80,
        "numeroEJ":       { "id": "<annotation>", "libelle": "N° d'engagement juridique" }
      }
    ]
  },
  "valideLe": "2026-10-18T19:30:00+02:00"
}
```

- Un champ est référencé par son **identifiant de descripteur**, stable d'une révision à l'autre ;
  le libellé est stocké pour l'affichage et pour détecter un champ disparu.
- Si un champ référencé n'existe plus dans `activeRevision`, la fiche et le kanban affichent une
  alerte « champ introuvable dans la révision publiée » et le calcul concerné est suspendu
  (jamais de somme silencieusement fausse).
- `finances` est facultatif : sans lui, la démarche n'alimente aucune enveloppe.

### Vocabulaire financier

La fiche fait correspondre des champs DN à des **rôles génériques**, sans rien de propre à un
dispositif (DETR, DSIL…). Tous facultatifs. Le millésime vaut pour la démarche ; les autres rôles
sont regroupés en **lignes de financement**. Une seule ligne dans le cas courant ; plusieurs quand
un dossier peut être financé par plusieurs programmes (double dotation), chacun avec ses annotations.

| Rôle | Niveau | Types acceptés | Remarque |
|---|---|---|---|
| Millésime | démarche | champ ou annotation nombre entier ou liste déroulante ; sinon année de dépôt | `{source: "champ", ref}` ou `{source: "anneeDepot"}` |
| Programme | ligne | liste déroulante (formulaire ou annotation), ou valeur fixe | `{source: "champ", ref}`, `{source: "fixe", valeur}` ou `null` |
| Montant demandé | ligne | nombre, formulaire | par défaut `champs.montantDemande` s'il n'y a qu'une ligne |
| Assiette éligible | ligne | nombre, formulaire ou annotation | — |
| **Montant accordé** | ligne | **annotation privée nombre uniquement** | base du calcul de l'enveloppe |
| Taux | ligne | annotation nombre ; sinon calculé (accordé ÷ assiette) | affiché, jamais additionné |
| Taux maximal | ligne | nombre saisi dans la fiche (en %), facultatif | contrôle seulement (§ C, anomalies) |
| N° d'engagement juridique | ligne | annotation privée texte | indicateur « engagé », futur rapprochement Chorus |

Le **périmètre** (département, commune) est hors de ce chantier (§ C, « Plus tard »).

### Source du millésime

La fiche affiche la source retenue. Si c'est l'**année de dépôt**, elle le signale (« millésime
déduit de l'année de dépôt, aucun champ désigné ») et chaque enveloppe compte les dossiers
concernés (§ C).

### Propositions automatiques

La route `proposition` lit `activeRevision.champDescriptors` et `annotationDescriptors` et
pré-sélectionne, **avec la raison affichée** à côté de chaque proposition :

| Réglage | Candidats | Règle de proposition |
|---|---|---|
| Objet | champs texte du formulaire | libellé contenant « objet », « intitulé », « projet », « titre » ; sinon le premier champ texte |
| Montant demandé | champs nombre du formulaire | « montant », « demandé », « subvention », « € » ; seul champ nombre |
| Montant accordé | annotations nombre | « accordé », « attribué », « montant » ; seule annotation nombre |
| Assiette | champs ou annotations nombre | « coût », « assiette », « éligible », « total », « HT » |
| Taux | annotations nombre | « taux », « % » ; sinon « calculé » |
| Programme | listes déroulantes | « dotation », « programme », « dispositif », « fonds » |
| Millésime | champs ou annotations entier ou liste | « année », « millésime », « exercice » ; sinon année de dépôt |
| N° d'EJ | annotations texte | « engagement », « EJ », « Chorus » |
| Lignes | — | une ligne par annotation « montant accordé » proposée ; s'il y en a plusieurs, le programme de chaque ligne est à renseigner par l'agent |

L'agent valide ou corrige chaque proposition. **Rien n'est enregistré sans le bouton « Enregistrer
le paramétrage »**, qui affiche ensuite la date de validation.

### Interface (`/demarches/:numero/parametres`)

Sections, de haut en bas :

1. **Démarche** (lecture) : titre, n°, état, date de publication de la révision, nombre de champs et
   d'annotations. Champ « Libellé court ».
2. **Affichage des cartes** : listes déroulantes Objet et Montant demandé ; délai cible (jours).
3. **Données financières** : millésime (avec sa source) ; une ou plusieurs lignes de financement
   (« Ajouter une ligne », « Retirer ») ; chaque liste ne propose que les types acceptés pour son rôle.
   - S'il n'y a aucune annotation privée nombre : message « Aucune annotation privée de type nombre
     dans cette démarche. Ajoutez-en une dans l'éditeur de la démarche sur DN (ex. « Montant
     accordé »), puis actualisez », avec lien vers DN.
   - En lecture : enveloppes alimentées par la démarche, avec lien (elles se créent ailleurs, § C).
4. **Changements d'état** : case « Autoriser les changements d'état sur cette démarche » (avec rappel
   que `DN_ENABLE_MUTATIONS` doit aussi être actif).

Chaque liste montre le libellé DN exact du champ, son type et sa position dans le formulaire, pour
éviter les confusions entre champs homonymes.

---

## C. Enveloppes et suivi financier

### Principe

**L'enveloppe est indépendante de la démarche.** Une démarche peut alimenter plusieurs enveloppes
(millésimes, programmes), et une enveloppe peut être alimentée par plusieurs démarches. L'enveloppe
est la seule donnée qui n'existe pas dans DN ; les montants accordés restent dans les annotations
privées de DN, ce qui permet à tout outil de recalculer la consommation.

### Fichier

`config/enveloppes/<id>.json`, versionné, écrit uniquement par le serveur (`id` court, généré).

```json
{
  "id": "dsil-2026",
  "libelle": "DSIL 2026",
  "programme": "DSIL",
  "millesime": 2026,
  "montantCentimes": 50000000,
  "parent": null,
  "demarches": [103080, 154701],
  "modifieLe": "2026-10-20T10:00:00+02:00"
}
```

- `programme` : facultatif (`null` = tous programmes). Il se choisit dans une **liste fermée**, pas
  en texte libre : valeurs fixes des lignes et options des listes déroulantes « programme » des
  démarches rattachées. Une valeur qui a disparu de cette liste est signalée en anomalie.
- `parent` (délégation) : facultatif ; sert seulement au contrôle « somme des enveloppes filles ≤
  enveloppe mère », sans effet sur les calculs.
- `demarches` : uniquement des démarches déclarées.

### Règle d'imputation

Pour chaque dossier d'une démarche qui alimente au moins une enveloppe, et pour chaque ligne de
financement : les enveloppes candidates sont celles dont `demarches` contient la démarche, dont
`millesime` égale le millésime du dossier, et dont `programme` est `null` ou égal à la valeur du
programme de la ligne.

| Candidates | Résultat |
|---|---|
| 1 | la ligne est imputée sur cette enveloppe |
| 0 | anomalie « hors enveloppe » |
| plusieurs | anomalie « plusieurs enveloppes possibles », rien n'est imputé |

Un dossier n'est **jamais ignoré en silence**. Une démarche qui n'alimente aucune enveloppe n'est pas
suivie (pas d'anomalie).

### Statut financier, par imputation

DN n'a qu'un état par dossier ; le statut financier se porte donc **par ligne imputée** :

| État DN | Montant accordé | Statut |
|---|---|---|
| en construction | vide | **demandé** |
| en construction | renseigné | **demandé**, avec l'anomalie « montant accordé avant instruction » |
| en instruction | vide | **demandé** |
| en instruction | renseigné | **programmé** |
| accepté | > 0 | **accepté** (et **engagé** si le n° d'EJ est renseigné) |
| accepté | 0 ou vide | plusieurs lignes : « non retenu sur ce programme » si une autre ligne est > 0, sinon anomalie ; une seule ligne : anomalie |
| refusé, classé sans suite | — | hors calcul |

### Indicateurs par enveloppe (serveur, à chaque synchronisation)

- **Montant** (saisi) · **Demandé** (montant demandé des lignes « demandé » ou « programmé ») ·
  **Programmé** (montant accordé des lignes « programmé ») · **Accepté** · **Engagé** (part de
  l'accepté avec n° d'EJ) · **Reste** = montant − accepté · **Reste prévisionnel** = reste − programmé.
- **Millésime déduit** : nombre de dossiers imputés dont le millésime vient de l'année de dépôt.
- Calcul en centimes entiers ; affichage `Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" })`.

**Anomalies**, listées avec n° de dossier cliquable, jamais ignorées en silence :

- hors enveloppe ; plusieurs enveloppes possibles ;
- montant accordé avant instruction (dossier en construction) ;
- accepté sans montant accordé, ou à 0 € (selon la table ci-dessus) ;
- valeur non numérique ou négative ; millésime illisible ;
- champ référencé introuvable dans la révision publiée ; programme d'enveloppe absent de la liste fermée ;
- enveloppes filles dont le total dépasse la mère.

**Alertes non bloquantes** (signalées, le montant reste compté) :

- montant accordé supérieur au montant demandé, ou supérieur à l'assiette ;
- taux (lu ou calculé) supérieur au taux maximal de la ligne, s'il est défini.

### Adresses

| Front | Contenu |
|---|---|
| `/enveloppes` | Liste des enveloppes avec jauges ; « Créer une enveloppe » |
| `/enveloppes/:id` | Indicateurs, dossiers imputés (statut, montant), anomalies, édition |

| Serveur | Méthode |
|---|---|
| `/api/enveloppes` | GET (avec indicateurs), POST |
| `/api/enveloppes/:id` | GET, PUT, DELETE |
| `/api/enveloppes/programmes?demarches=…` | GET : liste fermée des programmes possibles |

### Affichage

- **Bandeau au-dessus du kanban** : une jauge par enveloppe alimentée par la démarche — accepté
  (plein, `--admin`) + programmé (`--admin-soft`) sur le total ; chiffres en clair (montant,
  accepté, programmé, engagé, reste) ; pourcentage. Dépassement : reste et jauge en `--bad`, message
  explicite. Anomalies : badge `--warn` avec leur nombre et lien vers la liste. Équivalent textuel
  accessible (pas de couleur seule).
- **Accueil** : jauge réduite sur la carte de chaque démarche ; lien « Enveloppes » dans l'en-tête.
- **Cartes du kanban** : montant accordé, par ligne s'il y en a plusieurs (« DETR 40 000 € · DSIL 0 € »).
- **Confirmation « Accepter »** : montant accordé par ligne et reste de chaque enveloppe après
  acceptation ; si aucun montant n'est renseigné, avertir (« le montant accordé n'est pas renseigné :
  ce dossier ne sera pas imputé »), sans bloquer.

### Livraison en deux temps

- **C1** : enveloppes, imputation par démarche et millésime (`programme` toujours `null`),
  indicateurs, bandeau, anomalies.
- **C2** : imputation par programme et lignes multiples (double dotation). Prérequis : deux
  annotations « montant accordé » créées par l'utilisateur sur la démarche 154701.

Validation de l'utilisateur entre C1 et C2.

### Plus tard (hors chantier)

Périmètre (département ou commune issus de l'adresse ou du SIRET) ; « payé » et rapprochement Chorus
par n° d'EJ ; simulations ; écriture des montants dans DN (nouvelle mutation : accord explicite
de l'utilisateur).

---

## D. Indicateur « en attente de réponse »

DN gère côté application la notion de message lu par l'instructeur, mais **l'API ne l'expose
pas** (type `Message` : `id`, `email`, `body`, `createdAt`, `attachments`, `correction`,
`discardedAt`). Le back office ne recrée pas un « lu / non lu » qui divergerait de celui de DN.

À la place, indicateur calculé sans stockage : un dossier est **en attente de réponse** si son
dernier message non supprimé (`discardedAt` nul) a été écrit par l'usager (`email` égal à
`usager.email`) et qu'aucun message d'un instructeur ne le suit.

- Remplace le filtre « Avec messages » par « En attente de réponse · N ».
- Badge sur la carte, `--admin` : « Réponse attendue · J+x » (jours depuis ce message).

---

## 6. Hors périmètre : boîte de réception transverse de l'agent

Prévue ensuite : une vue unique des messages reçus sur **toutes** les démarches déclarées, triée par
date, filtrable par démarche, avec l'indicateur du § D. Elle demandera un cache local (SQLite) et
une synchronisation incrémentale (selon le § 0.2). Ne pas l'anticiper dans ce chantier, mais
garder la récupération des messages isolée dans une fonction réutilisable par démarche.

---

## 7. Critères d'acceptation

- **A** : deux démarches déclarées s'affichent sur l'accueil et ont chacune leur kanban ; un numéro
  non déclaré renvoie 404 sur toutes les routes ; un dossier d'une démarche A ne s'ouvre pas sous
  l'adresse de la démarche B ; aucune mutation possible sur une démarche dont `mutations` est faux.
- **B** : à l'ajout d'une démarche, la fiche s'ouvre pré-remplie avec les raisons des propositions ;
  rien n'est écrit avant validation ; « Montant accordé » ne propose que des annotations privées
  numériques ; plusieurs lignes de financement peuvent être enregistrées ; la source du millésime
  est affichée.
- **C1** : les totaux du bandeau sont égaux à la somme faite à la main ; un dossier accepté sans
  montant, un dossier hors enveloppe et un montant accordé avant instruction apparaissent en
  anomalie ; une enveloppe alimentée par deux démarches additionne les deux.
- **C2** : sur un dossier à deux lignes, l'une accordée et l'autre à 0 €, seule la première est
  comptée, sur sa propre enveloppe ; le programme d'une enveloppe ne se choisit que dans la liste
  fermée.
- **D** : un message de l'usager sans réponse fait apparaître l'indicateur ; une réponse de
  l'instructeur le fait disparaître après synchronisation.
- Toujours : jeton absent du front, de Git et des journaux ; page utilisable à 390 px.
