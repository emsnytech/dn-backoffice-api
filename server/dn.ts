// Client minimal de l'API GraphQL Démarche Numérique (lecture seule).
// Le jeton est lu ici, côté serveur uniquement.

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

// Renvoie null si le dossier n'appartient pas à la démarche configurée.
export async function fetchDossier(number: number) {
  const { dossier } = await gql<{ dossier: any }>(DOSSIER_QUERY, { number }).catch((e) => {
    if (e.code === "not_found") return { dossier: null };
    throw e;
  });
  return dossier?.demarche.number === DEMARCHE_NUMBER ? dossier : null;
}
