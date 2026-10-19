// Données financières d'un dossier (docs/SPEC-multi-demarches.md § B et § C) : millésime,
// plan de financement, lignes de financement lues dans le bloc de décision (une par régime
// d'aide), statut financier, taux d'aide publique et anomalies. Montants en centimes entiers.
// Fonctionne sur un dossier brut de l'API (kanban ou fiche), champs et annotations avec valeurs.
import type { ChampRef, DemarcheConfig, StatutDecision } from "./config.ts";
import { cleLibelle, memeLibelle } from "./parametrage.ts";

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
  // Régime d'aide de la ligne : c'est son programme (imputation sur les enveloppes).
  programme: string | null;
  // Rangs (à partir de 1) des lignes du bloc de décision ; vide pour un régime qui ne reçoit
  // qu'un montant demandé du plan, sans ligne saisie dans le bloc.
  rangs: number[];
  // Statut saisi dans DN (option du sous-champ) et sa valeur générique.
  statutSaisi: string | null;
  statutDecision: StatutDecision | null;
  demande: number | null;
  // Montant du bloc de décision : seule source du montant accordé.
  accorde: number | null;
  assiette: number | null;
  // En %, calculé (montant ÷ assiette).
  taux: number | null;
  referenceEngagement: string | null;
  systemeEngagement: string | null;
  statut: StatutLigne;
  // En instruction et « accordé » : décidé, à notifier (§ C).
  aNotifier: boolean;
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
  // Somme du plan pour les financeurs de la table des régimes (montant demandé des cartes).
  demandeNosProgrammes: number | null;
  lignes: LigneDossier[];
  // Montants d'un financeur partagé par plusieurs régimes que le programme souhaité n'a pas
  // permis d'affecter, avec les régimes concernés.
  nonAffecte: { financeur: string | null; montant: number; regimes: string[] }[];
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
const same = memeLibelle;

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

const pct = (part: number, total: number | null) => (total && total > 0 ? Math.round((part / total) * 1000) / 10 : null);
const euros = (c: number) => `${(c / 100).toLocaleString("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: 2 })} €`;

type LigneBloc = { rang: number; regime: string | null; montant: number | null; statut: string | null; assiette: number | null; reference: string | null };

const STATUT_LIBELLE: Record<StatutDecision, string> = { demande: "demandé", propose: "proposé", accorde: "accordé" };
const rangsTexte = (r: number[]) => (r.length > 1 ? `lignes ${r.slice(0, -1).join(", ")} et ${r[r.length - 1]}` : `ligne ${r[0]}`);

export function computeDossier(d: any, config: DemarcheConfig): DossierFinance {
  const f = config.finances;
  const anomalies: Anomalie[] = [];
  const invalide = (label: string) => anomalies.push({ code: "valeur_invalide", message: `${label} : valeur non numérique ou négative`, grave: true });

  const { millesime, parDefaut, illisible } = lireMillesime(d, config);
  if (illisible) anomalies.push({ code: "millesime_illisible", message: "Millésime illisible", grave: true });

  const cout = lireMontant(d, f.coutTotal);
  if (cout.invalide) invalide("Coût total");

  // Plan de financement : une entrée par ligne du bloc répétable.
  let plan: DossierFinance["plan"] = null;
  if (f.planFinancement) {
    const p = f.planFinancement;
    const bloc = [...(d.champs ?? [])].find((c) => c.champDescriptorId === p.bloc.id && c.rows);
    const lignes: LignePlan[] = (bloc?.rows ?? []).map((r: any) => {
      const get = (ref: ChampRef | null) => (ref ? r.champs.find((x: any) => x.champDescriptorId === ref.id) : null);
      const financeur = get(p.financeur)?.stringValue?.trim() || null;
      const n = rawNumber(get(p.montant));
      if (n !== null && (Number.isNaN(n) || n < 0)) invalide(`Plan de financement, montant${financeur ? ` (${financeur})` : ""}`);
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
  const regimesConfig = Object.entries(f.regimes);
  const regimeConfig = (r: string | null) => regimesConfig.find(([k]) => same(k, r))?.[1] ?? null;

  // Lignes saisies dans le bloc de décision (annotations privées).
  const bd = f.blocDecision;
  const saisies: LigneBloc[] = [];
  if (bd) {
    const bloc = [...(d.annotations ?? [])].find((c) => c.champDescriptorId === bd.bloc.id && c.rows);
    (bloc?.rows ?? []).forEach((r: any, k: number) => {
      const get = (ref: ChampRef | null) => (ref ? r.champs.find((x: any) => x.champDescriptorId === ref.id) : null);
      const nombre = (ref: ChampRef | null, label: string) => {
        const n = rawNumber(get(ref));
        if (n !== null && (Number.isNaN(n) || n < 0)) {
          invalide(`Bloc de décision, ligne ${k + 1}, ${label}`);
          return null;
        }
        return n === null ? null : cents(n);
      };
      const ligne: LigneBloc = {
        rang: k + 1,
        regime: get(bd.regime)?.stringValue?.trim() || null,
        montant: nombre(bd.montant, "montant"),
        statut: get(bd.statut)?.stringValue?.trim() || null,
        assiette: nombre(bd.assiette, "assiette"),
        reference: get(bd.referenceEngagement)?.stringValue?.trim() || null,
      };
      if (!ligne.regime) {
        // Une ligne vide est ignorée ; une ligne sans régime mais avec une saisie est signalée.
        if (ligne.montant !== null || ligne.statut || ligne.assiette !== null || ligne.reference) {
          anomalies.push({ code: "ligne_sans_regime", message: `Bloc de décision, ligne ${ligne.rang} : saisie sans régime d'aide`, grave: true });
        }
        return;
      }
      saisies.push(ligne);
    });
  }

  // Régimes présents dans le bloc, regroupés (un régime saisi deux fois est une anomalie).
  const parRegime = new Map<string, LigneBloc[]>();
  for (const l of saisies) {
    const key = cleLibelle(l.regime!);
    parRegime.set(key, [...(parRegime.get(key) ?? []), l]);
  }

  // Montant demandé par régime. Avec un plan : chaque ligne du plan va au régime que la table
  // associe à son financeur ; plusieurs régimes : celui du programme souhaité, sinon non affecté.
  const demandes = new Map<string, { regime: string; montant: number }>();
  const ajouterDemande = (regime: string, montant: number) => {
    const key = cleLibelle(regime);
    const e = demandes.get(key) ?? { regime: parRegime.get(key)?.[0].regime ?? regime, montant: 0 };
    e.montant += montant;
    demandes.set(key, e);
  };
  const nonAffecte = new Map<string, { financeur: string | null; montant: number; regimes: string[] }>();
  const ajouterNonAffecte = (financeur: string | null, regimes: string[], montant: number) => {
    const key = `${financeur ? cleLibelle(financeur) : ""}|${regimes.map(cleLibelle).sort().join(",")}`;
    const e = nonAffecte.get(key) ?? { financeur, montant: 0, regimes };
    e.montant += montant;
    nonAffecte.set(key, e);
  };
  const tousFinanceurs = regimesConfig.flatMap(([, r]) => r.financeurs);
  if (plan) {
    for (const row of plan.lignes) {
      if (row.montant === null || !row.financeur) continue;
      const candidats = regimesConfig.filter(([, r]) => r.financeurs.some((x) => same(x, row.financeur))).map(([k]) => k);
      if (!candidats.length) continue;
      const cible = candidats.length === 1 ? candidats[0] : candidats.find((k) => same(k, programmeSouhaite));
      if (cible !== undefined) ajouterDemande(cible, row.montant);
      else ajouterNonAffecte(row.financeur, candidats, row.montant);
    }
  } else if (bd) {
    // Sans plan : le montant demandé des cartes va au programme souhaité, ou au seul régime du bloc.
    const m = lireMontant(d, config.champs.montantDemande);
    if (m.invalide) invalide("Montant demandé");
    if (m.valeur !== null) {
      const regimesBloc = [...parRegime.values()].map((ls) => ls[0].regime!);
      const connus = [...regimesBloc, ...regimesConfig.map(([k]) => k)];
      const souhaite = programmeSouhaite ? connus.find((k) => same(k, programmeSouhaite)) : undefined;
      if (souhaite) ajouterDemande(souhaite, m.valeur);
      else if (regimesBloc.length === 1) ajouterDemande(regimesBloc[0], m.valeur);
      else ajouterNonAffecte(null, regimesBloc.length ? regimesBloc : regimesConfig.map(([k]) => k), m.valeur);
    }
  }
  const demandeNosProgrammes = plan && tousFinanceurs.length
    ? plan.lignes.filter((r) => tousFinanceurs.some((x) => same(x, r.financeur))).reduce((a, r) => a + (r.montant ?? 0), 0)
    : null;

  // Une ligne de financement par régime : ceux du bloc, puis ceux qui ne reçoivent qu'un
  // montant demandé du plan (statut « demandé »).
  const cles = [...parRegime.keys(), ...[...demandes.keys()].filter((k) => !parRegime.has(k))];
  const refuse = d.state === "refuse" || d.state === "sans_suite";
  const lignes: LigneDossier[] = cles.map((key, index) => {
    const saisie = parRegime.get(key) ?? [];
    const regime = saisie[0]?.regime ?? demandes.get(key)!.regime;
    const demande = demandes.get(key)?.montant ?? null;
    const rc = regimeConfig(regime);
    const rangs = saisie.map((l) => l.rang);
    const anomalie = (code: string, message: string) => anomalies.push({ code, message: `${message} (${regime}${rangs.length ? `, ${rangsTexte(rangs)}` : ""})`, grave: true, ligne: index });
    const base = { index, programme: regime, rangs, demande, systemeEngagement: rc?.systemeEngagement ?? null, aNotifier: false };
    if (saisie.length > 1) {
      anomalie("regime_double", "Régime saisi plusieurs fois dans le bloc de décision : rien n'est compté pour ce régime");
      return { ...base, statutSaisi: null, statutDecision: null, accorde: null, assiette: null, taux: null, referenceEngagement: null, statut: "anomalie" };
    }
    const l = saisie[0];
    const accorde = l?.montant ?? null;
    const assiette = l?.assiette ?? null;
    const statutSaisi = l?.statut ?? null;
    let statutDecision: StatutDecision | null = l ? null : "demande";
    let statut: StatutLigne | null = null;
    if (l) {
      if (statutSaisi) {
        const entree = Object.entries(bd!.statuts).find(([k]) => same(k, statutSaisi));
        if (entree) statutDecision = entree[1];
        else {
          anomalie("statut_inconnu", `Statut « ${statutSaisi} » sans valeur générique dans la fiche de paramétrage`);
          statut = "anomalie";
        }
      } else if (accorde !== null) {
        anomalie("montant_sans_statut", "Montant saisi sans statut");
        statut = "anomalie";
      } else statutDecision = "demande";
    }
    if (rc === null && plan && !refuse) {
      anomalie("regime_sans_financeur", "Régime absent de la table des régimes : son montant demandé ne peut pas être rattaché");
    }
    // Statut financier : l'état DN prime, le statut de la ligne le précise ; un désaccord est
    // une anomalie, jamais une correction silencieuse (§ C).
    let aNotifier = false;
    if (!statut) {
      const decide = statutDecision === "propose" || statutDecision === "accorde";
      if (refuse) {
        statut = "hors_calcul";
        if (statutDecision === "accorde" && (accorde ?? 0) > 0) anomalie("accorde_dossier_refuse", `Ligne « accordé » sur un dossier ${d.state === "refuse" ? "refusé" : "classé sans suite"}`);
      } else if (d.state === "en_construction") {
        statut = "demande";
        if (decide) anomalie("decision_avant_instruction", `Décision saisie avant instruction (« ${STATUT_LIBELLE[statutDecision!]} »)`);
      } else if (statutDecision === "accorde" && accorde === null) {
        anomalie("accorde_sans_montant", "Ligne « accordé » sans montant");
        statut = "anomalie";
      } else if (statutDecision === "accorde" && accorde === 0) {
        statut = "non_retenu";
      } else if (d.state === "en_instruction") {
        statut = statutDecision === "demande" ? "demande" : "programme";
        aNotifier = statutDecision === "accorde";
      } else if (statutDecision === "accorde") {
        statut = "accepte";
      } else {
        anomalie("accepte_non_decide", l
          ? `Dossier accepté, ligne encore « ${STATUT_LIBELLE[statutDecision!]} »`
          : "Dossier accepté : régime demandé dans le plan, sans ligne dans le bloc de décision (saisir « accordé », à 0 € s'il n'est pas retenu)");
        statut = "anomalie";
      }
    }
    if (accorde !== null && demande !== null && accorde > demande) {
      anomalies.push({ code: "accorde_sup_demande", message: `Montant accordé (${euros(accorde)}) supérieur au montant demandé (${euros(demande)}) (${regime})`, grave: false, ligne: index });
    }
    if (accorde !== null && assiette !== null && accorde > assiette) {
      anomalies.push({ code: "accorde_sup_assiette", message: `Montant accordé (${euros(accorde)}) supérieur à l'assiette (${euros(assiette)}) (${regime})`, grave: false, ligne: index });
    }
    return {
      ...base, statutSaisi, statutDecision, accorde, assiette,
      taux: accorde !== null && assiette ? pct(accorde, assiette) : null,
      referenceEngagement: l?.reference ?? null, statut, aNotifier,
    };
  });
  if (bd && d.state === "accepte" && !lignes.some((l) => l.statut === "accepte" || l.statut === "anomalie")) {
    anomalies.push({ code: "accepte_sans_ligne", message: "Dossier accepté sans aucune ligne retenue dans le bloc de décision", grave: true });
  }

  // Taux d'aide publique (§ C) : toutes les lignes du plan comptent, quel que soit leur statut.
  const coutTotal = cout.valeur;
  const taux: DossierFinance["taux"] = { cumule: null, obtenues: null, apresDecision: null };
  if (plan && coutTotal) {
    taux.cumule = pct(plan.totalPublic, coutTotal);
    if (f.planFinancement?.statut) {
      taux.obtenues = pct(plan.lignes.filter((r) => r.public && r.statut && cleLibelle(r.statut).startsWith("obten")).reduce((a, r) => a + (r.montant ?? 0), 0), coutTotal);
    }
    if (lignes.some((l) => l.accorde !== null)) {
      const autres = plan.lignes.filter((r) => r.public && !tousFinanceurs.some((x) => same(x, r.financeur))).reduce((a, r) => a + (r.montant ?? 0), 0);
      const nosLignes = lignes.reduce((a, l) => a + (l.accorde ?? l.demande ?? 0), 0);
      // Un montant non affecté reste compté tant qu'aucun des régimes qui le partagent n'est décidé.
      const decide = (r: string) => lignes.some((l) => same(l.programme, r) && l.accorde !== null);
      const restants = [...nonAffecte.values()].filter((n) => !n.regimes.some(decide)).reduce((a, n) => a + n.montant, 0);
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
          anomalies.push({ code: "taux_sup_plafond", message: `Taux de ${l.taux} % au-delà du plafond de ${plafond} % (${l.programme})`, grave: false, ligne: l.index });
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
