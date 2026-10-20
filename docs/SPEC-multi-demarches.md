# Spécification — Multi-démarches, fiche de paramétrage et suivi d'enveloppe

Suite de `docs/SPEC-kanban.md`, dont les règles restent valables : DN est la source de vérité,
le jeton ne quitte jamais le serveur, charte FORM 2026 (§ 8), pas de mise à jour optimiste.

Le back office ne connaît aujourd'hui qu'une démarche (`DN_DEMARCHE_NUMBER`, `config/demarche.json`).
Ce chantier le rend générique : **chaque démarche a sa fiche de paramétrage, et l'interface se
construit d'après elle.**

Livrer dans cet ordre, un commit par étape, chacune vérifiée avant la suivante :

- **A.** Multi-démarches (socle).
- **B.** Fiche de paramétrage, avec propositions automatiques.
- **C.** Enveloppes et suivi financier (C1, C2a, C2b, C3).
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
5. Avant C2b (vérifié le 19/10/2026) : `dossierModifierAnnotations(input: { dossierId, instructeurId,
   annotations: [AnnotationInput!]! })` ; `AnnotationInput = { id: ID!, value: AnnotationValueInput! }`,
   où `id` est l'identifiant du **champ du dossier** (pas du descripteur). `AnnotationValueInput` a
   une clé par type (`text`, `textarea`, `integerNumber: Int`, `decimalNumber: Float`,
   `dropDownList: String`…) et `repetition: Int`, qui **ajoute** des lignes à un bloc répétable.
   Aucune clé ne supprime une ligne. Le retour donne
   `annotations` et `errors { message }`. Reste à vérifier sur un dossier de test, au début du
   codage : qu'un sous-champ d'une ligne s'écrit avec l'`id` de son champ dans la ligne, et que
   `repetition: 1` ajoute exactement une ligne vide. Ces deux vérifications se font au début de C2b,
   avec le réglage `annotations` activé sur la 154701 uniquement.

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

La saisie du bloc de décision (§ C, « Saisie de la décision ») a son propre réglage, `annotations`
(faux par défaut), qui s'ajoute lui aussi à `DN_ENABLE_MUTATIONS`. Les deux réglages sont
indépendants.

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
  "annotations": false,
  "delaiCibleJours": 45,
  "champs": {
    "objet":          { "id": "<descripteur>", "libelle": "Intitulé du projet" },
    "montantDemande": { "id": "<descripteur>", "libelle": "Montant demandé" }
  },
  "finances": {
    "millesime": { "source": "champ", "ref": { "id": "<annotation>", "libelle": "Millésime" } },
    "coutTotal": { "id": "<descripteur>", "libelle": "Coût total HT" },
    "planFinancement": {
      "bloc":      { "id": "<descripteur>", "libelle": "Plan de financement" },
      "financeur": { "id": "<sous-champ>", "libelle": "Financeur" },
      "montant":   { "id": "<sous-champ>", "libelle": "Montant" },
      "statut":    { "id": "<sous-champ>", "libelle": "Statut" },
      "annee":     null,
      "financeursPublics": ["État", "Région", "Département", "Intercommunalité", "Union européenne", "Autre financeur public"]
    },
    "programmeSouhaite": { "id": "<descripteur>", "libelle": "Programme souhaité" },
    "tauxMaxAidesPubliques": 80,
    "motifRepartition": { "id": "<annotation>", "libelle": "Motif de répartition" },
    "blocDecision": {
      "bloc":     { "id": "<annotation>", "libelle": "Financement" },
      "regime":   { "id": "<sous-champ>", "libelle": "Régime d'aide" },
      "montant":  { "id": "<sous-champ>", "libelle": "Montant de l'aide" },
      "statut":   { "id": "<sous-champ>", "libelle": "Statut" },
      "assiette": { "id": "<sous-champ>", "libelle": "Assiette" },
      "referenceEngagement": { "id": "<sous-champ>", "libelle": "Référence d'engagement" },
      "statuts":  { "Demandé": "demande", "proposé": "propose", "accordé": "accorde" }
    },
    "regimes": {
      "Aide d'urgence": { "financeurs": ["État"], "systemeEngagement": "Chorus" },
      "Appel à projets aide aux investissements": { "financeurs": ["État"], "systemeEngagement": null }
    }
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
dispositif (DETR, DSIL…). Tous facultatifs. La décision est portée par un **bloc de décision** : un
bloc répétable d'annotations privées, dont chaque ligne est une **ligne de financement** (un régime
d'aide, son montant, son statut). Une seule ligne dans le cas courant ; plusieurs quand un dossier
est financé par plusieurs régimes (double dotation). L'instructeur ajoute les lignes dans DN, ou
depuis le back office (§ C, « Saisie de la décision »).

| Rôle | Niveau | Types acceptés | Remarque |
|---|---|---|---|
| Millésime | démarche | champ ou annotation nombre entier, ou liste dont toutes les options sont des années ; sinon année de dépôt | `{source: "champ", ref}` ou `{source: "anneeDepot"}` |
| **Coût total** | démarche | champ nombre du formulaire, hors bloc | base de la part du coût total et des taux d'aide publique |
| **Plan de financement** | démarche | bloc répétable du formulaire ; sous-champs financeur (liste), montant (nombre), statut (liste, facultatif), année (facultatif) | l'agent coche aussi les **financeurs publics** parmi les options du sous-champ financeur |
| **Programme souhaité** | démarche | liste déroulante du formulaire, hors bloc (une valeur par dossier), facultative | départage les régimes d'un même financeur ; ses options doivent correspondre à celles du régime d'aide |
| **Taux maximal des aides publiques** | démarche | nombre en %, saisi dans la fiche, facultatif | plafond du cumul des aides publiques (§ C, anomalies non bloquantes) |
| Motif de répartition | démarche | annotation texte, facultative | affiché dans l'onglet Demande de la fiche dossier |
| **Bloc de décision** | démarche | bloc répétable d'**annotations privées** | une ligne du bloc = une ligne de financement |
| ↳ Régime d'aide | sous-champ | liste déroulante | **c'est le programme** de la ligne ; ses options forment la liste fermée des programmes d'enveloppe |
| ↳ Montant | sous-champ | nombre (entier ou décimal) | **montant accordé** de la ligne, base du calcul de l'enveloppe ; seule source du montant accordé |
| ↳ Statut | sous-champ | liste déroulante | chaque option est rapprochée d'une valeur générique : *demandé*, *proposé*, *accordé* (`statuts`) |
| ↳ Assiette | sous-champ | nombre, facultatif | taux de la ligne = montant ÷ assiette, affiché, jamais additionné |
| ↳ Référence d'engagement | sous-champ | texte, facultatif ; valeur libre | indicateur « engagé » ; futur rapprochement, par système |
| **Table des régimes** | démarche | pour chaque option du régime : **financeurs** (une ou plusieurs options du sous-champ financeur du plan) et **système d'engagement** (texte libre, facultatif : Chorus, Osiris, logiciel de la collectivité…) | les financeurs rattachent le montant demandé du plan à un régime ; le système d'engagement est seulement affiché pour l'instant, il servira au rapprochement, plus tard et système par système |

Le type « engagement juridique » natif de DN n'est pas utilisé.

Côté usager, le plan de financement reste au niveau du **financeur** (« État ») : l'usager ne connaît
pas les régimes. Le bloc de décision n'a pas de sous-champ financeur : c'est la table des régimes
qui fait foi.

**Comparaison des libellés** (régime, programme souhaité, financeur, options de statut) : toujours
après normalisation de la casse, des accents, des espaces (début, fin, espaces multiples et
insécables) et des apostrophes (`'`, `‘`, `’`). « Aide d’urgence » et « aide d'urgence » sont égaux ;
« Aide urgence » ne l'est pas.

Un champ d'un bloc répétable du formulaire peut être désigné pour les rôles numériques du formulaire
(coût total, montant des cartes) : sa valeur est la somme des lignes renseignées.

**Lignes de financement d'un dossier** : une par régime présent dans le bloc de décision ; plus une
ligne au statut *demandé* pour chaque régime qui reçoit un montant demandé du plan sans figurer encore
dans le bloc. Une ligne du bloc sans régime est ignorée, sauf si un montant ou un statut y est saisi
(anomalie « ligne sans régime »). Deux lignes du bloc avec le même régime : anomalie « régime en
double » qui désigne les deux lignes (« lignes 1 et 3 »), rien n'est compté pour ce régime.

**Montant demandé d'un régime** :

1. avec un plan de financement : chaque ligne du plan va au régime que la correspondance associe à
   son financeur ; s'il y en a plusieurs, au régime égal au programme souhaité du dossier ; à défaut,
   il est compté comme **« demandé non affecté »** ;
2. sans plan : le montant demandé des cartes va au programme souhaité, ou au seul régime du bloc ;
   à défaut, demandé non affecté.

**Montant demandé des cartes** : avec un plan, somme des lignes du plan dont le financeur figure dans
la table des régimes (« demandé sur nos régimes »). `champs.montantDemande` ne peut alors plus désigner
le sous-champ montant du plan, qui additionnerait tous les financeurs.

L'ancien réglage `lignes` (une annotation par rôle et par programme) est abandonné sans migration :
aucune fiche enregistrée ne l'utilise. Une fiche qui en contiendrait encore est lue sans lui, et la
fiche de paramétrage le signale.

Le **périmètre** (département, commune) est hors de ce chantier (§ C, « Plus tard »).

### Source du millésime

La fiche affiche la source retenue. Si c'est l'**année de dépôt**, elle le signale (« millésime
déduit de l'année de dépôt, aucun champ désigné ») et chaque enveloppe compte les dossiers
concernés (§ C). Si un champ est désigné mais vide sur un dossier, l'année de dépôt s'applique à ce
dossier, compté de même en « millésime par défaut ».

### Propositions automatiques

La route `proposition` lit `activeRevision.champDescriptors` et `annotationDescriptors` et
pré-sélectionne, **avec la raison affichée** à côté de chaque proposition :

| Réglage | Candidats | Règle de proposition |
|---|---|---|
| Objet | champs texte du formulaire | libellé contenant « objet », « intitulé », « projet », « titre » ; sinon le premier champ texte |
| Montant demandé | champs nombre du formulaire | « montant », « demandé », « subvention », « € » ; seul champ nombre |
| Millésime | champs ou annotations entier ou liste | « année », « millésime », « exercice » ; sinon année de dépôt |
| Coût total | nombres du formulaire hors bloc | « coût », « total », « HT » |
| Plan de financement | blocs répétables contenant au moins une liste et un nombre | « financement », « financeur », « plan » ; seul bloc qui convient |
| Sous-champs du plan | listes et nombres du bloc | financeur : « financeur », sinon première liste ; montant : « montant », sinon premier nombre ; statut : « statut », « état » ; année : « année », « exercice » |
| Financeurs publics | options du sous-champ financeur | État, Région, Département, Intercommunalité, Union européenne, Autre financeur public (options qui portent ces libellés) |
| Programme souhaité | listes du formulaire, hors bloc | « programme », « régime », « souhaité », « dotation » |
| Motif de répartition | annotations texte | « motif », « répartition » |
| Bloc de décision | blocs d'annotations contenant au moins une liste et un nombre | « financement », « décision », « aide » ; seul bloc qui convient |
| ↳ Régime | listes du bloc | « régime », « programme », « dispositif » ; sinon la liste qui n'est pas le statut |
| ↳ Montant | nombres du bloc | « montant », « aide », « accordé » |
| ↳ Statut | listes du bloc | « statut », « état », « décision » |
| ↳ Assiette | nombres du bloc | « assiette », « éligible » |
| ↳ Référence d'engagement | textes du bloc | « engagement », « référence », « EJ », « Chorus » |
| Valeurs de statut | options du statut | « demand » → demandé ; « propos » → proposé ; « accord », « attribu » → accordé ; sinon à choisir |
| Régime → financeurs | options du financeur du plan | une option qui figure dans le libellé du régime ; sinon l'option « État » ; sinon à choisir |
| Système d'engagement | — | aucune proposition (vide) |

L'agent valide ou corrige chaque proposition. **Rien n'est enregistré sans le bouton « Enregistrer
le paramétrage »**, qui affiche ensuite la date de validation.

### Interface (`/demarches/:numero/parametres`)

Sections, de haut en bas :

1. **Démarche** (lecture) : titre, n°, état, date de publication de la révision, nombre de champs et
   d'annotations. Champ « Libellé court ».
2. **Affichage des cartes** : listes déroulantes Objet et Montant demandé ; délai cible (jours).
3. **Données financières** : millésime (avec sa source) ; coût total ; plan de financement (bloc,
   sous-champs, cases « financeurs publics ») ; programme souhaité ; taux maximal des aides
   publiques ; motif de répartition ; **bloc de décision** et ses sous-champs ; tableau **valeurs de
   statut** (une liste par option) ; **table des régimes** (par régime : cases des financeurs et
   système d'engagement). Chaque
   liste ne propose que les types acceptés pour son rôle.
   - S'il n'y a aucun bloc répétable d'annotations : message « Aucun bloc répétable dans les
     annotations privées. Créez-en un dans l'éditeur de la démarche sur DN (régime d'aide, montant,
     statut), puis actualisez », avec lien vers DN.
   - En lecture : enveloppes alimentées par la démarche, avec lien (elles se créent ailleurs, § C).
4. **Changements d'état et saisie** : case « Autoriser les changements d'état sur cette démarche » ;
   case « Autoriser la saisie du bloc de décision depuis le back office » ; rappel que
   `DN_ENABLE_MUTATIONS` doit aussi être actif.

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

- `programme` : facultatif (`null` = tous régimes). Il se choisit dans une **liste fermée**, pas
  en texte libre : les options du sous-champ « régime d'aide » du bloc de décision des démarches
  rattachées. Une valeur qui a disparu de cette liste est signalée en anomalie.
- `parent` (délégation) : facultatif ; sert seulement au contrôle « somme des enveloppes filles ≤
  enveloppe mère », sans effet sur les calculs.
- `demarches` : uniquement des démarches déclarées.

### Règle d'imputation

Pour chaque dossier d'une démarche qui alimente au moins une enveloppe, et pour chaque ligne de
financement : les enveloppes candidates sont celles dont `demarches` contient la démarche, dont
`millesime` égale le millésime du dossier, et dont `programme` est `null` ou égal au régime de la
ligne.

| Candidates | Résultat |
|---|---|
| 1 | la ligne est imputée sur cette enveloppe |
| 0 | anomalie « hors enveloppe » |
| plusieurs | anomalie « plusieurs enveloppes possibles », rien n'est imputé |

Un dossier n'est **jamais ignoré en silence**. Une démarche qui n'alimente aucune enveloppe n'est pas
suivie (pas d'anomalie).

### Statut financier, par imputation

DN n'a qu'un état par dossier ; le statut financier se porte donc **par ligne imputée**. **L'état DN
prime, le statut de la ligne le précise ; un désaccord est toujours une anomalie, jamais une
correction silencieuse.** Un statut vide sans montant vaut *demandé*.

| État DN | Statut de la ligne | Statut financier |
|---|---|---|
| en construction | demandé | **demandé** |
| en construction | proposé ou accordé | **demandé**, anomalie « décision saisie avant instruction » |
| en instruction | demandé | **demandé** |
| en instruction | proposé | **programmé** |
| en instruction | accordé | **programmé**, repère « décidé, à notifier » |
| accepté | accordé, montant > 0 | **accepté** (et **engagé** si la référence d'engagement est renseignée) |
| — | accordé, montant à 0 | **non retenu** sur ce régime |
| accepté | demandé ou proposé | anomalie, la ligne n'est pas comptée |
| refusé, classé sans suite | — | hors calcul ; anomalie si une ligne est « accordé » avec un montant > 0 |

### Indicateurs par enveloppe (serveur, à chaque synchronisation)

- **Montant** (saisi) · **Demandé** (montant demandé des lignes « demandé » ou « programmé ») ·
  **Programmé** (montant accordé des lignes « programmé ») · **Accepté** · **Engagé** (part de
  l'accepté qui porte une référence d'engagement) · **Reste** = montant − accepté · **Reste prévisionnel** = reste − programmé.
- **Demandé non affecté** : montant d'un financeur partagé que le programme souhaité n'a pas permis
  d'affecter (§ B). Il est compté une fois dans chaque enveloppe où une ligne qui partage ce
  financeur est imputée, n'entre ni dans « Demandé » ni dans le reste, et renvoie à la liste des
  dossiers concernés. **Il n'est jamais additionné d'une enveloppe à l'autre** (page `/enveloppes`,
  accueil) : aucun total transverse n'en est fait.
- **Millésime par défaut** : nombre de dossiers imputés dont le millésime vient de l'année de dépôt
  (aucun champ désigné, ou champ vide sur le dossier).
- Calcul en centimes entiers ; affichage `Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" })`.

**Anomalies**, listées avec n° de dossier cliquable, jamais ignorées en silence :

- hors enveloppe ; plusieurs enveloppes possibles ;
- décision saisie avant instruction ; ligne « accordé » d'un dossier refusé ou classé sans suite ;
- dossier accepté dont une ligne est « demandé » ou « proposé » ; dossier accepté sans aucune ligne
  retenue (aucune ligne, ou toutes à 0 €) ;
- ligne « accordé » sans montant ; montant saisi sans statut ; option de statut sans valeur
  générique dans la fiche ;
- ligne sans régime ; régime en double ; régime sans correspondance vers un financeur (son montant
  demandé ne peut pas être rattaché) ;
- valeur non numérique ou négative ; millésime illisible ;
- champ référencé introuvable dans la révision publiée ; programme d'enveloppe absent de la liste fermée ;
- enveloppes filles dont le total dépasse la mère.

**Anomalies non bloquantes** (signalées, rien n'est retiré du calcul) :

- montant accordé supérieur au montant demandé du régime, ou supérieur à l'assiette ;
- taux d'aide publique supérieur au taux maximal des aides publiques : le **taux après décision**
  s'il existe, sinon le taux cumulé prévisionnel ; sans plan de financement, le taux de chaque ligne ;
- somme du plan de financement différente du coût total (tolérance 1 €).

### Taux d'aide publique (par dossier, serveur)

Calculés sur le plan de financement, en rapport au coût total ; toutes les lignes du plan comptent,
quel que soit leur statut :

- **cumulé prévisionnel** = financeurs publics du plan ÷ coût total ;
- **dont aides obtenues** = financeurs publics au statut « obtenue » ÷ coût total (si le sous-champ
  statut est désigné) ;
- **après décision** = (aides publiques des financeurs qui ne relèvent d'aucun régime
  + pour chaque régime, son montant s'il est renseigné dans le bloc de décision, sinon son montant
  demandé) ÷ coût total. Il n'existe que si au moins un montant est renseigné dans le bloc ; c'est
  alors lui qui déclenche l'anomalie de plafond.

### Fiche dossier, onglet Demande

Quand un plan de financement est désigné : tableau du plan (financeur, montant, statut, part du coût
total), financeurs publics repérés ; dessous, total des aides publiques, coût total et les trois taux ;
les anomalies non bloquantes en `--warn`. Sous les lignes de financement (régime, statut DN et
financier, demandé, montant, assiette, taux, référence d'engagement et système d'engagement du
régime), le **motif de répartition** s'il est renseigné.

### Saisie de la décision (C2b, mutation `dossierModifierAnnotations`)

Autorisée par l'utilisateur le 19/10/2026, **pour le seul bloc de décision** : modifier le régime,
le montant, le statut, l'assiette et la référence d'engagement d'une ligne, et ajouter une ligne au bloc. Aucune
autre annotation, aucun champ du formulaire.

Garde-fous :

1. **Deux interrupteurs** : `DN_ENABLE_MUTATIONS=1` et le réglage `annotations` de la démarche (faux
   par défaut). Sans l'un des deux, la route répond 403 et la fiche n'affiche pas les commandes de
   saisie.
2. **Seuls les champs reliés à un rôle** sont modifiables : le serveur vérifie que chaque champ
   envoyé appartient au dossier, à une ligne du bloc de décision désigné, et que son descripteur est
   l'un des sous-champs désignés (régime, montant, statut, assiette, référence d'engagement). Il
   refuse tout autre identifiant (422).
3. **Valeurs validées** contre la révision publiée : option existante pour une liste ; nombre ≥ 0,
   entier pour un champ nombre entier (et au plus 2 147 483 647, limite du type `Int` de l'API) ;
   référence d'engagement en texte libre, d'au plus 200 caractères.
4. **Relecture avant écriture** : le front envoie, pour chaque champ, l'ancienne valeur qu'il a
   affichée et la nouvelle. Le serveur relit le dossier dans DN juste avant d'écrire ; si une seule
   ancienne valeur ne correspond plus, **rien n'est écrit** (409, « valeur modifiée dans DN entre-temps,
   rechargez le dossier »). L'API n'ayant pas d'écriture conditionnelle, il reste un intervalle de
   quelques centaines de millisecondes entre relecture et écriture : c'est accepté et documenté.
5. **Confirmation** : la fenêtre liste chaque modification, **ancienne valeur → nouvelle valeur**,
   avec le libellé DN du champ et le régime de la ligne. Rien n'est envoyé sans le bouton
   « Enregistrer dans DN ».
6. **Dossier accepté** (et aussi refusé ou classé sans suite) : avertissement en `--warn` dans la
   confirmation (« Ce dossier est accepté : la décision a été notifiée à l'usager. Modifier le
   montant change l'accepté de l'enveloppe, sans nouvelle notification »), sans bloquer.
7. **Journal** : une ligne JSON par tentative dans `logs/annotations.log` (ignoré par git) : date,
   démarche, dossier, sous-champ (rôle, descripteur), ancienne et nouvelle valeur, ajout de ligne,
   résultat. Ni le jeton, ni aucune autre donnée du dossier.
8. **Pas de mise à jour optimiste** : après succès, la fiche et le kanban sont relus depuis DN.

**Ajout d'une ligne** : en deux temps, `repetition: 1` sur le bloc, relecture du dossier pour obtenir
les champs de la nouvelle ligne, puis écriture de ses valeurs. Si la seconde écriture échoue, la ligne
vide reste dans DN (elle est ignorée par le calcul) et le message le dit. **Supprimer une ligne** n'est
pas possible par l'API : la fiche renvoie vers DN.

Interface : dans l'onglet Demande, sous les lignes de financement, bouton « Modifier la décision »
(seulement si les deux interrupteurs sont actifs). Il rend chaque ligne modifiable (liste du régime,
liste du statut, montants, référence d'engagement), avec « Ajouter une ligne » ; « Vérifier les modifications » ouvre
la confirmation.

Adresse serveur : `POST /api/demarches/:numero/dossiers/:n/decision`, corps
`{ modifications: [{ champId, role, avant, apres }], nouvelleLigne: { regime, montant, statut,
assiette, referenceEngagement } | null }`.

### Adresses

| Front | Contenu |
|---|---|
| `/enveloppes` | Liste des enveloppes avec jauges ; « Créer une enveloppe » |
| `/enveloppes/:id` | Indicateurs, dossiers imputés (statut, montant), anomalies, édition |

| Serveur | Méthode |
|---|---|
| `/api/enveloppes` | GET (avec indicateurs), POST |
| `/api/enveloppes/:id` | GET, PUT, DELETE |
| `/api/enveloppes/programmes?demarches=…` | GET : liste fermée des programmes possibles (C2a) |

### Affichage

- **Bandeau au-dessus du kanban** : une jauge par enveloppe alimentée par la démarche — accepté
  (plein, `--admin`) + programmé (`--admin-soft`) sur le total ; chiffres en clair (montant,
  accepté, programmé, engagé, reste) ; pourcentage. Dépassement : reste et jauge en `--bad`, message
  explicite. Anomalies : badge `--warn` avec leur nombre et lien vers la liste. Équivalent textuel
  accessible (pas de couleur seule).
- **Accueil** : jauge réduite sur la carte de chaque démarche ; lien « Enveloppes » dans l'en-tête.
- **Cartes du kanban** : montant accordé, par régime s'il y en a plusieurs (« DETR 40 000 € · DSIL 0 € ») ;
  repère « Décidé, à notifier » (`--admin`) ; le bandeau en donne le nombre.
- **Confirmation « Accepter »** : montant accordé par ligne et reste de chaque enveloppe après
  acceptation ; si aucun montant n'est renseigné, avertir (« le montant accordé n'est pas renseigné :
  ce dossier ne sera pas imputé »), sans bloquer.

### Livraison

- **C1** : enveloppes, imputation par démarche et millésime (`programme` toujours `null`) ;
  indicateurs, bandeau, anomalies ; coût total, plan de financement, programme souhaité,
  affectation par financeurs, demandé non affecté, taux d'aide publique, onglet Demande. Les
  lignes multiples, déjà dans la fiche depuis B, sont imputées sur des enveloppes sans programme.
- **C2a** (lecture seule) : bloc de décision (remplace les lignes de C1), table des régimes
  (financeurs, système d'engagement), table des statuts ci-dessus, repère « décidé, à notifier » ;
  programme d'enveloppe choisi parmi les régimes (liste fermée) et imputation par régime.
  Sous-champs « Assiette » et « Référence d'engagement » facultatifs.
- **C2b** : saisie de la décision depuis le back office. Commence par les deux vérifications du
  § 0.5, sur un dossier de test, avec `annotations` activé sur la 154701 uniquement.
- **C4** (après C3, si besoin) : le sous-champ « Année » du plan de financement, s'il est
  désigné, donne le millésime de chaque ligne du plan pour l'imputation.
- **C3** (après C1) : encadré **« Aides déjà accordées à ce SIRET »** dans la fiche dossier :
  dossiers acceptés du même SIRET dans toutes les démarches déclarées, sur les trois dernières
  années, avec leurs montants accordés.
  Précisions (C3) : trois ans glissants à compter du jour, sur la date de traitement ; le dossier
  consulté est exclu ; SIRET comparé sans les espaces ; montant accordé = lignes « accepté » du bloc
  de décision (« non renseigné » sans bloc ou sans ligne, repère « à vérifier » si le calcul du
  dossier a une anomalie grave) ; total des seuls montants renseignés, avec le nombre de dossiers
  sans montant. Encadré chargé après la fiche (`GET …/dossiers/:n/aides-siret`, filtre DN
  `state: accepte`), masqué pour une personne physique ; une démarche inaccessible est signalée
  sans bloquer les autres. Pas de stockage : chaque ouverture relit les dossiers acceptés.

Validation de l'utilisateur entre chaque livraison.

### Plus tard (hors chantier)

Périmètre (département ou commune issus de l'adresse ou du SIRET) ; « payé » et rapprochement par
référence d'engagement, système par système (Chorus, Osiris…) ; simulations ; écriture d'autres annotations (nouvel accord explicite de
l'utilisateur).

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
  rien n'est écrit avant validation ; le bloc de décision ne propose que des blocs d'annotations
  privées ; la source du millésime est affichée.
- **C1** : les totaux du bandeau sont égaux à la somme faite à la main ; un dossier accepté sans
  montant, un dossier hors enveloppe et un montant accordé avant instruction apparaissent en
  anomalie ; une enveloppe alimentée par deux démarches additionne les deux.
- **C1, plan de financement** : plan « État 30 000 € » + « Région 20 000 € », coût total 60 000 € :
  une ligne `["État"]` a 30 000 € demandés ; le taux cumulé prévisionnel vaut 83,3 % et déclenche
  l'anomalie face à un plafond de 80 % ; l'écart de 10 000 € avec le coût total est signalé ; le
  demandé non affecté d'un même dossier n'est jamais compté deux fois dans un total.
- **C2a** : un dossier en instruction avec « Aide d'urgence, accordé, 2 000 € » dans le bloc est
  compté en programmé, avec le repère « décidé, à notifier » ; accepté, il est compté en accepté ;
  refusé avec cette ligne, il apparaît en anomalie ; en construction avec « proposé », anomalie
  « décision saisie avant instruction ». Sur un dossier à deux régimes, l'un accordé et l'autre à
  0 €, seul le premier est compté, sur sa propre enveloppe ; le programme d'une enveloppe ne se
  choisit que parmi les régimes.
- **C2b** : sans le réglage `annotations`, aucune commande de saisie et la route répond 403 ;
  un identifiant de champ hors du bloc de décision est refusé ; une valeur modifiée dans DN après
  l'ouverture de la fiche fait échouer l'enregistrement (409) sans rien écrire ; le journal contient
  ancienne et nouvelle valeur, sans le jeton ; un dossier accepté affiche l'avertissement.
- **C3** : un SIRET avec un dossier accepté sur une autre démarche déclarée l'affiche avec son
  montant accordé.
- **D** : un message de l'usager sans réponse fait apparaître l'indicateur ; une réponse de
  l'instructeur le fait disparaître après synchronisation.
- Toujours : jeton absent du front, de Git et des journaux ; page utilisable à 390 px.
