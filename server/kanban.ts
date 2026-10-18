// Données du tableau kanban (étape 1 de docs/SPEC-kanban.md) : lecture seule.
// Le serveur réduit chaque dossier aux seules informations affichées sur une carte.
import { readFile } from "node:fs/promises";
import { DEMARCHE_NUMBER, MUTATIONS_ENABLED, gql } from "./dn.ts";

type Config = { champObjet: string | null; champMontant: string | null; delaiCibleJours: number };

const CONFIG_URL = new URL("../config/demarche.json", import.meta.url);

const KANBAN_QUERY = `
  query getKanban($number: Int!, $after: String) {
    demarche(number: $number) {
      number title
      groupeInstructeurs { instructeurs { id email } }
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
          annotations { id }
          champs {
            __typename id champDescriptorId label stringValue
            ... on PieceJustificativeChamp { files { filename } }
            ... on DecimalNumberChamp { value }
            ... on IntegerNumberChamp { value }
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

// Un champ de la config est désigné par son id de descripteur ou par son libellé exact.
function findChamp(champs: any[], ref: string | null) {
  if (!ref) return null;
  return champs.find((c) => c.champDescriptorId === ref || c.label === ref) ?? null;
}

function toCard(d: any, config: Config) {
  const objet = findChamp(d.champs, config.champObjet);
  const montant = findChamp(d.champs, config.champMontant);
  const pj = d.champs.filter((c: any) => c.__typename === "PieceJustificativeChamp");
  return {
    number: d.number,
    state: d.state,
    dateDepot: d.dateDepot,
    datePassageEnInstruction: d.datePassageEnInstruction,
    dateTraitement: d.dateTraitement,
    demandeur: demandeur(d.demandeur),
    objet: objet?.stringValue || null,
    montant: montant ? (montant.value ?? null) : null,
    instructeurs: d.instructeurs,
    messages: d.messages.length,
    avisDemandes: d.avis.filter((a: any) => !a.reponse).length,
    avisRecus: d.avis.filter((a: any) => a.reponse).length,
    pjManquantes: pj.filter((c: any) => c.files.length === 0).length,
    labels: d.labels,
    annotations: d.annotations.length,
  };
}

export async function fetchKanban() {
  const config: Config = JSON.parse(await readFile(CONFIG_URL, "utf8"));
  const nodes: any[] = [];
  let demarche: any;
  let after: string | null = null;
  do {
    const data: any = await gql(KANBAN_QUERY, { number: DEMARCHE_NUMBER, after });
    demarche = data.demarche;
    nodes.push(...demarche.dossiers.nodes);
    after = demarche.dossiers.pageInfo.hasNextPage ? demarche.dossiers.pageInfo.endCursor : null;
  } while (after);

  // « Moi » = DN_INSTRUCTEUR_EMAIL, s'il fait partie des instructeurs de la démarche.
  const email = process.env.DN_INSTRUCTEUR_EMAIL;
  const instructeurs = demarche.groupeInstructeurs.flatMap((g: any) => g.instructeurs);
  const me = email ? (instructeurs.find((i: any) => i.email === email) ?? null) : null;

  return {
    demarche: { number: demarche.number, title: demarche.title },
    me,
    mutationsEnabled: MUTATIONS_ENABLED,
    delaiCibleJours: config.delaiCibleJours,
    syncedAt: new Date().toISOString(),
    dossiers: nodes.map((d) => toCard(d, config)),
  };
}
