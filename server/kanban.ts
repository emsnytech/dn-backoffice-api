// Données du tableau kanban (étape 1 de docs/SPEC-kanban.md) : lecture seule.
// Le serveur réduit chaque dossier aux seules informations affichées sur une carte.
import { MUTATIONS_ENABLED, gql } from "./dn.ts";
import type { ChampRef, DemarcheConfig } from "./config.ts";
import { introuvables } from "./parametrage.ts";
import { computeDossier } from "./finances.ts";

// Deux types différents ne peuvent pas partager le nom de champ value : alias distincts.
const NUMBER_VALUE = `... on DecimalNumberChamp { decimalValue: value } ... on IntegerNumberChamp { integerValue: value }`;
// Champs et annotations avec leurs valeurs, lignes des blocs répétables comprises (§ B et § C).
export const VALUES = `
  __typename id champDescriptorId label stringValue
  ${NUMBER_VALUE}
  ... on RepetitionChamp { rows { champs { __typename champDescriptorId stringValue ${NUMBER_VALUE} } } }`;
// Options des listes : liste fermée des régimes d'aide (programmes d'enveloppe, § C).
const OPTIONS = `... on DropDownListChampDescriptor { options }`;
const REVISION_IDS = `__typename id label ${OPTIONS} ... on RepetitionChampDescriptor { champDescriptors { __typename id label ${OPTIONS} } }`;

const KANBAN_QUERY = `
  query getKanban($number: Int!, $after: String) {
    demarche(number: $number) {
      number title state
      groupeInstructeurs { instructeurs { id email } }
      activeRevision { champDescriptors { ${REVISION_IDS} } annotationDescriptors { ${REVISION_IDS} } }
      dossiers(first: 100, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes {
          number state
          dateDepot datePassageEnInstruction dateTraitement
          demandeur {
            __typename
            ... on PersonnePhysique { nom prenom }
            ... on PersonneMorale { siret entreprise { raisonSociale } association { titre } }
            ... on PersonneMoraleIncomplete { siret }
          }
          instructeurs { id email }
          messages { id }
          avis { id reponse }
          labels { name color }
          annotations { ${VALUES} }
          champs {
            ${VALUES}
            ... on PieceJustificativeChamp { files { filename } }
          }
        }
      }
    }
  }`;

export function demandeur(d: any) {
  switch (d.__typename) {
    case "PersonnePhysique":
      return { label: [d.prenom, d.nom].filter(Boolean).join(" "), siret: null };
    case "PersonneMorale":
      return { label: d.entreprise?.raisonSociale || d.association?.titre || `SIRET ${d.siret}`, siret: d.siret };
    default:
      return { label: `SIRET ${d.siret}`, siret: d.siret };
  }
}

// Un champ du paramétrage est désigné par son identifiant de descripteur, stable d'une
// révision à l'autre (docs/SPEC-multi-demarches.md § B).
function findChamp(champs: any[], ref: ChampRef | null) {
  return ref ? (champs.find((c) => c.champDescriptorId === ref.id) ?? null) : null;
}

// IntegerNumberChamp.value est un BigInt, transmis en chaîne par l'API.
function toNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// Valeur numérique d'un champ désigné. Un champ d'un bloc répétable vaut la somme de ses
// lignes renseignées (null si aucune ne l'est).
function numberValue(champs: any[], ref: ChampRef | null) {
  if (!ref) return null;
  const value = (c: any) => toNumber(c.decimalValue ?? c.integerValue);
  const top = findChamp(champs, ref);
  if (top) return value(top);
  const values = champs
    .filter((c) => c.__typename === "RepetitionChamp")
    .flatMap((c) => c.rows.flatMap((r: any) => r.champs.filter((x: any) => x.champDescriptorId === ref.id)))
    .map(value)
    .filter((n: number | null): n is number => n !== null);
  return values.length ? values.reduce((a: number, b: number) => a + b, 0) : null;
}

function toCard(d: any, config: DemarcheConfig) {
  const objet = findChamp(d.champs, config.champs.objet);
  const pj = d.champs.filter((c: any) => c.__typename === "PieceJustificativeChamp");
  // Avec un plan de financement, le montant des cartes est le demandé sur nos régimes (§ B).
  const f = config.finances;
  const fin = f.blocDecision || f.planFinancement ? computeDossier(d, config) : null;
  return {
    number: d.number,
    state: d.state,
    dateDepot: d.dateDepot,
    datePassageEnInstruction: d.datePassageEnInstruction,
    dateTraitement: d.dateTraitement,
    demandeur: demandeur(d.demandeur),
    objet: objet?.stringValue || null,
    montant: fin?.demandeNosProgrammes != null ? fin.demandeNosProgrammes / 100 : numberValue(d.champs, config.champs.montantDemande),
    // Montant accordé par régime (en euros), statut financier et repère « décidé, à notifier ».
    financement: fin
      ? fin.lignes.map((l) => ({ programme: l.programme, accorde: l.accorde === null ? null : l.accorde / 100, statut: l.statut, aNotifier: l.aNotifier }))
      : [],
    instructeurs: d.instructeurs,
    messages: d.messages.length,
    avisDemandes: d.avis.filter((a: any) => !a.reponse).length,
    avisRecus: d.avis.filter((a: any) => a.reponse).length,
    pjManquantes: pj.filter((c: any) => c.files.length === 0).length,
    labels: d.labels,
    annotations: d.annotations.length,
  };
}

// Dossiers bruts d'une démarche, avec les valeurs des champs et annotations (kanban et enveloppes).
export async function fetchDemarcheDossiers(numero: number) {
  const nodes: any[] = [];
  let demarche: any;
  let after: string | null = null;
  do {
    const data: any = await gql(KANBAN_QUERY, { number: numero, after });
    demarche = data.demarche;
    nodes.push(...demarche.dossiers.nodes);
    after = demarche.dossiers.pageInfo.hasNextPage ? demarche.dossiers.pageInfo.endCursor : null;
  } while (after);
  return { demarche, nodes };
}

export async function fetchKanban(config: DemarcheConfig) {
  const { demarche, nodes } = await fetchDemarcheDossiers(config.numero);

  // « Moi » = DN_INSTRUCTEUR_EMAIL, s'il fait partie des instructeurs de la démarche.
  const email = process.env.DN_INSTRUCTEUR_EMAIL;
  const instructeurs = demarche.groupeInstructeurs.flatMap((g: any) => g.instructeurs);
  const me = email ? (instructeurs.find((i: any) => i.email === email) ?? null) : null;

  return {
    demarche: { number: demarche.number, title: demarche.title, state: demarche.state, libelle: config.libelle },
    me,
    // Interrupteur général (DN_ENABLE_MUTATIONS) et réglage de la démarche : il faut les deux.
    mutationsEnabled: MUTATIONS_ENABLED && config.mutations,
    mutationsGlobal: MUTATIONS_ENABLED,
    mutationsDemarche: config.mutations,
    delaiCibleJours: config.delaiCibleJours,
    // Champs du paramétrage absents de la révision publiée (alerte au-dessus du tableau).
    champsIntrouvables: introuvables(config, demarche.activeRevision),
    syncedAt: new Date().toISOString(),
    dossiers: nodes.map((d) => toCard(d, config)),
  };
}

// Résumé d'une démarche pour la page d'accueil : titre, état et nombre de dossiers par état.
const SUMMARY_QUERY = `
  query getSummary($number: Int!, $after: String) {
    demarche(number: $number) {
      number title state
      dossiers(first: 100, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes { state }
      }
    }
  }`;

export async function fetchSummary(config: DemarcheConfig) {
  const counts: Record<string, number> = { en_construction: 0, en_instruction: 0, accepte: 0, refuse: 0, sans_suite: 0 };
  let demarche: any;
  let after: string | null = null;
  do {
    const data: any = await gql(SUMMARY_QUERY, { number: config.numero, after });
    demarche = data.demarche;
    for (const d of demarche.dossiers.nodes) counts[d.state] = (counts[d.state] ?? 0) + 1;
    after = demarche.dossiers.pageInfo.hasNextPage ? demarche.dossiers.pageInfo.endCursor : null;
  } while (after);
  return { title: demarche.title, state: demarche.state, counts };
}
