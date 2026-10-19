// Client minimal de l'API GraphQL Démarche Numérique.
// Le jeton est lu ici, côté serveur uniquement. Seule écriture : changeDossierState.
import { MOTIVATION_ALLOWED, MOTIVATION_REQUIRED, TRANSITIONS, type DossierState } from "../shared/transitions.ts";

const API_URL = process.env.DN_API_URL ?? "https://demarche.numerique.gouv.fr/api/v2/graphql";
// Site web DN correspondant à l'API, pour le lien « Ouvrir dans DN » de la fiche.
export const DN_WEB_ORIGIN = new URL(API_URL).origin;
const TOKEN = process.env.DN_API_TOKEN;
// Changements d'état autorisés seulement si DN_ENABLE_MUTATIONS=1 (étape 3 de docs/SPEC-kanban.md).
export const MUTATIONS_ENABLED = process.env.DN_ENABLE_MUTATIONS === "1";

if (!TOKEN) {
  console.error("DN_API_TOKEN doit être défini dans .env");
  process.exit(1);
}

export async function gql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const body = await res.json();
  if (!res.ok || body.errors) {
    const err = new Error(`GraphQL ${res.status} : ${JSON.stringify(body.errors ?? body)}`);
    // dnMessage : message de DN, affichable tel quel (il ne contient pas le jeton).
    throw Object.assign(err, {
      code: body.errors?.[0]?.extensions?.code,
      dnMessage: (body.errors ?? []).map((e: any) => e.message).join(" ; ") || `Erreur HTTP ${res.status}`,
    });
  }
  return body.data as T;
}

const CHAMP_DESCRIPTOR = `
  fragment ChampDescriptorFields on ChampDescriptor {
    __typename id label description required
    ... on DropDownListChampDescriptor { options otherOption }
    ... on MultipleDropDownListChampDescriptor { options }
    ... on RepetitionChampDescriptor {
      champDescriptors { __typename id label description required ... on DropDownListChampDescriptor { options } }
    }
  }`;

const CHAMP = `
  fragment ChampFields on Champ {
    __typename id champDescriptorId label stringValue
    ... on MultipleDropDownListChamp { values }
    ... on DecimalNumberChamp { decimalValue: value }
    ... on IntegerNumberChamp { integerValue: value }
    ... on CarteChamp { geoAreas { id source description geometry { type coordinates } } }
  }`;

const DOSSIER_SUMMARY = `
  fragment DossierSummary on Dossier {
    id number state archived
    dateDepot dateDerniereModification dateTraitement
    usager { email }
    demandeur {
      __typename
      ... on PersonnePhysique { civilite nom prenom }
      ... on PersonneMorale { siret }
    }
    groupeInstructeur { label }
  }`;

const DEMARCHE_QUERY = `
  query getDemarche($number: Int!) {
    demarche(number: $number) {
      id number title state description
      dateCreation datePublication dateFermeture
      groupeInstructeurs { id label }
      activeRevision {
        id datePublication
        champDescriptors { ...ChampDescriptorFields }
        annotationDescriptors { ...ChampDescriptorFields }
      }
    }
  }
  ${CHAMP_DESCRIPTOR}`;

const DOSSIERS_QUERY = `
  query getDossiers($number: Int!, $after: String) {
    demarche(number: $number) {
      dossiers(first: 100, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes {
          ...DossierSummary
          champs { ...ChampFields }
          annotations { ...ChampFields }
        }
      }
    }
  }
  ${DOSSIER_SUMMARY}
  ${CHAMP}`;

// Fiche dossier (docs/SPEC-kanban.md § 5) : en plus du résumé, raison sociale, instructeurs,
// fichiers des pièces justificatives (nom et taille, pas l'URL signée) et avis d'experts.
const DOSSIER_QUERY = `
  query getDossier($number: Int!) {
    dossier(number: $number) {
      ...DossierSummary
      demarche { number }
      datePassageEnInstruction
      motivation
      demandeur {
        ... on PersonneMorale { entreprise { raisonSociale } association { titre } }
        ... on PersonneMoraleIncomplete { siret }
      }
      instructeurs { id email }
      champs {
        ...ChampFields
        ... on PieceJustificativeChamp { files { filename contentType byteSizeBigInt } }
        ... on RepetitionChamp {
          rows {
            id
            champs {
              ...ChampFields
              ... on PieceJustificativeChamp { files { filename contentType byteSizeBigInt } }
            }
          }
        }
      }
      annotations { ...ChampFields ... on RepetitionChamp { rows { id champs { ...ChampFields } } } }
      avis {
        id question questionLabel questionAnswer reponse dateQuestion dateReponse
        claimant { email }
        expert { email }
      }
      traitements { id event dateTraitement emailAgentTraitant motivation }
      messages { id email body createdAt }
    }
  }
  ${DOSSIER_SUMMARY}
  ${CHAMP}`;

export async function fetchDemarche(numero: number) {
  const { demarche } = await gql<{ demarche: any }>(DEMARCHE_QUERY, { number: numero });
  return demarche;
}

// Accès du jeton à une démarche, déclarée ou non (route verifier). DN répond « not_found »
// aussi bien pour une démarche inexistante que pour une démarche hors de portée du jeton.
export async function checkDemarche(numero: number) {
  try {
    const { demarche } = await gql<{ demarche: any }>(
      `query check($number: Int!) { demarche(number: $number) { number title state } }`,
      { number: numero },
    );
    return { ok: true as const, demarche };
  } catch (e: any) {
    if (!e.dnMessage || !e.code) throw e;
    return { ok: false as const, code: e.code as string, message: e.dnMessage as string };
  }
}

export async function fetchDossiers(numero: number) {
  const dossiers: any[] = [];
  let after: string | null = null;
  do {
    const data: any = await gql(DOSSIERS_QUERY, { number: numero, after });
    const page = data.demarche.dossiers;
    dossiers.push(...page.nodes);
    after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
  } while (after);
  return dossiers;
}

// --- Écriture : changements d'état -----------------------------------------

const INSTRUCTEURS_QUERY = `
  query getInstructeurs($number: Int!) {
    demarche(number: $number) {
      groupeInstructeurs { label instructeurs { id email } }
    }
  }`;

const instructeurIds = new Map<number, string>();

// Instructeur au nom duquel les mutations sont faites, par démarche : DN_INSTRUCTEUR_EMAIL
// si défini, sinon l'unique instructeur de la démarche.
async function getInstructeurId(numero: number) {
  const cached = instructeurIds.get(numero);
  if (cached) return cached;
  const data: any = await gql(INSTRUCTEURS_QUERY, { number: numero });
  const all = new Map<string, { id: string; email: string }>();
  for (const g of data.demarche.groupeInstructeurs) for (const i of g.instructeurs) all.set(i.id, i);
  const wanted = process.env.DN_INSTRUCTEUR_EMAIL;
  const candidates = [...all.values()].filter((i) => !wanted || i.email === wanted);
  if (candidates.length !== 1) {
    throw new Error(
      wanted
        ? `Instructeur ${wanted} introuvable sur la démarche`
        : `${candidates.length} instructeurs sur la démarche : définir DN_INSTRUCTEUR_EMAIL dans .env`,
    );
  }
  instructeurIds.set(numero, candidates[0].id);
  return candidates[0].id;
}

export class TransitionError extends Error {}

export async function changeDossierState(
  numero: number,
  number: number,
  target: string,
  options: { motivation?: string; disableNotification?: boolean },
) {
  // Toujours repartir de l'état réel côté API, pas de celui affiché dans le navigateur.
  const dossier = await fetchDossier(numero, number);
  if (!dossier) throw new TransitionError("Dossier introuvable");
  const mutation = TRANSITIONS[dossier.state as DossierState]?.[target as DossierState];
  if (!mutation) throw new TransitionError(`Passage de « ${dossier.state} » à « ${target} » impossible`);
  const motivation = options.motivation?.trim();
  if (MOTIVATION_REQUIRED.has(target as DossierState) && !motivation) {
    throw new TransitionError("Une motivation est obligatoire pour ce changement d'état");
  }

  const input: Record<string, unknown> = {
    dossierId: dossier.id,
    instructeurId: await getInstructeurId(numero),
    disableNotification: Boolean(options.disableNotification),
  };
  if (MOTIVATION_ALLOWED.has(target as DossierState) && motivation) input.motivation = motivation;

  const query = `
    mutation change($input: ${mutation[0].toUpperCase()}${mutation.slice(1)}Input!) {
      ${mutation}(input: $input) {
        dossier { ...DossierSummary }
        errors { message }
      }
    }
    ${DOSSIER_SUMMARY}`;
  const data: any = await gql(query, { input });
  const result = data[mutation];
  if (result.errors?.length) throw new TransitionError(result.errors.map((e: any) => e.message).join(" ; "));
  return { dossier: result.dossier, from: dossier.state as string };
}

// Renvoie null si le dossier n'appartient pas à la démarche indiquée.
export async function fetchDossier(numero: number, number: number) {
  const { dossier } = await gql<{ dossier: any }>(DOSSIER_QUERY, { number }).catch((e) => {
    if (e.code === "not_found") return { dossier: null };
    throw e;
  });
  return dossier?.demarche.number === numero ? dossier : null;
}

// Démarche d'un dossier, pour rediriger les anciennes adresses /dossiers/:n.
export async function fetchDossierDemarche(number: number): Promise<number | null> {
  const data = await gql<{ dossier: any }>(`query d($number: Int!) { dossier(number: $number) { demarche { number } } }`, { number }).catch((e) => {
    if (e.code === "not_found") return { dossier: null };
    throw e;
  });
  return data.dossier?.demarche.number ?? null;
}
