// Enveloppes financières (docs/SPEC-multi-demarches.md § C) : un fichier
// config/enveloppes/<id>.json par enveloppe, versionné, écrit uniquement par le serveur.
// L'enveloppe est indépendante de la démarche : seule donnée qui n'existe pas dans DN.
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { ConfigError, type DemarcheConfig } from "./config.ts";
import { computeDossier, type Anomalie, type DossierFinance, type StatutLigne } from "./finances.ts";
import { findDescriptor, memeLibelle, normalize } from "./parametrage.ts";

export type Enveloppe = {
  id: string;
  libelle: string;
  // Régime d'aide (liste fermée, § C) ; null : tous régimes.
  programme: string | null;
  millesime: number;
  montantCentimes: number;
  parent: string | null;
  demarches: number[];
  modifieLe: string;
};

const DIR = new URL("../config/enveloppes/", import.meta.url);
const fileFor = (id: string) => new URL(`${id}.json`, DIR);
export const isEnveloppeId = (id: string) => /^[a-z0-9][a-z0-9-]{0,59}$/.test(id);

export async function getEnveloppe(id: string): Promise<Enveloppe | null> {
  if (!isEnveloppeId(id)) return null;
  try {
    const e = JSON.parse(await readFile(fileFor(id), "utf8"));
    return e.id === id ? e : null;
  } catch (e: any) {
    if (e.code === "ENOENT") return null;
    throw e;
  }
}

export async function listEnveloppes(): Promise<Enveloppe[]> {
  const files = await readdir(DIR).catch((e) => (e.code === "ENOENT" ? [] : Promise.reject(e)));
  const ids = files.map((f) => /^([a-z0-9-]+)\.json$/.exec(f)?.[1]).filter((x): x is string => Boolean(x)).sort();
  return (await Promise.all(ids.map(getEnveloppe))).filter((e): e is Enveloppe => e !== null);
}

export async function saveEnveloppe(e: Enveloppe) {
  await mkdir(DIR, { recursive: true });
  await writeFile(fileFor(e.id), JSON.stringify(e, null, 2) + "\n");
}

export const deleteEnveloppe = (id: string) => rm(fileFor(id));

const slug = (s: string) => normalize(s).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || "enveloppe";

export function newEnveloppeId(libelle: string, existing: Enveloppe[]) {
  const base = slug(libelle);
  const taken = new Set(existing.map((e) => e.id));
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
}

// Liste fermée des programmes d'enveloppe : options du sous-champ « régime d'aide » du bloc
// de décision de chaque démarche (§ C), écrites comme dans DN, sans doublon.
export function programmesDe(config: DemarcheConfig, revision: any): string[] {
  const b = config.finances.blocDecision;
  return b ? (findDescriptor(revision, b.regime.id)?.options ?? []) : [];
}

export function unionProgrammes(listes: string[][]): string[] {
  const out: string[] = [];
  for (const o of listes.flat()) if (!out.some((x) => memeLibelle(x, o))) out.push(o);
  return out;
}

// Valide une enveloppe envoyée par le front. Montant saisi en euros, stocké en centimes.
// `programmes` : liste fermée des régimes des démarches rattachées.
export function parseEnveloppe(id: string, body: any, declared: number[], others: Enveloppe[], programmes: string[]): Enveloppe {
  if (typeof body !== "object" || body === null) throw new ConfigError("Enveloppe invalide");
  const libelle = typeof body.libelle === "string" ? body.libelle.trim() : "";
  if (!libelle || libelle.length > 120) throw new ConfigError("Le libellé doit faire entre 1 et 120 caractères");
  const millesime = Number(body.millesime);
  if (!Number.isInteger(millesime) || millesime < 2000 || millesime > 2100) throw new ConfigError("Millésime invalide (année entre 2000 et 2100)");
  const montant = Number(body.montant);
  if (!Number.isFinite(montant) || montant < 0 || montant > 1e10) throw new ConfigError("Montant invalide");
  const demarches = Array.isArray(body.demarches) ? [...new Set(body.demarches.map(Number))] as number[] : [];
  if (!demarches.length) throw new ConfigError("Choisissez au moins une démarche qui alimente l'enveloppe");
  const inconnue = demarches.find((n) => !declared.includes(n));
  if (inconnue !== undefined) throw new ConfigError(`La démarche ${inconnue} n'est pas déclarée dans ce back office`);
  let programme: string | null = null;
  if (body.programme !== null && body.programme !== undefined && body.programme !== "") {
    programme = programmes.find((o) => memeLibelle(o, String(body.programme))) ?? null;
    if (!programme) throw new ConfigError(`« ${body.programme} » n'est pas un régime d'aide des démarches choisies`);
  }
  const parent = body.parent ? String(body.parent) : null;
  if (parent) {
    if (parent === id) throw new ConfigError("Une enveloppe ne peut pas être sa propre mère");
    const byId = new Map(others.map((e) => [e.id, e]));
    if (!byId.has(parent)) throw new ConfigError("Enveloppe mère introuvable");
    // Pas de cycle de délégation.
    for (let p: string | null = parent, n = 0; p; p = byId.get(p)?.parent ?? null, n++) {
      if (p === id || n > 50) throw new ConfigError("Cette délégation formerait une boucle");
    }
  }
  return {
    id,
    libelle,
    programme,
    millesime,
    montantCentimes: Math.round(montant * 100),
    parent,
    demarches: demarches.sort((a, b) => a - b),
    modifieLe: new Date().toISOString(),
  };
}

// --- Calcul (§ C) -----------------------------------------------------------

export type Imputation = {
  demarche: number;
  dossier: number;
  ligne: number;
  programme: string | null;
  statut: StatutLigne;
  demande: number | null;
  accorde: number | null;
  engage: boolean;
};

export type AnomalieDossier = Anomalie & { demarche: number; dossier: number | null };

export type Indicateurs = {
  montant: number;
  demande: number;
  programme: number;
  accepte: number;
  engage: number;
  reste: number;
  restePrevisionnel: number;
  // Jamais additionné d'une enveloppe à l'autre (§ C).
  nonAffecte: number;
  dossiersNonAffecte: number[];
  millesimeParDefaut: number;
  dossiers: number;
};

export type EnveloppeCalculee = Enveloppe & {
  indicateurs: Indicateurs;
  imputations: Imputation[];
  anomalies: AnomalieDossier[];
};

export type DemarcheDossiers = {
  config: DemarcheConfig;
  // Champs du paramétrage absents de la révision publiée : calcul suspendu pour la démarche.
  introuvables: { role: string; libelle: string }[];
  // Régimes d'aide de la démarche (liste fermée des programmes d'enveloppe).
  programmes: string[];
  dossiers: any[];
};

function matches(e: Enveloppe, numero: number, millesime: number | null, programme: string | null) {
  if (!e.demarches.includes(numero) || millesime === null || e.millesime !== millesime) return false;
  return e.programme === null || memeLibelle(e.programme, programme);
}

// Imputation et indicateurs de toutes les enveloppes, d'après les dossiers des démarches
// qui les alimentent. Un dossier n'est jamais ignoré en silence.
export function computeEnveloppes(enveloppes: Enveloppe[], sources: Map<number, DemarcheDossiers>): EnveloppeCalculee[] {
  const out = new Map<string, EnveloppeCalculee>(
    enveloppes.map((e) => [
      e.id,
      {
        ...e,
        imputations: [],
        anomalies: [],
        indicateurs: {
          montant: e.montantCentimes, demande: 0, programme: 0, accepte: 0, engage: 0, reste: 0, restePrevisionnel: 0,
          nonAffecte: 0, dossiersNonAffecte: [], millesimeParDefaut: 0, dossiers: 0,
        },
      },
    ]),
  );
  const feeding = (numero: number) => [...out.values()].filter((e) => e.demarches.includes(numero));
  const toAll = (numero: number, a: AnomalieDossier) => feeding(numero).forEach((e) => e.anomalies.push(a));

  // Programme d'enveloppe absent de la liste fermée (régime retiré de la démarche dans DN).
  for (const e of out.values()) {
    if (e.programme === null) continue;
    const liste = unionProgrammes(e.demarches.map((n) => sources.get(n)?.programmes ?? []));
    const connues = e.demarches.every((n) => sources.has(n));
    if (connues && !liste.some((o) => memeLibelle(o, e.programme))) {
      e.anomalies.push({ code: "programme_inconnu", message: `Le régime « ${e.programme} » n'est plus une option du régime d'aide des démarches rattachées`, grave: true, demarche: 0, dossier: null });
    }
  }

  for (const [numero, src] of sources) {
    if (src.introuvables.length) {
      toAll(numero, {
        code: "champ_introuvable",
        message: `Calcul suspendu pour la démarche ${numero} : champ introuvable dans la révision publiée (${src.introuvables.map((c) => c.role).join(", ")})`,
        grave: true, demarche: numero, dossier: null,
      });
      continue;
    }
    if (!src.config.finances.blocDecision) continue;
    for (const d of src.dossiers) {
      const fin: DossierFinance = computeDossier(d, src.config);
      const touched = new Set<string>();
      for (const l of fin.lignes) {
        if (l.statut === "hors_calcul") continue;
        const candidates = feeding(numero).filter((e) => matches(e, numero, fin.millesime, l.programme));
        if (candidates.length !== 1) {
          if (fin.millesime === null) continue; // déjà signalé : millésime illisible
          toAll(numero, {
            code: candidates.length ? "plusieurs_enveloppes" : "hors_enveloppe",
            message: candidates.length
              ? `Plusieurs enveloppes possibles (millésime ${fin.millesime}${l.programme ? `, ${l.programme}` : ""}) : rien n'est imputé`
              : `Hors enveloppe : aucune enveloppe pour le millésime ${fin.millesime}${l.programme ? ` et le régime ${l.programme}` : ""}`,
            grave: true, demarche: numero, dossier: d.number, ligne: l.index,
          });
          continue;
        }
        const e = candidates[0];
        touched.add(e.id);
        const engage = l.statut === "accepte" && Boolean(l.referenceEngagement);
        e.imputations.push({ demarche: numero, dossier: d.number, ligne: l.index, programme: l.programme, statut: l.statut, demande: l.demande, accorde: l.accorde, engage });
        const ind = e.indicateurs;
        if (l.statut === "demande" || l.statut === "programme") ind.demande += l.demande ?? 0;
        if (l.statut === "programme") ind.programme += l.accorde ?? 0;
        if (l.statut === "accepte") ind.accepte += l.accorde ?? 0;
        if (engage) ind.engage += l.accorde ?? 0;
      }
      for (const id of touched) {
        const e = out.get(id)!;
        e.indicateurs.dossiers++;
        if (fin.millesimeParDefaut) e.indicateurs.millesimeParDefaut++;
        for (const a of fin.anomalies) e.anomalies.push({ ...a, demarche: numero, dossier: d.number });
      }
      // Les anomalies propres au dossier qui n'est imputé nulle part sont signalées aussi.
      if (!touched.size) for (const a of fin.anomalies) toAll(numero, { ...a, demarche: numero, dossier: d.number });
      // Demandé non affecté : une fois par enveloppe sur laquelle l'un des régimes qui partagent
      // le financeur serait imputé (§ C) ; jamais additionné d'une enveloppe à l'autre.
      for (const n of fin.nonAffecte) {
        const ids = new Set(
          n.regimes.flatMap((r) => feeding(numero).filter((e) => matches(e, numero, fin.millesime, r)).map((e) => e.id)),
        );
        for (const id of ids) {
          const ind = out.get(id)!.indicateurs;
          ind.nonAffecte += n.montant;
          if (!ind.dossiersNonAffecte.includes(d.number)) ind.dossiersNonAffecte.push(d.number);
        }
      }
    }
  }

  for (const e of out.values()) {
    e.indicateurs.reste = e.montantCentimes - e.indicateurs.accepte;
    e.indicateurs.restePrevisionnel = e.indicateurs.reste - e.indicateurs.programme;
    const filles = [...out.values()].filter((x) => x.parent === e.id);
    const total = filles.reduce((a, x) => a + x.montantCentimes, 0);
    if (filles.length && total > e.montantCentimes) {
      e.anomalies.push({ code: "filles_sup_mere", message: `Les enveloppes filles totalisent plus que cette enveloppe`, grave: true, demarche: 0, dossier: null });
    }
  }
  return [...out.values()];
}
