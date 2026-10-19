# Revue — Analyse de « Gestion des subventions locales » (Turgot)

Date : 19 octobre 2026 · Session de relecture · Dépôt analysé :
<https://github.com/betagouv/gestion-des-subventions-locales> (commit du 19/10/2026, 08:22 UTC)

Objet : en tirer ce qui sert l'objectif « rendre Démarche Numérique autonome pour l'exploitation
des enveloppes financières », avant de réaliser l'étape C de `docs/SPEC-multi-demarches.md`.

---

## 1. Ce qu'est l'application

Back office complet de la DETR et de la DSIL (dotations d'investissement des collectivités),
pour les préfectures. Nom interne : **Turgot**.

- Django + PostgreSQL + Redis/Celery, HTMX, DSFR, ProConnect ; hébergé sur Scalingo.
- ~27 000 lignes de Python hors tests et migrations ; trois contributeurs principaux ; très actif
  (commits quotidiens, refonte « campagne / enveloppe projet » en cours cette semaine).
- Cycle couvert : import des dossiers DN → instruction par dotation → **simulations** de
  répartition → **programmation** → génération des arrêtés et lettres → notification dans DN →
  rapprochement avec **Chorus**.

## 2. Comment elle se branche à DN

| Sujet | Ce que fait Turgot | Intérêt pour nous |
|---|---|---|
| Lecture | Copie les dossiers dans sa propre base (synchronisation « pull ») | Modèle inverse du nôtre (DN source de vérité, pas de copie) |
| Synchronisation | `dossiers(updatedSince:)` + curseurs, plus `pendingDeletedDossiers` et `deletedDossiers` | **Confirme le § 0.2 de la spec** : la synchro incrémentale existe, suppressions comprises |
| Correspondance des champs | Modèle `FieldMapping` : par démarche, `ds_field_id` → champ Django, libellé mémorisé à la première rencontre, actif/inactif, administrable | Même principe que notre référence par identifiant de descripteur ; à reprendre (voir § 4) |
| Écriture | `dossierModifierAnnotations` (assiette, montant accordé, taux), changements d'état, pièces jointes par `createDirectUpload` | **Les montants décidés sont réécrits dans les annotations privées de DN** |
| Partenaires | Proxy GraphQL en lecture seule, limité à une démarche et un groupe instructeur, jeton propre, liste blanche de champs, mutations refusées | Bon patron pour ouvrir nos données à un tiers sans donner le jeton |

## 3. Comment elle modélise l'argent

- **Enveloppe** = dotation × année × périmètre (région, département, arrondissement), avec un
  **montant** et une **enveloppe parente** : la délégation descend région → département →
  arrondissement, avec des règles par dotation (pas de DETR régionale, DSIL non déléguée
  forcément régionale…). Une enveloppe est reconduite d'une année sur l'autre par défaut.
- **EnveloppeProjet** : l'imputation d'un projet sur une enveloppe, avec son **assiette**, son
  **montant**, sa **date de programmation**, un statut propre (en cours, accepté, refusé, classé
  sans suite) et un indicateur « courant ». Un projet peut avoir **deux imputations** (DETR et DSIL).
- **Simulation** : scénarios de répartition sur une enveloppe, comparables, avant d'en confirmer un.
- **Consommation** : agrégat sur les imputations de l'enveloppe racine — montant demandé, montant
  accepté, nombre de projets validés et refusés, nombre de demandeurs.
- **Chorus** : import d'un export Excel ; l'engagement juridique (EJ) est relié au dossier
  **en cherchant un numéro DN à 8 chiffres saisi à la main** dans la colonne « Axe ministériel 2 »
  (« DN-30736671 », « DS : 15480250 », « DS-n°16090518 »…). Types de pièces et de montants
  (engagé, modifié, réduit, payé) conservés ligne à ligne.

## 4. Enseignements

1. **L'enveloppe n'est pas la démarche.** Une démarche peut alimenter plusieurs enveloppes
   (double dotation, plusieurs millésimes, plusieurs territoires) et une enveloppe peut être
   alimentée par plusieurs démarches. Notre spec (§ B/C : une enveloppe dans la fiche de la
   démarche) est trop simple : il faut une entité **Enveloppe** indépendante et une **règle
   d'imputation** qui rattache chaque dossier à une ou plusieurs enveloppes.

2. **Un seul état DN ne suffit pas au suivi financier.** DN n'a qu'un état par dossier ; Turgot
   doit afficher l'issue « la plus favorable » quand DETR est acceptée et DSIL refusée. Le statut
   financier se porte donc **par imputation**, pas par dossier.

3. **Le cycle financier a plus d'étapes que « accepté ».** Demandé → simulé → **programmé**
   (décision interne) → accepté et notifié (DN) → **engagé** (EJ Chorus) → **payé**. Notre
   « consommé = acceptés » ne voit ni la programmation avant notification, ni l'exécution après.

4. **Le schéma de Turgot est spécifique ; son mécanisme ne l'est pas.** Les champs cibles sont
   écrits en dur pour la DETR/DSIL (`annotations_montant_accorde_detr`, `…_dsil`, catégories DETR…).
   Le `FieldMapping` ne sert qu'à brancher une démarche *qui ressemble* à la DETR. Pour une
   démarche quelconque, il faut faire correspondre les champs à un **vocabulaire financier
   générique**, pas à un schéma métier.

5. **Le rapprochement Chorus repose sur une saisie manuelle fragile.** Un champ « n° d'EJ » porté
   par le dossier DN (annotation privée) rendrait le lien fiable dans les deux sens.

6. **Turgot réécrit les décisions dans DN.** C'est la condition pour que DN reste exploitable
   seul : si les montants vivent dans des annotations privées, n'importe quel outil (ou DN
   lui-même, plus tard) peut recalculer la consommation.

## 5. Proposition pour notre back office (à valider avant l'étape C)

### Vocabulaire financier générique

Par démarche, la fiche de paramétrage fait correspondre des champs DN à ces rôles (tous
facultatifs, par identifiant de descripteur) :

| Rôle | Source habituelle |
|---|---|
| Montant demandé | champ du formulaire |
| Coût total / assiette éligible | formulaire ou annotation |
| **Montant accordé** (calcul de l'enveloppe) | annotation privée numérique |
| Taux | calculé, ou annotation |
| Programme / dotation | liste déroulante (formulaire ou annotation) |
| Millésime | annotation, sinon année de dépôt |
| Périmètre | département ou commune issus de l'adresse ou du SIRET |
| N° d'engagement juridique | annotation privée texte |

Pour la double dotation : permettre **plusieurs jeux** « montant accordé / taux / assiette »,
un par programme (comme les annotations DETR et DSIL de Turgot).

### Enveloppe indépendante

`programme` × `millésime` × `périmètre` (facultatif), `montant`, `parent` (délégation
facultative). Stockage local (SQLite), seule donnée qui n'existe pas dans DN.

### Règle d'imputation

Un dossier est imputé sur l'enveloppe dont le programme, le millésime et le périmètre
correspondent aux valeurs de ses champs (dans le cas le plus simple : une seule enveloppe, tous
les dossiers de la démarche). Les dossiers sans enveloppe correspondante sont remontés en
anomalie, jamais ignorés en silence.

### Indicateurs par enveloppe

Demandé · programmé (montant accordé renseigné, dossier pas encore accepté) · accepté ·
engagé (EJ renseigné) · reste. Le « payé » viendra avec Chorus.

### Ce qu'on ne reprend pas

Simulations, génération d'arrêtés, proxy partenaires, règles propres à la DETR/DSIL : hors
de l'objectif immédiat. Le proxy reste un modèle à garder en tête.

## 6. Suite proposée

1. Valider ce vocabulaire et le découplage enveloppe / démarche.
2. Réécrire les § B et C de `docs/SPEC-multi-demarches.md` en conséquence (session de
   développement, après accord).
3. Étape B telle quelle pour l'affichage (objet, montant demandé), étendue aux rôles financiers.
4. Étape C : enveloppes + imputation simple (une enveloppe par démarche et millésime), puis
   programme et périmètre.
