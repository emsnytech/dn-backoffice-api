// Aides déjà accordées à un SIRET (docs/SPEC-multi-demarches.md § C, C3) : dossiers acceptés
// du même SIRET dans toutes les démarches déclarées, traités depuis moins de trois ans, avec
// leurs montants accordés (bloc de décision). Lecture seule, sans stockage.
import { listConfigs, type DemarcheConfig } from "./config.ts";
import { gql } from "./dn.ts";
import { computeDossier } from "./finances.ts";
import { VALUES } from "./kanban.ts";

const ANNEES = 3;

// Dossiers acceptés seulement : champs et annotations avec valeurs, pour le calcul financier.
const ACCEPTES_QUERY = `
  query getAcceptes($number: Int!, $after: String) {
    demarche(number: $number) {
      dossiers(first: 100, after: $after, state: accepte) {
        pageInfo { hasNextPage endCursor }
        nodes {
          number state dateDepot dateTraitement
          demandeur {
            __typename
            ... on PersonneMorale { siret }
            ... on PersonneMoraleIncomplete { siret }
          }
          annotations { ${VALUES} }
          champs { ${VALUES} }
        }
      }
    }
  }`;

export const normaliserSiret = (s: unknown) => (typeof s === "string" ? s.replace(/\s/g, "") : "");

export type AideAccordee = {
  demarche: number;
  libelle: string;
  number: number;
  dateTraitement: string | null;
  millesime: number | null;
  // Lignes acceptées du bloc de décision, en euros.
  lignes: { programme: string | null; accorde: number }[];
  // Somme des lignes acceptées ; null si la démarche n'a pas de bloc de décision ou si aucun
  // montant n'est renseigné.
  accorde: number | null;
  // Anomalie grave dans le calcul financier du dossier : montant à vérifier dans la fiche.
  aVerifier: boolean;
};

async function acceptes(numero: number) {
  const nodes: any[] = [];
  let after: string | null = null;
  do {
    const data: any = await gql(ACCEPTES_QUERY, { number: numero, after });
    const page = data.demarche.dossiers;
    nodes.push(...page.nodes);
    after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
  } while (after);
  return nodes;
}

function aide(d: any, config: DemarcheConfig): AideAccordee {
  const fin = config.finances.blocDecision ? computeDossier(d, config) : null;
  const lignes = (fin?.lignes ?? [])
    .filter((l) => l.statut === "accepte" && l.accorde !== null)
    .map((l) => ({ programme: l.programme, accorde: l.accorde! / 100 }));
  return {
    demarche: config.numero,
    libelle: config.libelle,
    number: d.number,
    dateTraitement: d.dateTraitement,
    millesime: fin?.millesime ?? null,
    lignes,
    accorde: lignes.length ? lignes.reduce((a, l) => a + l.accorde, 0) : null,
    aVerifier: Boolean(fin?.anomalies.some((a) => a.grave)),
  };
}

// Dossiers acceptés d'une démarche retenus pour ce SIRET : traités depuis `depuis`, hors dossier consulté.
export function retenues(nodes: any[], config: DemarcheConfig, cle: string, exclu: { demarche: number; number: number }, depuis: Date) {
  return nodes
    .filter((d) => d.state === "accepte" && normaliserSiret(d.demandeur?.siret) === cle)
    .filter((d) => !(config.numero === exclu.demarche && d.number === exclu.number))
    .filter((d) => d.dateTraitement && new Date(d.dateTraitement) >= depuis)
    .map((d) => aide(d, config));
}

// Le dossier consulté est exclu. Une démarche inaccessible est signalée sans bloquer les autres.
export async function aidesSiret(siret: string, exclu: { demarche: number; number: number }) {
  const cle = normaliserSiret(siret);
  const depuis = new Date();
  depuis.setFullYear(depuis.getFullYear() - ANNEES);
  const aides: AideAccordee[] = [];
  const echecs: { demarche: number; libelle: string; message: string }[] = [];
  await Promise.all(
    (await listConfigs()).map(async (config) => {
      try {
        aides.push(...retenues(await acceptes(config.numero), config, cle, exclu, depuis));
      } catch (e: any) {
        if (!e.dnMessage) console.error(e);
        echecs.push({ demarche: config.numero, libelle: config.libelle, message: e.dnMessage ?? "erreur lors de l'appel à l'API Démarche Numérique" });
      }
    }),
  );
  aides.sort((a, b) => (b.dateTraitement ?? "").localeCompare(a.dateTraitement ?? ""));
  const connus = aides.filter((a) => a.accorde !== null);
  return {
    siret: cle,
    depuis: depuis.toISOString(),
    aides,
    // Total des montants renseignés ; les dossiers sans montant sont comptés à part.
    total: connus.reduce((a, x) => a + x.accorde!, 0),
    sansMontant: aides.length - connus.length,
    echecs,
  };
}
