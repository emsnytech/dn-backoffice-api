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

const eur = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 2, minimumFractionDigits: 0 });
export const formatCentimes = (c: number | null | undefined) => (c === null || c === undefined ? "—" : eur.format(c / 100));
export const formatPct = (p: number | null | undefined) => (p === null || p === undefined ? "—" : `${p.toLocaleString("fr-FR")} %`);
export const enveloppePath = (id: string) => `/enveloppes/${id}`;
