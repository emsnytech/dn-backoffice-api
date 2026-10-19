// Démarches déclarées (docs/SPEC-multi-demarches.md § A et § B) : un fichier
// config/demarches/<numéro>.json par démarche, versionné, sans secret. Le back office
// n'accède qu'à ces démarches, même si le jeton en ouvre d'autres.
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { ROLES, findDescriptor, type Role } from "./parametrage.ts";

export type ChampRef = { id: string; libelle: string };

// Vocabulaire financier générique (§ B) : le millésime vaut pour la démarche, les autres
// rôles sont regroupés en lignes de financement (plusieurs en cas de double dotation).
export type Millesime = { source: "anneeDepot" } | { source: "champ"; ref: ChampRef };
export type Programme = { source: "fixe"; valeur: string } | { source: "champ"; ref: ChampRef } | null;
export type LigneFinancement = {
  programme: Programme;
  montantDemande: ChampRef | null;
  assiette: ChampRef | null;
  montantAccorde: ChampRef;
  // null : taux calculé (montant accordé ÷ assiette).
  taux: ChampRef | null;
  // Plafond en %, pour le seul contrôle des anomalies (§ C).
  tauxMax: number | null;
  numeroEJ: ChampRef | null;
};
export type Finances = { millesime: Millesime; lignes: LigneFinancement[] };

export type DemarcheConfig = {
  numero: number;
  libelle: string;
  // Changements d'état autorisés sur cette démarche (en plus de DN_ENABLE_MUTATIONS).
  mutations: boolean;
  delaiCibleJours: number;
  champs: { objet: ChampRef | null; montantDemande: ChampRef | null };
  finances: Finances;
  valideLe: string | null;
};

const CONFIG_DIR = new URL("../config/demarches/", import.meta.url);
const fileFor = (numero: number) => new URL(`${numero}.json`, CONFIG_DIR);

export const isNumero = (n: number) => Number.isSafeInteger(n) && n > 0;

export async function getConfig(numero: number): Promise<DemarcheConfig | null> {
  if (!isNumero(numero)) return null;
  try {
    const config = JSON.parse(await readFile(fileFor(numero), "utf8"));
    if (config.numero !== numero) return null;
    // Fiches enregistrées avant l'étape B : pas encore de données financières.
    return { ...config, finances: config.finances ?? defaultFinances() };
  } catch (e: any) {
    if (e.code === "ENOENT") return null;
    throw e;
  }
}

export async function listConfigs(): Promise<DemarcheConfig[]> {
  const files = await readdir(CONFIG_DIR).catch((e) => (e.code === "ENOENT" ? [] : Promise.reject(e)));
  const numeros = files.map((f) => /^(\d+)\.json$/.exec(f)?.[1]).filter(Boolean).map(Number);
  const configs = await Promise.all(numeros.sort((a, b) => a - b).map(getConfig));
  return configs.filter((c): c is DemarcheConfig => c !== null);
}

const defaultFinances = (): Finances => ({ millesime: { source: "anneeDepot" }, lignes: [] });

export const defaultConfig = (numero: number, libelle: string): DemarcheConfig => ({
  numero,
  libelle,
  mutations: false,
  delaiCibleJours: 45,
  champs: { objet: null, montantDemande: null },
  finances: defaultFinances(),
  valideLe: null,
});

export class ConfigError extends Error {}

const MAX_LIGNES = 10;

// Le front n'envoie que l'identifiant du champ : le serveur vérifie qu'il existe dans la
// révision publiée et qu'il a un type accepté pour ce rôle, puis reprend le libellé de DN.
function champRef(value: unknown, role: Role, revision: any): ChampRef | null {
  if (value === null || value === undefined) return null;
  const id = typeof value === "string" ? value : (value as ChampRef).id;
  const name = ROLES[role].nom;
  if (typeof id !== "string" || !id) throw new ConfigError(`Champ « ${name} » invalide`);
  const found = findDescriptor(revision, id);
  if (!found) throw new ConfigError(`Champ « ${name} » introuvable dans la révision publiée : choisissez-en un autre`);
  if (!ROLES[role].accepte(found)) throw new ConfigError(`Le champ « ${found.libelle} » n'a pas un type accepté pour « ${name} »`);
  return { id: found.id, libelle: found.libelle };
}

function parseMillesime(v: any, revision: any): Millesime {
  if (!v || v.source === "anneeDepot") return { source: "anneeDepot" };
  if (v.source === "champ") return { source: "champ", ref: champRef(v.ref, "millesime", revision)! };
  throw new ConfigError("Source du millésime invalide");
}

function parseProgramme(v: any, revision: any): Programme {
  if (v === null || v === undefined) return null;
  if (v.source === "fixe") {
    const valeur = typeof v.valeur === "string" ? v.valeur.trim() : "";
    if (!valeur || valeur.length > 80) throw new ConfigError("Le programme fixe doit faire entre 1 et 80 caractères");
    return { source: "fixe", valeur };
  }
  if (v.source === "champ") return { source: "champ", ref: champRef(v.ref, "programme", revision)! };
  throw new ConfigError("Programme invalide");
}

function parseLigne(v: any, i: number, revision: any): LigneFinancement {
  if (typeof v !== "object" || v === null) throw new ConfigError(`Ligne de financement ${i + 1} invalide`);
  const montantAccorde = champRef(v.montantAccorde, "montantAccorde", revision);
  if (!montantAccorde) throw new ConfigError(`Ligne de financement ${i + 1} : désignez son montant accordé`);
  let tauxMax: number | null = null;
  if (v.tauxMax !== null && v.tauxMax !== undefined && v.tauxMax !== "") {
    tauxMax = Number(v.tauxMax);
    if (!Number.isFinite(tauxMax) || tauxMax <= 0 || tauxMax > 100) throw new ConfigError(`Ligne de financement ${i + 1} : taux maximal invalide (entre 0 et 100 %)`);
  }
  return {
    programme: parseProgramme(v.programme, revision),
    montantDemande: champRef(v.montantDemande, "montantDemande", revision),
    assiette: champRef(v.assiette, "assiette", revision),
    montantAccorde,
    taux: champRef(v.taux, "taux", revision),
    tauxMax,
    numeroEJ: champRef(v.numeroEJ, "numeroEJ", revision),
  };
}

function parseFinances(v: any, revision: any): Finances {
  if (v === null || v === undefined) return defaultFinances();
  const lignes = Array.isArray(v.lignes) ? v.lignes : [];
  if (lignes.length > MAX_LIGNES) throw new ConfigError(`${MAX_LIGNES} lignes de financement au plus`);
  const parsed = lignes.map((l: any, i: number) => parseLigne(l, i, revision));
  if (parsed.length > 1 && parsed.some((l: LigneFinancement) => !l.programme)) {
    throw new ConfigError("Avec plusieurs lignes de financement, chaque ligne doit avoir un programme");
  }
  const ids = parsed.map((l: LigneFinancement) => l.montantAccorde.id);
  if (new Set(ids).size !== ids.length) throw new ConfigError("Deux lignes de financement ne peuvent pas partager le même montant accordé");
  return { millesime: parseMillesime(v.millesime, revision), lignes: parsed };
}

// Valide une fiche envoyée par le front : seuls les réglages connus sont gardés. `revision`
// est la révision publiée de la démarche (activeRevision), relue sur DN avant l'écriture.
export function parseConfig(numero: number, body: any, revision: any): DemarcheConfig {
  if (typeof body !== "object" || body === null) throw new ConfigError("Paramétrage invalide");
  const libelle = typeof body.libelle === "string" ? body.libelle.trim() : "";
  if (!libelle || libelle.length > 120) throw new ConfigError("Le libellé court doit faire entre 1 et 120 caractères");
  const delai = Number(body.delaiCibleJours);
  if (!Number.isInteger(delai) || delai < 1 || delai > 3650) throw new ConfigError("Délai cible invalide (1 à 3650 jours)");
  if (typeof body.mutations !== "boolean") throw new ConfigError("Réglage « changements d'état » invalide");
  return {
    numero,
    libelle,
    mutations: body.mutations,
    delaiCibleJours: delai,
    champs: {
      objet: champRef(body.champs?.objet, "objet", revision),
      montantDemande: champRef(body.champs?.montantDemande, "montantDemande", revision),
    },
    finances: parseFinances(body.finances, revision),
    valideLe: new Date().toISOString(),
  };
}

export async function saveConfig(config: DemarcheConfig) {
  await mkdir(CONFIG_DIR, { recursive: true });
  await writeFile(fileFor(config.numero), JSON.stringify(config, null, 2) + "\n");
}

// Migration depuis l'ancienne configuration à une seule démarche : si aucune démarche
// n'est déclarée et que DN_DEMARCHE_NUMBER est défini, déclarer celle-ci à partir de
// config/demarche.json, puis supprimer ce fichier. Les changements d'état y restent
// autorisés, comme avant la migration.
export async function migrateLegacyConfig(fetchDemarche: (numero: number) => Promise<any>) {
  const legacy = Number(process.env.DN_DEMARCHE_NUMBER ?? process.env.DN_DEMARCHE_NUMERO);
  if (!isNumero(legacy) || (await listConfigs()).length) return null;
  const legacyFile = new URL("../config/demarche.json", import.meta.url);
  const old = await readFile(legacyFile, "utf8").then(JSON.parse).catch(() => ({}));
  const { title, activeRevision } = await fetchDemarche(legacy);
  // L'ancienne configuration désignait un champ par son id ou par son libellé exact.
  const champ = (ref: string | null): ChampRef | null => {
    const d = ref ? activeRevision.champDescriptors.find((x: any) => x.id === ref || x.label === ref) : null;
    return d ? { id: d.id, libelle: d.label } : null;
  };
  const config: DemarcheConfig = {
    ...defaultConfig(legacy, title),
    mutations: true,
    delaiCibleJours: old.delaiCibleJours ?? 45,
    champs: { objet: champ(old.champObjet ?? null), montantDemande: champ(old.champMontant ?? null) },
  };
  await saveConfig(config);
  await rm(legacyFile, { force: true });
  return config;
}
