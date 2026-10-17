// Client minimal de l'API GraphQL Démarche Numérique.
// Le jeton est lu ici, côté serveur uniquement. Seule écriture : changeDossierState.
import { MOTIVATION_ALLOWED, MOTIVATION_REQUIRED, TRANSITIONS, type DossierState } from "../shared/transitions.ts";

const API_URL = process.env.DN_API_URL ?? "https://demarche.numerique.gouv.fr/api/v2/graphql";
const TOKEN = process.env.DN_API_TOKEN;
export const DEMARCHE_NUMBER = Number(process.env.DN_DEMARCHE_NUMBER);

if (!TOKEN || !DEMARCHE_NUMBER) {
  console.error("DN_API_TOKEN et DN_DEMARCHE_NUMBER doivent être définis dans .env");
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
    throw Object.assign(err, { code: body.errors?.[0]?.extensions?.code });
  }
  return body.data as T;
}

const CHAMP_DESCRIPTOR = `
  fragment ChampDescriptorFields on ChampDescriptor {
    __typename id label description required
    ... on DropDownListChampDescriptor { options otherOption }
    ... on MultipleDropDownListChampDescriptor { options }
    ... on RepetitionChampDescriptor {
      champDescriptors { __typename id label description required }
    }
  }`;

const CHAMP = `
  fragment ChampFields on Champ {
    __typename id champDescriptorId label stringValue
    ... on MultipleDropDownListChamp { values }
    ... on CarteChamp { geoAreas { id source description geometry { type } } }
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

const DOSSIER_QUERY = `
  query getDossier($number: Int!) {
    dossier(number: $number) {
      ...DossierSummary
      demarche { number }
      motivation
      champs { ...ChampFields }
      annotations { ...ChampFields }
      traitements { id event dateTraitement emailAgentTraitant motivation }
      messages { id email body createdAt }
    }
  }
  ${DOSSIER_SUMMARY}
  ${CHAMP}`;

export async function fetchDemarche() {
  const { demarche } = await gql<{ demarche: any }>(DEMARCHE_QUERY, { number: DEMARCHE_NUMBER });
  return demarche;
}

export async function fetchDossiers() {
  const dossiers: any[] = [];
  let after: string | null = null;
  do {
    const data: any = await gql(DOSSIERS_QUERY, { number: DEMARCHE_NUMBER, after });
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

let instructeurId: string | undefined;

// Instructeur au nom duquel les mutations sont faites : DN_INSTRUCTEUR_EMAIL si défini,
// sinon l'unique instructeur de la démarche.
async function getInstructeurId() {
  if (instructeurId) return instructeurId;
  const data: any = await gql(INSTRUCTEURS_QUERY, { number: DEMARCHE_NUMBER });
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
  return (instructeurId = candidates[0].id);
}

export class TransitionError extends Error {}

export async function changeDossierState(
  number: number,
  target: string,
  options: { motivation?: string; disableNotification?: boolean },
) {
  // Toujours repartir de l'état réel côté API, pas de celui affiché dans le navigateur.
  const dossier = await fetchDossier(number);
  if (!dossier) throw new TransitionError("Dossier introuvable");
  const mutation = TRANSITIONS[dossier.state as DossierState]?.[target as DossierState];
  if (!mutation) throw new TransitionError(`Passage de « ${dossier.state} » à « ${target} » impossible`);
  const motivation = options.motivation?.trim();
  if (MOTIVATION_REQUIRED.has(target as DossierState) && !motivation) {
    throw new TransitionError("Une motivation est obligatoire pour ce changement d'état");
  }

  const input: Record<string, unknown> = {
    dossierId: dossier.id,
    instructeurId: await getInstructeurId(),
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
  return result.dossier;
}

// Renvoie null si le dossier n'appartient pas à la démarche configurée.
export async function fetchDossier(number: number) {
  const { dossier } = await gql<{ dossier: any }>(DOSSIER_QUERY, { number }).catch((e) => {
    if (e.code === "not_found") return { dossier: null };
    throw e;
  });
  return dossier?.demarche.number === DEMARCHE_NUMBER ? dossier : null;
}
