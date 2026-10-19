// Types et mise en forme du suivi financier (docs/SPEC-multi-demarches.md § C). Les montants
// calculés par le serveur sont en centimes entiers.

export type StatutLigne = "demande" | "programme" | "accepte" | "non_retenu" | "hors_calcul" | "anomalie";

export const STATUTS_LIGNE: Record<StatutLigne, string> = {
  demande: "Demandé",
  programme: "Programmé",
  accepte: "Accepté",
  non_retenu: "Non retenu sur ce régime",
  hors_calcul: "Hors calcul",
  anomalie: "Anomalie",
};

export type Anomalie = { code: string; message: string; grave: boolean; ligne?: number; demarche?: number; dossier?: number | null };

export type Indicateurs = {
  montant: number;
  demande: number;
  programme: number;
  accepte: number;
  engage: number;
  reste: number;
  restePrevisionnel: number;
  nonAffecte: number;
  dossiersNonAffecte: number[];
  millesimeParDefaut: number;
  dossiers: number;
};

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

export type EnveloppeCalculee = {
  id: string;
  libelle: string;
  programme: string | null;
  millesime: number;
  montantCentimes: number;
  parent: string | null;
  demarches: number[];
  modifieLe: string;
  indicateurs: Indicateurs;
  imputations: Imputation[];
  anomalies: Anomalie[];
};

export type DossierFinance = {
  millesime: number | null;
  millesimeParDefaut: boolean;
  coutTotal: number | null;
  plan: { lignes: { financeur: string | null; montant: number | null; statut: string | null; public: boolean }[]; total: number; totalPublic: number } | null;
  programmeSouhaite: string | null;
  motifRepartition: string | null;
  lignes: {
    index: number;
    // Régime d'aide de la ligne.
    programme: string | null;
    rangs: number[];
    statutSaisi: string | null;
    demande: number | null;
    accorde: number | null;
    assiette: number | null;
    taux: number | null;
    referenceEngagement: string | null;
    systemeEngagement: string | null;
    statut: StatutLigne;
    aNotifier: boolean;
  }[];
  nonAffecte: { financeur: string | null; montant: number; regimes: string[] }[];
  taux: { cumule: number | null; obtenues: number | null; apresDecision: number | null };
  anomalies: Anomalie[];
};

// Bloc de décision modifiable (C2b), tel que le serveur le relit dans DN : identifiant de chaque
// champ, valeurs (montants en euros), libellés, types et options des sous-champs.
export type RoleDecision = "regime" | "montant" | "statut" | "assiette" | "referenceEngagement";
export const ROLES_DECISION: RoleDecision[] = ["regime", "statut", "montant", "assiette", "referenceEngagement"];
export type ValeurDecision = string | number | null;
export type VueDecision = {
  saisie: boolean;
  blocChampId: string | null;
  lignes: { rang: number; rowId: string; champs: Partial<Record<RoleDecision, { champId: string; valeur: ValeurDecision }>> }[];
  sousChamps: Partial<Record<RoleDecision, { descripteur: string; libelle: string; genre: "liste" | "entier" | "decimal" | "texte" | "texteLong"; options?: string[] }>>;
};

const eur = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 2, minimumFractionDigits: 0 });
export const formatCentimes = (c: number | null | undefined) => (c === null || c === undefined ? "—" : eur.format(c / 100));
export const formatPct = (p: number | null | undefined) => (p === null || p === undefined ? "—" : `${p.toLocaleString("fr-FR")} %`);
export const enveloppePath = (id: string) => `/enveloppes/${id}`;

// Montant saisi à la française : « 50 000 € », « 1.500.000 », « 12 500,50 ». null si illisible.
export function parseEuros(saisie: string): number | null {
  let s = saisie.replace(/[\s€]/g, "");
  if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(s)) s = s.replace(/\./g, "");
  s = s.replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  return Number(s);
}
