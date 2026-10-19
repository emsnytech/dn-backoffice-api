// Démarches déclarées (docs/SPEC-multi-demarches.md § A et § B) : un fichier
// config/demarches/<numéro>.json par démarche, versionné, sans secret. Le back office
// n'accède qu'à ces démarches, même si le jeton en ouvre d'autres.
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { ROLES, findDescriptor, normalize, type Role } from "./parametrage.ts";

export type ChampRef = { id: string; libelle: string };

// Vocabulaire financier générique (§ B) : le millésime vaut pour la démarche, les autres
// rôles sont regroupés en lignes de financement (plusieurs en cas de double dotation).
export type Millesime = { source: "anneeDepot" } | { source: "champ"; ref: ChampRef };
export type Programme = { source: "fixe"; valeur: string } | { source: "champ"; ref: ChampRef } | null;
// Plan de financement saisi par l'usager : bloc répétable et ses sous-champs (§ B).
export type PlanFinancement = {
  bloc: ChampRef;
  financeur: ChampRef;
  montant: ChampRef;
  statut: ChampRef | null;
  // Pris en compte en C2 (millésime de chaque ligne du plan).
  annee: ChampRef | null;
  // Options du sous-champ financeur qui comptent comme aides publiques.
  financeursPublics: string[];
};
export type LigneFinancement = {
  programme: Programme;
  // Options du sous-champ financeur dont les montants du plan sont demandés à cette ligne.
  financeurs: string[];
  montantDemande: ChampRef | null;
  assiette: ChampRef | null;
  montantAccorde: ChampRef;
  // null : taux calculé (montant accordé ÷ assiette).
  taux: ChampRef | null;
  numeroEJ: ChampRef | null;
};
export type Finances = {
  millesime: Millesime;
  coutTotal: ChampRef | null;
  planFinancement: PlanFinancement | null;
  programmeSouhaite: ChampRef | null;
  // Plafond en % du cumul des aides publiques, pour le seul contrôle des anomalies (§ C).
  tauxMaxAidesPubliques: number | null;
  motifRepartition: ChampRef | null;
  lignes: LigneFinancement[];
};

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
    // Fiches enregistrées avant l'étape C1 : réglages financiers ajoutés depuis.
    const finances = { ...defaultFinances(), ...config.finances };
    finances.lignes = finances.lignes.map(({ tauxMax, ...l }: any) => ({ financeurs: [], ...l }));
    return { ...config, finances };
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

const defaultFinances = (): Finances => ({
  millesime: { source: "anneeDepot" },
  coutTotal: null,
  planFinancement: null,
  programmeSouhaite: null,
  tauxMaxAidesPubliques: null,
  motifRepartition: null,
  lignes: [],
});

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

// Valeurs choisies parmi les options du sous-champ financeur (liste fermée), écrites comme dans DN.
function parseOptions(v: unknown, options: string[], name: string): string[] {
  if (v === null || v === undefined) return [];
  if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) throw new ConfigError(`${name} invalides`);
  const out: string[] = [];
  for (const x of v as string[]) {
    const option = options.find((o) => normalize(o).trim() === normalize(x).trim());
    if (!option) throw new ConfigError(`${name} : « ${x} » n'est pas une option du sous-champ financeur`);
    if (!out.includes(option)) out.push(option);
  }
  return out;
}

function parsePlan(v: any, revision: any): PlanFinancement | null {
  if (v === null || v === undefined) return null;
  const bloc = champRef(v.bloc, "planBloc", revision);
  if (!bloc) return null;
  // Les sous-champs doivent appartenir au bloc désigné.
  const sous = (value: unknown, role: Role) => {
    const r = champRef(value, role, revision);
    if (r && findDescriptor(revision, r.id)?.blocId !== bloc.id) throw new ConfigError(`« ${r.libelle} » n'appartient pas au bloc « ${bloc.libelle} »`);
    return r;
  };
  const financeur = sous(v.financeur, "planFinanceur");
  const montant = sous(v.montant, "planMontant");
  if (!financeur || !montant) throw new ConfigError("Plan de financement : désignez les sous-champs financeur et montant");
  const options = findDescriptor(revision, financeur.id)?.options ?? [];
  return {
    bloc,
    financeur,
    montant,
    statut: sous(v.statut, "planStatut"),
    annee: sous(v.annee, "planAnnee"),
    financeursPublics: parseOptions(v.financeursPublics, options, "Financeurs publics"),
  };
}

function parseLigne(v: any, i: number, revision: any, plan: PlanFinancement | null): LigneFinancement {
  if (typeof v !== "object" || v === null) throw new ConfigError(`Ligne de financement ${i + 1} invalide`);
  const montantAccorde = champRef(v.montantAccorde, "montantAccorde", revision);
  if (!montantAccorde) throw new ConfigError(`Ligne de financement ${i + 1} : désignez son montant accordé`);
  if (Array.isArray(v.financeurs) && v.financeurs.length && !plan) {
    throw new ConfigError(`Ligne de financement ${i + 1} : des financeurs supposent un plan de financement`);
  }
  const options = plan ? (findDescriptor(revision, plan.financeur.id)?.options ?? []) : [];
  const financeurs = parseOptions(v.financeurs, options, `Ligne de financement ${i + 1}, financeurs`);
  const montantDemande = champRef(v.montantDemande, "montantDemande", revision);
  if (financeurs.length && montantDemande) {
    throw new ConfigError(`Ligne de financement ${i + 1} : le montant demandé vient soit des financeurs du plan, soit d'un champ, pas des deux`);
  }
  return {
    programme: parseProgramme(v.programme, revision),
    financeurs,
    montantDemande,
    assiette: champRef(v.assiette, "assiette", revision),
    montantAccorde,
    taux: champRef(v.taux, "taux", revision),
    numeroEJ: champRef(v.numeroEJ, "numeroEJ", revision),
  };
}

function parseTauxMax(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0 || n > 100) throw new ConfigError("Taux maximal des aides publiques invalide (entre 0 et 100 %)");
  return n;
}

function parseFinances(v: any, revision: any): Finances {
  if (v === null || v === undefined) return defaultFinances();
  const lignes = Array.isArray(v.lignes) ? v.lignes : [];
  if (lignes.length > MAX_LIGNES) throw new ConfigError(`${MAX_LIGNES} lignes de financement au plus`);
  const plan = parsePlan(v.planFinancement, revision);
  const parsed = lignes.map((l: any, i: number) => parseLigne(l, i, revision, plan));
  if (parsed.length > 1 && parsed.some((l: LigneFinancement) => !l.programme)) {
    throw new ConfigError("Avec plusieurs lignes de financement, chaque ligne doit avoir un programme");
  }
  const ids = parsed.map((l: LigneFinancement) => l.montantAccorde.id);
  if (new Set(ids).size !== ids.length) throw new ConfigError("Deux lignes de financement ne peuvent pas partager le même montant accordé");
  return {
    millesime: parseMillesime(v.millesime, revision),
    coutTotal: champRef(v.coutTotal, "coutTotal", revision),
    planFinancement: plan,
    programmeSouhaite: champRef(v.programmeSouhaite, "programmeSouhaite", revision),
    tauxMaxAidesPubliques: parseTauxMax(v.tauxMaxAidesPubliques),
    motifRepartition: champRef(v.motifRepartition, "motifRepartition", revision),
    lignes: parsed,
  };
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
  const finances = parseFinances(body.finances, revision);
  const montantDemande = champRef(body.champs?.montantDemande, "montantDemande", revision);
  // Le sous-champ montant du plan additionnerait tous les financeurs (§ B).
  if (montantDemande && montantDemande.id === finances.planFinancement?.montant.id) {
    throw new ConfigError("Le montant demandé des cartes ne peut pas être le montant du plan de financement : il est calculé à partir des financeurs des lignes");
  }
  return {
    numero,
    libelle,
    mutations: body.mutations,
    delaiCibleJours: delai,
    champs: {
      objet: champRef(body.champs?.objet, "objet", revision),
      montantDemande,
    },
    finances,
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
