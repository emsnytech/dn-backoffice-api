# Spécification — Multi-démarches, fiche de paramétrage et suivi d'enveloppe

Suite de `docs/SPEC-kanban.md`, dont les règles restent valables : DN est la source de vérité,
le jeton ne quitte jamais le serveur, charte FORM 2026 (§ 8), pas de mise à jour optimiste.

Le back office ne connaît aujourd'hui qu'une démarche (`DN_DEMARCHE_NUMBER`, `config/demarche.json`).
Ce chantier le rend générique : **chaque démarche a sa fiche de paramétrage, et l'interface se
construit d'après elle.**

Livrer dans cet ordre, un commit par étape, chacune vérifiée avant la suivante :

- **A.** Multi-démarches (socle).
- **B.** Fiche de paramétrage, avec propositions automatiques.
- **C.** Suivi d'enveloppe financière.
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
| `/api/demarches` | GET : démarches déclarées + résumé (compteurs par état, enveloppe) |
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
compteurs par colonne du kanban, jauge d'enveloppe si elle est paramétrée (§ C), lien
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
    "objet":          { "id": "<champDescriptorId>", "libelle": "Intitulé du projet" },
    "montantDemande": { "id": "<champDescriptorId>", "libelle": "Montant demandé" }
  },
  "enveloppe": {
    "active": true,
    "montant": 500000,
    "champCalcul": { "id": "<annotationDescriptorId>", "libelle": "Montant accordé" },
    "engageEnInstruction": "montantDemande"
  },
  "valideLe": "2026-10-18T19:30:00+02:00"
}
```

- Un champ est référencé par son **identifiant de descripteur**, stable d'une révision à l'autre ;
  le libellé est stocké pour l'affichage et pour détecter un champ disparu.
- Si un champ référencé n'existe plus dans `activeRevision`, la fiche et le kanban affichent une
  alerte « champ introuvable dans la révision publiée » et le calcul concerné est suspendu
  (jamais de somme silencieusement fausse).

### Propositions automatiques

La route `proposition` lit `activeRevision.champDescriptors` et `annotationDescriptors` et
pré-sélectionne, **avec la raison affichée** à côté de chaque proposition :

| Réglage | Candidats | Règle de proposition |
|---|---|---|
| Objet | champs texte du formulaire | libellé contenant « objet », « intitulé », « projet », « titre » ; sinon le premier champ texte |
| Montant demandé | champs **nombre** du formulaire | libellé contenant « montant », « demandé », « subvention », « € » ; seul champ nombre |
| Champ de calcul de l'enveloppe | **annotations privées de type nombre uniquement** | libellé contenant « accordé », « attribué », « montant » ; seule annotation nombre |

L'agent valide ou corrige chaque proposition. **Rien n'est enregistré sans le bouton « Enregistrer
le paramétrage »**, qui affiche ensuite la date de validation.

### Interface (`/demarches/:numero/parametres`)

Sections, de haut en bas :

1. **Démarche** (lecture) : titre, n°, état, date de publication de la révision, nombre de champs et
   d'annotations. Champ « Libellé court ».
2. **Affichage des cartes** : listes déroulantes Objet et Montant demandé ; délai cible (jours).
3. **Enveloppe financière** : case « Suivre une enveloppe » ; montant de l'enveloppe (€, saisi par
   l'agent : ce montant n'existe pas dans DN) ; **champ sur lequel porte le calcul** : liste
   restreinte aux annotations privées numériques, avec pour chacune son libellé et son type.
   - S'il n'y en a aucune : message « Aucune annotation privée de type nombre dans cette démarche.
     Ajoutez-en une dans l'éditeur de la démarche sur DN (ex. « Montant accordé »), puis actualisez »,
     avec lien vers DN. La case reste décochée.
   - Choix de l'engagé prévisionnel en instruction : « montant demandé » / « champ de calcul s'il est
     renseigné » / « ne pas compter ».
4. **Changements d'état** : case « Autoriser les changements d'état sur cette démarche » (avec rappel
   que `DN_ENABLE_MUTATIONS` doit aussi être actif).

Chaque liste montre le libellé DN exact du champ et sa position dans le formulaire, pour éviter les
confusions entre champs homonymes.

---

## C. Suivi d'enveloppe

### Calcul (serveur)

Sur les dossiers de la démarche, à chaque synchronisation :

- **Consommé** = somme du champ de calcul des dossiers `accepte`.
- **Engagé prévisionnel** = selon le réglage, somme sur les dossiers `en_instruction`.
- **Reste** = enveloppe − consommé ; **reste prévisionnel** = reste − engagé.
- **Anomalies** à remonter : dossiers acceptés dont le champ de calcul est vide ; valeur non
  numérique ou négative. Elles sont listées (n° de dossier cliquable), jamais ignorées en silence.
- Calcul en centimes entiers ; affichage `Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" })`.

### Affichage

- **Bandeau au-dessus du kanban** : jauge horizontale « consommé » (plein, `--admin`) +
  « engagé prévisionnel » (hachuré ou `--admin-soft`) sur le total ; chiffres en clair à côté
  (enveloppe, consommé, engagé, reste) ; pourcentage consommé. Dépassement : reste et jauge en
  `--bad`, message explicite. Anomalies : badge `--warn` « N dossiers acceptés sans montant
  accordé ». La jauge a un équivalent textuel accessible (pas de couleur seule).
- **Accueil** : version réduite de la jauge sur la carte de la démarche.
- **Cartes acceptées** : afficher le montant accordé.
- **Boîte de confirmation « Accepter »** : afficher le montant accordé du dossier et le reste après
  acceptation ; si le champ de calcul est vide, avertir (« le montant accordé n'est pas renseigné :
  ce dossier ne sera pas imputé »), sans bloquer.

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
  rien n'est écrit avant validation ; le champ de calcul ne propose que des annotations privées
  numériques.
- **C** : sur la démarche de test, les totaux du bandeau sont égaux à la somme faite à la main
  sur les dossiers acceptés ; un dossier accepté sans montant apparaît en anomalie.
- **D** : un message de l'usager sans réponse fait apparaître l'indicateur ; une réponse de
  l'instructeur le fait disparaître après synchronisation.
- Toujours : jeton absent du front, de Git et des journaux ; page utilisable à 390 px.
