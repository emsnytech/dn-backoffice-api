// Lit une démarche, son descriptif de champs et tous ses dossiers, et les enregistre dans data/.
// Usage : npm run fetch -- <numéro>   (sans numéro : toutes les démarches déclarées)
import { mkdir, writeFile } from "node:fs/promises";
import { fetchDemarche, fetchDossiers } from "../server/dn.ts";
import { listConfigs } from "../server/config.ts";

type Descriptor = { __typename: string; id: string; label: string; required: boolean; champDescriptors?: Descriptor[] };

const count = <T>(items: T[], key: (i: T) => string) =>
  items.reduce<Record<string, number>>((acc, i) => ((acc[key(i)] = (acc[key(i)] ?? 0) + 1), acc), {});

const printDescriptors = (list: Descriptor[], indent = "  ") => {
  for (const d of list) {
    console.log(`${indent}- ${d.label} [${d.__typename.replace("ChampDescriptor", "")}]${d.required ? " *" : ""}`);
    if (d.champDescriptors) printDescriptors(d.champDescriptors, indent + "    ");
  }
};

const arg = Number(process.argv[2]);
const numeros = arg ? [arg] : (await listConfigs()).map((c) => c.numero);
if (!numeros.length) {
  console.error("Aucune démarche déclarée dans config/demarches/ : indiquer un numéro (npm run fetch -- <numéro>).");
  process.exit(1);
}

await mkdir("data", { recursive: true });
for (const numero of numeros) {
  const demarche = await fetchDemarche(numero);
  const dossiers = await fetchDossiers(numero);
  await writeFile(`data/demarche-${numero}.json`, JSON.stringify(demarche, null, 2));
  await writeFile(`data/dossiers-${numero}.json`, JSON.stringify(dossiers, null, 2));

  const rev = demarche.activeRevision;
  console.log(`\nDémarche ${demarche.number} : ${demarche.title} (${demarche.state})`);
  console.log(`Groupes instructeurs : ${demarche.groupeInstructeurs.map((g: any) => g.label).join(", ")}`);
  console.log(`\nChamps (${rev.champDescriptors.length}, * = obligatoire) :`);
  printDescriptors(rev.champDescriptors);
  console.log(`\nAnnotations privées (${rev.annotationDescriptors.length}) :`);
  printDescriptors(rev.annotationDescriptors);
  console.log(`\nDossiers : ${dossiers.length}`);
  console.log("Par état :", count(dossiers, (d) => d.state));
  console.log(`\nJSON brut écrit dans data/demarche-${numero}.json et data/dossiers-${numero}.json`);
}
