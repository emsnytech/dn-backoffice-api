// Étape 1 : lit la démarche, son descriptif de champs et tous ses dossiers.
// Usage : node --env-file=.env scripts/fetch-demarche.ts
import { mkdir, writeFile } from "node:fs/promises";

const API_URL = process.env.DN_API_URL ?? "https://demarche.numerique.gouv.fr/api/v2/graphql";
const TOKEN = process.env.DN_API_TOKEN;
const NUMBER = Number(process.env.DN_DEMARCHE_NUMBER);

if (!TOKEN || !NUMBER) {
  console.error("DN_API_TOKEN et DN_DEMARCHE_NUMBER doivent être définis dans .env");
  process.exit(1);
}

async function gql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const body = await res.json();
  if (!res.ok || body.errors) {
    throw new Error(`GraphQL ${res.status} : ${JSON.stringify(body.errors ?? body)}`);
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
          id number state archived
          dateDepot dateDerniereModification dateTraitement
          usager { email }
          demandeur {
            __typename
            ... on PersonnePhysique { civilite nom prenom }
            ... on PersonneMorale { siret }
          }
          groupeInstructeur { label }
          champs { ...ChampFields }
          annotations { ...ChampFields }
        }
      }
    }
  }
  fragment ChampFields on Champ {
    __typename id champDescriptorId label stringValue
    ... on MultipleDropDownListChamp { values }
  }`;

type Descriptor = { __typename: string; id: string; label: string; required: boolean; champDescriptors?: Descriptor[] };
type Dossier = { number: number; state: string; champs: unknown[] };

const { demarche } = await gql<{ demarche: any }>(DEMARCHE_QUERY, { number: NUMBER });

const dossiers: Dossier[] = [];
let after: string | null = null;
do {
  const data: any = await gql(DOSSIERS_QUERY, { number: NUMBER, after });
  const page = data.demarche.dossiers;
  dossiers.push(...page.nodes);
  after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
} while (after);

await mkdir("data", { recursive: true });
await writeFile(`data/demarche-${NUMBER}.json`, JSON.stringify(demarche, null, 2));
await writeFile(`data/dossiers-${NUMBER}.json`, JSON.stringify(dossiers, null, 2));

// Résumé lisible
const count = <T>(items: T[], key: (i: T) => string) =>
  items.reduce<Record<string, number>>((acc, i) => ((acc[key(i)] = (acc[key(i)] ?? 0) + 1), acc), {});

const printDescriptors = (list: Descriptor[], indent = "  ") => {
  for (const d of list) {
    console.log(`${indent}- ${d.label} [${d.__typename.replace("ChampDescriptor", "")}]${d.required ? " *" : ""}`);
    if (d.champDescriptors) printDescriptors(d.champDescriptors, indent + "    ");
  }
};

const rev = demarche.activeRevision;
console.log(`\nDémarche ${demarche.number} : ${demarche.title} (${demarche.state})`);
console.log(`Groupes instructeurs : ${demarche.groupeInstructeurs.map((g: any) => g.label).join(", ")}`);
console.log(`\nChamps (${rev.champDescriptors.length}, * = obligatoire) :`);
printDescriptors(rev.champDescriptors);
console.log(`\nAnnotations privées (${rev.annotationDescriptors.length}) :`);
printDescriptors(rev.annotationDescriptors);
console.log(`\nDossiers : ${dossiers.length}`);
console.log("Par état :", count(dossiers, (d) => d.state));
console.log(`\nJSON brut écrit dans data/demarche-${NUMBER}.json et data/dossiers-${NUMBER}.json`);
