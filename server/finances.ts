// Données financières d'un dossier (docs/SPEC-multi-demarches.md § B et § C) : millésime,
// plan de financement, montants par ligne de financement, statut financier, taux d'aide
// publique et anomalies. Montants en centimes entiers. Fonctionne sur un dossier brut de
// l'API (kanban ou fiche), dont les champs et annotations portent leurs valeurs.
import type { ChampRef, DemarcheConfig, LigneFinancement } from "./config.ts";
import { normalize } from "./parametrage.ts";

export type StatutLigne = "demande" | "programme" | "accepte" | "non_retenu" | "hors_calcul" | "anomalie";

export type Anomalie = {
  code: string;
  message: string;
  // true : liste principale des anomalies ; false : anomalie non bloquante (rien n'est retiré du calcul).
  grave: boolean;
  ligne?: number;
};

export type LigneDossier = {
  index: number;
  programme: string | null;
  demande: number | null;
  accorde: number | null;
  assiette: number | null;
  // En %, lu dans l'annotation ou calculé (accordé ÷ assiette).
  taux: number | null;
  numeroEJ: string | null;
  statut: StatutLigne;
};

export type LignePlan = { financeur: string | null; montant: number | null; statut: string | null; annee: string | null; public: boolean };

export type DossierFinance = {
  number: number;
  state: string;
  millesime: number | null;
  millesimeParDefaut: boolean;
  coutTotal: number | null;
  plan: { lignes: LignePlan[]; total: number; totalPublic: number } | null;
  programmeSouhaite: string | null;
  motifRepartition: string | null;
  // Somme du plan pour les financeurs d'au moins une ligne (montant demandé des cartes).
  demandeNosProgrammes: number | null;
  lignes: LigneDossier[];
  // Montants d'un financeur partagé que le programme souhaité n'a pas permis d'affecter,
  // avec les lignes de financement qui partagent ce financeur.
  nonAffecte: { financeur: string; montant: number; lignes: number[] }[];
  taux: { cumule: number | null; obtenues: number | null; apresDecision: number | null };
  anomalies: Anomalie[];
};

// IntegerNumberChamp.value est un BigInt, transmis en chaîne. Les requêtes nomment la valeur
// decimalValue / integerValue (deux types différents ne peuvent pas partager le nom value).
function rawNumber(c: any): number | null {
  const v = c?.decimalValue ?? c?.integerValue ?? c?.value;
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

const cents = (euros: number) => Math.round(euros * 100);
const same = (a: string | null | undefined, b: string | null | undefined) => Boolean(a && b) && normalize(a!).trim() === normalize(b!).trim();

// Champs d'un dossier pour un descripteur : au premier niveau, ou dans les lignes d'un bloc
// répétable, parmi les champs du formulaire et les annotations.
function champsFor(d: any, ref: ChampRef) {
  const all = [...(d.champs ?? []), ...(d.annotations ?? [])];
  const top = all.filter((c) => c.champDescriptorId === ref.id);
  if (top.length) return top;
  return all.filter((c) => c.rows).flatMap((c) => c.rows.flatMap((r: any) => r.champs.filter((x: any) => x.champDescriptorId === ref.id)));
}

// Montant en centimes (somme des lignes pour un champ de bloc). invalide : valeur non
// numérique ou négative.
function lireMontant(d: any, ref: ChampRef | null): { valeur: number | null; invalide: boolean } {
  if (!ref) return { valeur: null, invalide: false };
  let total: number | null = null;
  for (const c of champsFor(d, ref)) {
    const n = rawNumber(c);
    if (n === null) continue;
    if (Number.isNaN(n) || n < 0) return { valeur: null, invalide: true };
    total = (total ?? 0) + cents(n);
  }
  return { valeur: total, invalide: false };
}

function lireTexte(d: any, ref: ChampRef | null): string | null {
  if (!ref) return null;
  const c = champsFor(d, ref)[0];
  const v = c?.stringValue?.trim();
  return v || null;
}

const anneeDe = (s: string | null) => {
  const m = s ? /\b(19|20)\d\d\b/.exec(s) : null;
  return m ? Number(m[0]) : null;
};

function lireMillesime(d: any, config: DemarcheConfig) {
  const depot = new Date(d.dateDepot).getFullYear();
  const m = config.finances.millesime;
  if (m.source === "anneeDepot") return { millesime: depot, parDefaut: true, illisible: false };
  const c = champsFor(d, m.ref)[0];
  const n = rawNumber(c);
  const brut = n !== null && !Number.isNaN(n) ? String(n) : (c?.stringValue?.trim() || null);
  // Champ vide sur ce dossier : année de dépôt, comptée en « millésime par défaut ».
  if (!brut) return { millesime: depot, parDefaut: true, illisible: false };
  const annee = anneeDe(brut);
  return annee ? { millesime: annee, parDefaut: false, illisible: false } : { millesime: null, parDefaut: false, illisible: true };
}

function programmeDe(d: any, l: LigneFinancement) {
  if (!l.programme) return null;
  return l.programme.source === "fixe" ? l.programme.valeur : lireTexte(d, l.programme.ref);
}

const pct = (part: number, total: number | null) => (total && total > 0 ? Math.round((part / total) * 1000) / 10 : null);
const euros = (c: number) => `${(c / 100).toLocaleString("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: 2 })} €`;

export function computeDossier(d: any, config: DemarcheConfig): DossierFinance {
  const f = config.finances;
  const anomalies: Anomalie[] = [];
  const nom = (i: number, p: string | null) => (f.lignes.length > 1 ? ` (ligne ${i + 1}${p ? `, ${p}` : ""})` : "");

  const { millesime, parDefaut, illisible } = lireMillesime(d, config);
  if (illisible) anomalies.push({ code: "millesime_illisible", message: "Millésime illisible", grave: true });

  const cout = lireMontant(d, f.coutTotal);
  if (cout.invalide) anomalies.push({ code: "valeur_invalide", message: "Coût total : valeur non numérique ou négative", grave: true });

  // Plan de financement : une entrée par ligne du bloc répétable.
  let plan: DossierFinance["plan"] = null;
  if (f.planFinancement) {
    const p = f.planFinancement;
    const bloc = [...(d.champs ?? [])].find((c) => c.champDescriptorId === p.bloc.id && c.rows);
    const lignes: LignePlan[] = (bloc?.rows ?? []).map((r: any) => {
      const get = (ref: ChampRef | null) => (ref ? r.champs.find((x: any) => x.champDescriptorId === ref.id) : null);
      const financeur = get(p.financeur)?.stringValue?.trim() || null;
      const n = rawNumber(get(p.montant));
      if (n !== null && (Number.isNaN(n) || n < 0)) {
        anomalies.push({ code: "valeur_invalide", message: `Plan de financement : montant non numérique ou négatif${financeur ? ` (${financeur})` : ""}`, grave: true });
      }
      return {
        financeur,
        montant: n === null || Number.isNaN(n) || n < 0 ? null : cents(n),
        statut: get(p.statut)?.stringValue?.trim() || null,
        annee: get(p.annee)?.stringValue?.trim() || null,
        public: p.financeursPublics.some((x) => same(x, financeur)),
      };
    });
    const sum = (rows: LignePlan[]) => rows.reduce((a, r) => a + (r.montant ?? 0), 0);
    plan = { lignes, total: sum(lignes), totalPublic: sum(lignes.filter((r) => r.public)) };
  }

  const programmeSouhaite = lireTexte(d, f.programmeSouhaite);
  const programmes = f.lignes.map((l) => programmeDe(d, l));

  // Montant demandé par ligne. Avec un plan et des financeurs : lignes du plan dont le
  // financeur relève de la ligne ; un financeur partagé va à la ligne du programme souhaité,
  // sinon il est « non affecté ».
  const demandes: (number | null)[] = f.lignes.map(() => null);
  const nonAffecte = new Map<string, { financeur: string; montant: number; lignes: number[] }>();
  if (plan) {
    for (const row of plan.lignes) {
      if (row.montant === null || !row.financeur) continue;
      const concernees = f.lignes.map((l, i) => (l.financeurs.some((x) => same(x, row.financeur)) ? i : -1)).filter((i) => i >= 0);
      if (!concernees.length) continue;
      const cible = concernees.length === 1 ? concernees[0] : concernees.find((i) => same(programmes[i], programmeSouhaite));
      if (cible !== undefined) {
        demandes[cible] = (demandes[cible] ?? 0) + row.montant;
      } else {
        const key = `${normalize(row.financeur)}|${concernees.join(",")}`;
        const entry = nonAffecte.get(key) ?? { financeur: row.financeur, montant: 0, lignes: concernees };
        entry.montant += row.montant;
        nonAffecte.set(key, entry);
      }
    }
  }
  const financeursLignes = f.lignes.flatMap((l) => l.financeurs);
  const demandeNosProgrammes = plan && financeursLignes.length
    ? plan.lignes.filter((r) => financeursLignes.some((x) => same(x, r.financeur))).reduce((a, r) => a + (r.montant ?? 0), 0)
    : null;

  const lus = f.lignes.map((l, i) => {
    let demande = demandes[i];
    if (!(plan && l.financeurs.length)) {
      const source = l.montantDemande ?? (f.lignes.length === 1 ? config.champs.montantDemande : null);
      const m = lireMontant(d, source);
      if (m.invalide) anomalies.push({ code: "valeur_invalide", message: `Montant demandé${nom(i, programmes[i])} : valeur non numérique ou négative`, grave: true, ligne: i });
      demande = m.valeur;
    }
    const accorde = lireMontant(d, l.montantAccorde);
    const assiette = lireMontant(d, l.assiette);
    const tauxLu = l.taux ? lireMontant(d, l.taux) : null;
    for (const [label, m] of [["Montant accordé", accorde], ["Assiette", assiette], ["Taux", tauxLu]] as const) {
      if (m?.invalide) anomalies.push({ code: "valeur_invalide", message: `${label}${nom(i, programmes[i])} : valeur non numérique ou négative`, grave: true, ligne: i });
    }
    const taux = tauxLu?.valeur != null ? tauxLu.valeur / 100 : accorde.valeur !== null && assiette.valeur ? pct(accorde.valeur, assiette.valeur) : null;
    return { demande, accorde, assiette: assiette.valeur, taux, numeroEJ: lireTexte(d, l.numeroEJ) };
  });

  // Statut financier par ligne (table du § C).
  const lignes: LigneDossier[] = lus.map((x, i) => {
    const accorde = x.accorde.valeur;
    let statut: StatutLigne;
    if (x.accorde.invalide) statut = "anomalie";
    else if (d.state === "refuse" || d.state === "sans_suite") statut = "hors_calcul";
    else if (d.state === "en_construction") {
      statut = "demande";
      if (accorde !== null) anomalies.push({ code: "accorde_avant_instruction", message: `Montant accordé avant instruction${nom(i, programmes[i])}`, grave: true, ligne: i });
    } else if (d.state === "en_instruction") statut = accorde === null ? "demande" : "programme";
    else if (accorde !== null && accorde > 0) statut = "accepte";
    else if (f.lignes.length > 1 && lus.some((o, j) => j !== i && (o.accorde.valeur ?? 0) > 0)) statut = "non_retenu";
    else {
      statut = "anomalie";
      anomalies.push({
        code: accorde === null ? "accepte_sans_montant" : "accepte_zero",
        message: accorde === null ? `Accepté sans montant accordé${nom(i, programmes[i])}` : `Accepté à 0 €${nom(i, programmes[i])}`,
        grave: true,
        ligne: i,
      });
    }
    if (accorde !== null && x.demande !== null && accorde > x.demande) {
      anomalies.push({ code: "accorde_sup_demande", message: `Montant accordé (${euros(accorde)}) supérieur au montant demandé (${euros(x.demande)})${nom(i, programmes[i])}`, grave: false, ligne: i });
    }
    if (accorde !== null && x.assiette !== null && accorde > x.assiette) {
      anomalies.push({ code: "accorde_sup_assiette", message: `Montant accordé (${euros(accorde)}) supérieur à l'assiette (${euros(x.assiette)})${nom(i, programmes[i])}`, grave: false, ligne: i });
    }
    return { index: i, programme: programmes[i], demande: x.demande, accorde, assiette: x.assiette, taux: x.taux, numeroEJ: x.numeroEJ, statut };
  });

  // Taux d'aide publique (§ C) : toutes les lignes du plan comptent, quel que soit leur statut.
  const coutTotal = cout.valeur;
  const taux: DossierFinance["taux"] = { cumule: null, obtenues: null, apresDecision: null };
  if (plan && coutTotal) {
    taux.cumule = pct(plan.totalPublic, coutTotal);
    if (f.planFinancement?.statut) {
      taux.obtenues = pct(plan.lignes.filter((r) => r.public && r.statut && normalize(r.statut).startsWith("obten")).reduce((a, r) => a + (r.montant ?? 0), 0), coutTotal);
    }
    if (lignes.some((l) => l.accorde !== null)) {
      const autres = plan.lignes.filter((r) => r.public && !financeursLignes.some((x) => same(x, r.financeur))).reduce((a, r) => a + (r.montant ?? 0), 0);
      const nosLignes = lignes.reduce((a, l) => a + (l.accorde ?? l.demande ?? 0), 0);
      // Un montant non affecté reste compté tant qu'aucune des lignes qui le partagent n'est décidée.
      const restants = [...nonAffecte.values()].filter((n) => n.lignes.every((i) => lignes[i].accorde === null)).reduce((a, n) => a + n.montant, 0);
      taux.apresDecision = pct(autres + nosLignes + restants, coutTotal);
    }
  }
  const plafond = f.tauxMaxAidesPubliques;
  if (plafond !== null) {
    const t = taux.apresDecision ?? taux.cumule;
    if (t !== null && t > plafond) {
      anomalies.push({
        code: "taux_sup_plafond",
        message: `Taux d'aide publique ${taux.apresDecision !== null ? "après décision" : "cumulé prévisionnel"} de ${t} %, au-delà du plafond de ${plafond} %`,
        grave: false,
      });
    } else if (!plan) {
      for (const l of lignes) {
        if (l.taux !== null && l.taux > plafond) {
          anomalies.push({ code: "taux_sup_plafond", message: `Taux de ${l.taux} % au-delà du plafond de ${plafond} %${nom(l.index, l.programme)}`, grave: false, ligne: l.index });
        }
      }
    }
  }
  if (plan && coutTotal !== null && Math.abs(plan.total - coutTotal) > 100) {
    anomalies.push({ code: "plan_cout_total", message: `Plan de financement (${euros(plan.total)}) différent du coût total (${euros(coutTotal)})`, grave: false });
  }

  return {
    number: d.number,
    state: d.state,
    millesime,
    millesimeParDefaut: parDefaut,
    coutTotal,
    plan,
    programmeSouhaite,
    motifRepartition: lireTexte(d, f.motifRepartition),
    demandeNosProgrammes,
    lignes,
    nonAffecte: [...nonAffecte.values()],
    taux,
    anomalies,
  };
}
