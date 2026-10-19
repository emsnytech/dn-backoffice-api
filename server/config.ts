// Démarches déclarées (docs/SPEC-multi-demarches.md § A et § B) : un fichier
// config/demarches/<numéro>.json par démarche, versionné, sans secret. Le back office
// n'accède qu'à ces démarches, même si le jeton en ouvre d'autres.
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { ROLES, findDescriptor, memeLibelle, type Role } from "./parametrage.ts";

export type ChampRef = { id: string; libelle: string };

// Vocabulaire financier générique (§ B) : le millésime vaut pour la démarche ; la décision
// est portée par un bloc répétable d'annotations, une ligne par régime d'aide.
export type Millesime = { source: "anneeDepot" } | { source: "champ"; ref: ChampRef };
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
// Valeurs génériques auxquelles sont rapprochées les options du sous-champ statut.
export type StatutDecision = "demande" | "propose" | "accorde";
export const STATUTS_DECISION: StatutDecision[] = ["demande", "propose", "accorde"];
// Bloc de décision (§ B) : le régime d'aide est le programme de la ligne, le montant est le
// montant accordé (seule source), l'assiette et la référence d'engagement sont facultatives.
export type BlocDecision = {
  bloc: ChampRef;
  regime: ChampRef;
  montant: ChampRef;
  statut: ChampRef;
  assiette: ChampRef | null;
  referenceEngagement: ChampRef | null;
  // Option du statut (écrite comme dans DN) → valeur générique.
  statuts: Record<string, StatutDecision>;
};
// Table des régimes (§ B), par option du régime d'aide : financeurs du plan dont le montant
// demandé va à ce régime, et système d'engagement (affiché seulement, pour l'instant).
export type Regime = { financeurs: string[]; systemeEngagement: string | null };
export type Finances = {
  millesime: Millesime;
  coutTotal: ChampRef | null;
  planFinancement: PlanFinancement | null;
  programmeSouhaite: ChampRef | null;
  // Plafond en % du cumul des aides publiques, pour le seul contrôle des anomalies (§ C).
  tauxMaxAidesPubliques: number | null;
  motifRepartition: ChampRef | null;
  blocDecision: BlocDecision | null;
  regimes: Record<string, Regime>;
};

export type DemarcheConfig = {
  numero: number;
  libelle: string;
  // Changements d'état autorisés sur cette démarche (en plus de DN_ENABLE_MUTATIONS).
  mutations: boolean;
  // Saisie du bloc de décision depuis le back office (C2b), en plus de DN_ENABLE_MUTATIONS.
  annotations: boolean;
  delaiCibleJours: number;
  champs: { objet: ChampRef | null; montantDemande: ChampRef | null };
  finances: Finances;
  valideLe: string | null;
  // Lecture seule : nombre de lignes de l'ancien réglage `lignes`, abandonné sans migration (C2a).
  ancienReglageLignes?: number;
};

const CONFIG_DIR = new URL("../config/demarches/", import.meta.url);
const fileFor = (numero: number) => new URL(`${numero}.json`, CONFIG_DIR);

export const isNumero = (n: number) => Number.isSafeInteger(n) && n > 0;

export async function getConfig(numero: number): Promise<DemarcheConfig | null> {
  if (!isNumero(numero)) return null;
  try {
    const config = JSON.parse(await readFile(fileFor(numero), "utf8"));
    if (config.numero !== numero) return null;
    // Fiches enregistrées avant C2a : réglages financiers ajoutés depuis ; l'ancien réglage
    // `lignes` est abandonné sans migration, la fiche de paramétrage le signale.
    const { lignes, ...rest } = config.finances ?? {};
    const finances = { ...defaultFinances(), ...rest };
    const out: DemarcheConfig = { annotations: false, ...config, finances };
    if (Array.isArray(lignes) && lignes.length) out.ancienReglageLignes = lignes.length;
    return out;
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
  blocDecision: null,
  regimes: {},
});

export const defaultConfig = (numero: number, libelle: string): DemarcheConfig => ({
  numero,
  libelle,
  mutations: false,
  annotations: false,
  delaiCibleJours: 45,
  champs: { objet: null, montantDemande: null },
  finances: defaultFinances(),
  valideLe: null,
});

export class ConfigError extends Error {}

const MAX_REGIMES = 50;

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

// Valeurs choisies parmi les options d'une liste (liste fermée), écrites comme dans DN.
function parseOptions(v: unknown, options: string[], name: string, liste = "du sous-champ financeur"): string[] {
  if (v === null || v === undefined) return [];
  if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) throw new ConfigError(`${name} invalides`);
  const out: string[] = [];
  for (const x of v as string[]) {
    const option = options.find((o) => memeLibelle(o, x));
    if (!option) throw new ConfigError(`${name} : « ${x} » n'est pas une option ${liste}`);
    if (!out.includes(option)) out.push(option);
  }
  return out;
}

// Sous-champ d'un bloc répétable : il doit appartenir au bloc désigné.
function sousChamp(value: unknown, role: Role, revision: any, bloc: ChampRef) {
  const r = champRef(value, role, revision);
  if (r && findDescriptor(revision, r.id)?.blocId !== bloc.id) throw new ConfigError(`« ${r.libelle} » n'appartient pas au bloc « ${bloc.libelle} »`);
  return r;
}

function parsePlan(v: any, revision: any): PlanFinancement | null {
  if (v === null || v === undefined) return null;
  const bloc = champRef(v.bloc, "planBloc", revision);
  if (!bloc) return null;
  const sous = (value: unknown, role: Role) => sousChamp(value, role, revision, bloc);
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

function parseBlocDecision(v: any, revision: any): BlocDecision | null {
  if (v === null || v === undefined) return null;
  const bloc = champRef(v.bloc, "decisionBloc", revision);
  if (!bloc) return null;
  const sous = (value: unknown, role: Role) => sousChamp(value, role, revision, bloc);
  const regime = sous(v.regime, "decisionRegime");
  const montant = sous(v.montant, "decisionMontant");
  const statut = sous(v.statut, "decisionStatut");
  if (!regime || !montant || !statut) throw new ConfigError("Bloc de décision : désignez les sous-champs régime d'aide, montant et statut");
  if (regime.id === statut.id) throw new ConfigError("Bloc de décision : le régime d'aide et le statut doivent être deux sous-champs différents");
  const assiette = sous(v.assiette, "decisionAssiette");
  if (assiette && assiette.id === montant.id) throw new ConfigError("Bloc de décision : l'assiette et le montant doivent être deux sous-champs différents");
  // Valeurs de statut : chaque clé est une option du sous-champ statut.
  const options = findDescriptor(revision, statut.id)?.options ?? [];
  const statuts: Record<string, StatutDecision> = {};
  if (v.statuts !== undefined && v.statuts !== null && (typeof v.statuts !== "object" || Array.isArray(v.statuts))) throw new ConfigError("Valeurs de statut invalides");
  for (const [k, val] of Object.entries(v.statuts ?? {})) {
    if (val === null || val === "") continue;
    const option = options.find((o) => memeLibelle(o, k));
    if (!option) throw new ConfigError(`Valeurs de statut : « ${k} » n'est pas une option du sous-champ statut`);
    if (!STATUTS_DECISION.includes(val as StatutDecision)) throw new ConfigError(`Valeur de statut invalide pour « ${option} »`);
    statuts[option] = val as StatutDecision;
  }
  return { bloc, regime, montant, statut, assiette, referenceEngagement: sous(v.referenceEngagement, "decisionReference"), statuts };
}

// Table des régimes : chaque clé est une option du régime d'aide ; les financeurs sont des
// options du sous-champ financeur du plan.
function parseRegimes(v: any, bloc: BlocDecision | null, plan: PlanFinancement | null, revision: any): Record<string, Regime> {
  if (v === null || v === undefined) return {};
  if (typeof v !== "object" || Array.isArray(v)) throw new ConfigError("Table des régimes invalide");
  const entries = Object.entries(v);
  if (!entries.length) return {};
  if (!bloc) throw new ConfigError("La table des régimes suppose un bloc de décision");
  if (entries.length > MAX_REGIMES) throw new ConfigError(`${MAX_REGIMES} régimes au plus`);
  const options = findDescriptor(revision, bloc.regime.id)?.options ?? [];
  const financeurs = plan ? (findDescriptor(revision, plan.financeur.id)?.options ?? []) : [];
  const out: Record<string, Regime> = {};
  for (const [k, r] of entries as [string, any][]) {
    const option = options.find((o) => memeLibelle(o, k));
    if (!option) throw new ConfigError(`Table des régimes : « ${k} » n'est pas une option du régime d'aide`);
    if (typeof r !== "object" || r === null) throw new ConfigError(`Table des régimes : « ${option} » invalide`);
    if (Array.isArray(r.financeurs) && r.financeurs.length && !plan) throw new ConfigError(`Régime « ${option} » : des financeurs supposent un plan de financement`);
    const systeme = typeof r.systemeEngagement === "string" ? r.systemeEngagement.trim() : "";
    if (systeme.length > 80) throw new ConfigError(`Régime « ${option} » : système d'engagement de 80 caractères au plus`);
    out[option] = {
      financeurs: parseOptions(r.financeurs, financeurs, `Régime « ${option} », financeurs`),
      systemeEngagement: systeme || null,
    };
  }
  return out;
}

function parseTauxMax(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0 || n > 100) throw new ConfigError("Taux maximal des aides publiques invalide (entre 0 et 100 %)");
  return n;
}

function parseFinances(v: any, revision: any): Finances {
  if (v === null || v === undefined) return defaultFinances();
  const plan = parsePlan(v.planFinancement, revision);
  const blocDecision = parseBlocDecision(v.blocDecision, revision);
  return {
    millesime: parseMillesime(v.millesime, revision),
    coutTotal: champRef(v.coutTotal, "coutTotal", revision),
    planFinancement: plan,
    programmeSouhaite: champRef(v.programmeSouhaite, "programmeSouhaite", revision),
    tauxMaxAidesPubliques: parseTauxMax(v.tauxMaxAidesPubliques),
    motifRepartition: champRef(v.motifRepartition, "motifRepartition", revision),
    blocDecision,
    regimes: parseRegimes(v.regimes, blocDecision, plan, revision),
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
  const annotations = body.annotations ?? false;
  if (typeof annotations !== "boolean") throw new ConfigError("Réglage « saisie du bloc de décision » invalide");
  const finances = parseFinances(body.finances, revision);
  if (annotations && !finances.blocDecision) throw new ConfigError("La saisie du bloc de décision suppose un bloc de décision désigné");
  const montantDemande = champRef(body.champs?.montantDemande, "montantDemande", revision);
  // Le sous-champ montant du plan additionnerait tous les financeurs (§ B).
  if (montantDemande && montantDemande.id === finances.planFinancement?.montant.id) {
    throw new ConfigError("Le montant demandé des cartes ne peut pas être le montant du plan de financement : il est calculé à partir de la table des régimes");
  }
  return {
    numero,
    libelle,
    mutations: body.mutations,
    annotations,
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
