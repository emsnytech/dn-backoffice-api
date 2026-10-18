// Démarches déclarées (docs/SPEC-multi-demarches.md § A et § B) : un fichier
// config/demarches/<numéro>.json par démarche, versionné, sans secret. Le back office
// n'accède qu'à ces démarches, même si le jeton en ouvre d'autres.
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";

export type ChampRef = { id: string; libelle: string };

export type DemarcheConfig = {
  numero: number;
  libelle: string;
  // Changements d'état autorisés sur cette démarche (en plus de DN_ENABLE_MUTATIONS).
  mutations: boolean;
  delaiCibleJours: number;
  champs: { objet: ChampRef | null; montantDemande: ChampRef | null };
  // Suivi d'enveloppe (§ C) : conservé tel quel tant que l'étape C n'est pas faite.
  enveloppe?: unknown;
  valideLe: string | null;
};

const CONFIG_DIR = new URL("../config/demarches/", import.meta.url);
const fileFor = (numero: number) => new URL(`${numero}.json`, CONFIG_DIR);

export const isNumero = (n: number) => Number.isSafeInteger(n) && n > 0;

export async function getConfig(numero: number): Promise<DemarcheConfig | null> {
  if (!isNumero(numero)) return null;
  try {
    const config = JSON.parse(await readFile(fileFor(numero), "utf8"));
    return config.numero === numero ? config : null;
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

export const defaultConfig = (numero: number, libelle: string): DemarcheConfig => ({
  numero,
  libelle,
  mutations: false,
  delaiCibleJours: 45,
  champs: { objet: null, montantDemande: null },
  valideLe: null,
});

export class ConfigError extends Error {}

function champRef(value: unknown, name: string): ChampRef | null {
  if (value === null || value === undefined) return null;
  const v = value as ChampRef;
  if (typeof v.id !== "string" || !v.id || typeof v.libelle !== "string") {
    throw new ConfigError(`Champ « ${name} » invalide`);
  }
  return { id: v.id.slice(0, 200), libelle: v.libelle.slice(0, 500) };
}

// Valide une fiche envoyée par le front : seuls les réglages connus sont gardés.
export function parseConfig(numero: number, body: any, previous: DemarcheConfig | null): DemarcheConfig {
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
      objet: champRef(body.champs?.objet, "objet"),
      montantDemande: champRef(body.champs?.montantDemande, "montant demandé"),
    },
    ...(previous?.enveloppe !== undefined && { enveloppe: previous.enveloppe }),
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
