// Étape 1 : lit la démarche, son descriptif de champs et tous ses dossiers.
// Usage : npm run fetch
import { mkdir, writeFile } from "node:fs/promises";
import { DEMARCHE_NUMBER, fetchDemarche, fetchDossiers } from "../server/dn.ts";

type Descriptor = { __typename: string; id: string; label: string; required: boolean; champDescriptors?: Descriptor[] };

const demarche = await fetchDemarche();
const dossiers = await fetchDossiers();

await mkdir("data", { recursive: true });
await writeFile(`data/demarche-${DEMARCHE_NUMBER}.json`, JSON.stringify(demarche, null, 2));
await writeFile(`data/dossiers-${DEMARCHE_NUMBER}.json`, JSON.stringify(dossiers, null, 2));

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
console.log(`\nJSON brut écrit dans data/demarche-${DEMARCHE_NUMBER}.json et data/dossiers-${DEMARCHE_NUMBER}.json`);
