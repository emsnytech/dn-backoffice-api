// Saisie du bloc de décision depuis le back office (docs/SPEC-multi-demarches.md § C, C2b) :
// seule écriture d'annotations permise, limitée aux sous-champs du bloc désignés dans la fiche.
// Le dossier est relu dans DN juste avant d'écrire ; si une valeur a changé entre-temps, rien
// n'est écrit. Montants en euros dans les échanges avec le front.
import type { DemarcheConfig } from "./config.ts";
import { fetchDossier, modifierAnnotations, type AnnotationWrite } from "./dn.ts";
import { findDescriptor, memeLibelle } from "./parametrage.ts";

export const ROLES_DECISION = ["regime", "montant", "statut", "assiette", "referenceEngagement"] as const;
export type RoleDecision = (typeof ROLES_DECISION)[number];
type Valeur = string | number | null;
type Genre = "liste" | "entier" | "decimal" | "texte" | "texteLong";

const GENRES: Record<string, Genre> = {
  DropDownListChampDescriptor: "liste",
  IntegerNumberChampDescriptor: "entier",
  DecimalNumberChampDescriptor: "decimal",
  TextChampDescriptor: "texte",
  TextareaChampDescriptor: "texteLong",
};
// IntegerNumber s'écrit avec le type Int de GraphQL (32 bits).
const INT_MAX = 2_147_483_647;
const TEXTE_MAX = 200;
const MAX_MODIFICATIONS = 50;

export type SousChamp = { descripteur: string; libelle: string; genre: Genre; options?: string[] };
export type LigneVue = { rang: number; rowId: string; champs: Partial<Record<RoleDecision, { champId: string; valeur: Valeur }>> };
export type VueDecision = {
  // Identifiant du champ « bloc » dans le dossier (pour ajouter une ligne) ; null s'il manque.
  blocChampId: string | null;
  lignes: LigneVue[];
  sousChamps: Partial<Record<RoleDecision, SousChamp>>;
};

export class DecisionError extends Error {
  status: 404 | 409 | 422;
  details?: unknown;
  constructor(message: string, status: 404 | 409 | 422, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

function sousChamps(config: DemarcheConfig, revision: any) {
  const bd = config.finances.blocDecision!;
  const out: Partial<Record<RoleDecision, SousChamp>> = {};
  for (const role of ROLES_DECISION) {
    const ref = bd[role];
    if (!ref) continue;
    const d = findDescriptor(revision, ref.id);
    const genre = d && GENRES[d.type];
    if (!d || !genre) continue;
    out[role] = { descripteur: d.id, libelle: d.libelle.replace(/^.* › /, ""), genre, ...(d.options && { options: d.options }) };
  }
  return out;
}

function valeurDe(c: any, genre: Genre): Valeur {
  if (genre === "entier" || genre === "decimal") {
    const v = c?.decimalValue ?? c?.integerValue;
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return c?.stringValue?.trim() || null;
}

// Lignes du bloc de décision d'un dossier, avec l'identifiant de chaque champ (pour l'écriture).
export function vueDecision(dossier: any, config: DemarcheConfig, revision: any): VueDecision | null {
  const bd = config.finances.blocDecision;
  if (!bd) return null;
  const sc = sousChamps(config, revision);
  const bloc = (dossier.annotations ?? []).find((c: any) => c.champDescriptorId === bd.bloc.id && c.rows);
  const lignes: LigneVue[] = (bloc?.rows ?? []).map((r: any, k: number) => {
    const champs: LigneVue["champs"] = {};
    for (const role of ROLES_DECISION) {
      const s = sc[role];
      const c = s && r.champs.find((x: any) => x.champDescriptorId === s.descripteur);
      if (s && c) champs[role] = { champId: c.id, valeur: valeurDe(c, s.genre) };
    }
    return { rang: k + 1, rowId: r.id, champs };
  });
  return { blocChampId: bloc?.id ?? null, lignes, sousChamps: sc };
}

// Nouvelle valeur validée contre la révision publiée, écrite comme dans DN (options).
function valider(s: SousChamp, v: unknown): Valeur {
  if (v === null || v === undefined || v === "") return null;
  switch (s.genre) {
    case "liste": {
      const option = s.options?.find((o) => memeLibelle(o, String(v)));
      if (!option) throw new DecisionError(`« ${v} » n'est pas une option de « ${s.libelle} »`, 422);
      return option;
    }
    case "entier":
    case "decimal": {
      const n = typeof v === "number" ? v : Number(String(v).replace(",", "."));
      if (!Number.isFinite(n) || n < 0) throw new DecisionError(`« ${s.libelle} » : nombre positif ou nul attendu`, 422);
      if (s.genre === "entier" && !Number.isInteger(n)) throw new DecisionError(`« ${s.libelle} » : nombre entier attendu (champ entier dans DN)`, 422);
      if (s.genre === "entier" && n > INT_MAX) throw new DecisionError(`« ${s.libelle} » : ${INT_MAX} au plus (limite de l'API)`, 422);
      return s.genre === "decimal" ? Math.round(n * 100) / 100 : n;
    }
    default: {
      const t = String(v).trim();
      if (t.length > TEXTE_MAX) throw new DecisionError(`« ${s.libelle} » : ${TEXTE_MAX} caractères au plus`, 422);
      return t || null;
    }
  }
}

const egales = (a: Valeur, b: Valeur) =>
  a === null || b === null ? a === b
  : typeof a === "number" || typeof b === "number" ? Math.round(Number(a) * 100) === Math.round(Number(b) * 100)
  : String(a).trim() === String(b).trim();

function ecriture(s: SousChamp, champId: string, v: Valeur): AnnotationWrite {
  const key = { liste: "dropDownList", entier: "integerNumber", decimal: "decimalNumber", texte: "text", texteLong: "textarea" }[s.genre];
  // Un texte vidé s'écrit "" ; une liste ou un nombre vidé, null.
  const value = v === null && (s.genre === "texte" || s.genre === "texteLong") ? "" : v;
  return { id: champId, value: { [key]: value } };
}

export type Modification = { rang: number; role: RoleDecision; libelle: string; avant: Valeur; apres: Valeur };
export type ResultatDecision = { etat: string; modifications: Modification[]; nouvelleLigne: Partial<Record<RoleDecision, Valeur>> | null };

// Applique une saisie : { modifications: [{ champId, role, avant, apres }], nouvelleLigne, lignesAvant }.
export async function appliquerDecision(config: DemarcheConfig, number: number, body: any, revision: any): Promise<ResultatDecision> {
  if (!config.finances.blocDecision) throw new DecisionError("Aucun bloc de décision dans le paramétrage de cette démarche", 422);
  if (typeof body !== "object" || body === null) throw new DecisionError("Saisie invalide", 422);
  const demandes = Array.isArray(body.modifications) ? body.modifications : [];
  if (demandes.length > MAX_MODIFICATIONS) throw new DecisionError(`${MAX_MODIFICATIONS} modifications au plus`, 422);

  // Relecture du dossier dans DN, juste avant l'écriture.
  const dossier = await fetchDossier(config.numero, number);
  if (!dossier) throw new DecisionError("Dossier introuvable dans cette démarche", 404);
  const vue = vueDecision(dossier, config, revision)!;

  const conflits: string[] = [];
  const modifications: Modification[] = [];
  const writes: AnnotationWrite[] = [];
  const vus = new Set<string>();
  for (const m of demandes) {
    const role = m?.role as RoleDecision;
    const s = vue.sousChamps[role];
    if (!ROLES_DECISION.includes(role) || !s) throw new DecisionError("Seuls les sous-champs du bloc de décision désignés dans la fiche sont modifiables", 422);
    const ligne = vue.lignes.find((l) => l.champs[role]?.champId === m.champId);
    if (typeof m.champId !== "string" || !ligne || vus.has(m.champId)) {
      throw new DecisionError("Champ inconnu du bloc de décision de ce dossier : rechargez le dossier", 422);
    }
    vus.add(m.champId);
    const actuel = ligne.champs[role]!.valeur;
    const avant = m.avant === undefined ? null : (m.avant as Valeur);
    const apres = valider(s, m.apres);
    if (!egales(avant, actuel)) {
      conflits.push(`ligne ${ligne.rang}, ${s.libelle} : « ${avant ?? "vide"} » affiché, « ${actuel ?? "vide"} » dans DN`);
      continue;
    }
    if (egales(apres, actuel)) continue;
    modifications.push({ rang: ligne.rang, role, libelle: s.libelle, avant: actuel, apres });
    writes.push(ecriture(s, m.champId, apres));
  }

  let nouvelleLigne: ResultatDecision["nouvelleLigne"] = null;
  if (body.nouvelleLigne) {
    if (!vue.blocChampId) throw new DecisionError("Le bloc de décision est absent de ce dossier dans DN : ajoutez la ligne dans DN", 422);
    if (Number(body.lignesAvant) !== vue.lignes.length) {
      conflits.push(`bloc de décision : ${body.lignesAvant} ligne(s) affichée(s), ${vue.lignes.length} dans DN`);
    }
    nouvelleLigne = {};
    for (const role of ROLES_DECISION) {
      const s = vue.sousChamps[role];
      const v = s ? valider(s, body.nouvelleLigne[role]) : null;
      if (v !== null) nouvelleLigne[role] = v;
    }
    if (!nouvelleLigne.regime) throw new DecisionError("Nouvelle ligne : choisissez le régime d'aide", 422);
  }
  if (conflits.length) {
    throw new DecisionError("Valeur modifiée dans DN entre-temps : rien n'a été écrit. Rechargez le dossier.", 409, conflits);
  }
  if (!writes.length && !nouvelleLigne) throw new DecisionError("Aucune modification à enregistrer", 422);

  if (writes.length) await modifierAnnotations(config.numero, dossier.id, writes);

  if (nouvelleLigne) {
    // En deux temps : ajout d'une ligne vide, relecture pour obtenir ses champs, puis valeurs.
    await modifierAnnotations(config.numero, dossier.id, [{ id: vue.blocChampId!, value: { repetition: 1 } }]);
    const relu = await fetchDossier(config.numero, number);
    const apresAjout = relu ? vueDecision(relu, config, revision)! : null;
    const anciennes = new Set(vue.lignes.map((l) => l.rowId));
    const ajoutees = apresAjout?.lignes.filter((l) => !anciennes.has(l.rowId)) ?? [];
    const vide = "La ligne a été ajoutée vide dans DN (elle est ignorée par le calcul) : complétez-la ou supprimez-la dans DN.";
    if (ajoutees.length !== 1) throw new DecisionError(`DN a ajouté ${ajoutees.length} ligne(s) au lieu d'une. ${vide}`, 422);
    const ligne = ajoutees[0];
    const valeurs: AnnotationWrite[] = [];
    for (const [role, v] of Object.entries(nouvelleLigne) as [RoleDecision, Valeur][]) {
      const champ = ligne.champs[role];
      if (!champ) throw new DecisionError(`Sous-champ « ${vue.sousChamps[role]!.libelle} » absent de la nouvelle ligne. ${vide}`, 422);
      valeurs.push(ecriture(vue.sousChamps[role]!, champ.champId, v));
    }
    try {
      await modifierAnnotations(config.numero, dossier.id, valeurs);
    } catch (e) {
      throw new DecisionError(`${(e as Error).message}. ${vide}`, 422);
    }
  }
  return { etat: dossier.state, modifications, nouvelleLigne };
}
