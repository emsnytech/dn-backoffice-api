// Fiche de paramétrage (docs/SPEC-multi-demarches.md § B) : champs candidats pour chaque
// rôle, propositions automatiques avec leur raison, contrôle des champs désignés.
import type { BlocDecision, ChampRef, DemarcheConfig, Regime, StatutDecision } from "./config.ts";

// Champ ou annotation de la révision publiée, aplati. Les champs d'un bloc répétable
// gardent le nom du bloc ; leurs valeurs s'additionnent ligne à ligne.
export type Descripteur = {
  id: string;
  libelle: string;
  type: string;
  source: "formulaire" | "annotation";
  position: string;
  // Champ d'un bloc répétable : libellé et identifiant du bloc.
  bloc?: string;
  blocId?: string;
  // Bloc répétable : types de ses sous-champs.
  sousTypes?: string[];
  options?: string[];
};

const STRUCTURE = new Set(["HeaderSectionChampDescriptor", "ExplicationChampDescriptor"]);
const NOMBRE = new Set(["IntegerNumberChampDescriptor", "DecimalNumberChampDescriptor", "NumberChampDescriptor"]);
const TEXTE = new Set(["TextChampDescriptor", "TextareaChampDescriptor"]);
const LISTE = "DropDownListChampDescriptor";
const REPETITION = "RepetitionChampDescriptor";
// Une liste déroulante ne peut servir de millésime que si toutes ses options sont des années.
const listeAnnees = (d: Descripteur) => d.type === LISTE && Boolean(d.options?.length) && d.options!.every((o) => /^\s*(19|20)\d\d\s*$/.test(o));

export function descripteurs(revision: any): Descripteur[] {
  const out: Descripteur[] = [];
  for (const [source, list] of [["formulaire", revision.champDescriptors], ["annotation", revision.annotationDescriptors]] as const) {
    let pos = 0;
    for (const d of list ?? []) {
      if (STRUCTURE.has(d.__typename)) continue;
      pos++;
      const repetition = d.__typename === REPETITION;
      out.push({
        id: d.id, libelle: d.label, type: d.__typename, source, position: `${pos}`,
        ...(d.options && { options: d.options }),
        ...(repetition && { sousTypes: (d.champDescriptors ?? []).map((c: any) => c.__typename) }),
      });
      if (!repetition) continue;
      let k = 0;
      for (const c of d.champDescriptors ?? []) {
        if (STRUCTURE.has(c.__typename)) continue;
        k++;
        out.push({
          id: c.id, libelle: `${d.label} › ${c.label}`, type: c.__typename, source, position: `${pos}.${k}`, bloc: d.label, blocId: d.id,
          ...(c.options && { options: c.options }),
        });
      }
    }
  }
  return out;
}

export const findDescriptor = (revision: any, id: string) => descripteurs(revision).find((d) => d.id === id) ?? null;

type RoleDef = { nom: string; accepte: (d: Descripteur) => boolean; mots: string[] };

// Types acceptés et mots-clés de proposition, par rôle (tableaux du § B).
export const ROLES = {
  objet: {
    nom: "Objet",
    accepte: (d) => d.source === "formulaire" && !d.bloc && TEXTE.has(d.type),
    mots: ["objet", "intitulé", "projet", "titre"],
  },
  montantDemande: {
    nom: "Montant demandé",
    accepte: (d) => d.source === "formulaire" && NOMBRE.has(d.type),
    mots: ["montant", "demandé", "subvention", "€"],
  },
  millesime: {
    nom: "Millésime",
    accepte: (d) => !d.bloc && (d.type === "IntegerNumberChampDescriptor" || listeAnnees(d)),
    mots: ["année", "millésime", "exercice"],
  },
  coutTotal: {
    nom: "Coût total",
    accepte: (d) => d.source === "formulaire" && !d.bloc && NOMBRE.has(d.type),
    mots: ["coût", "total", "HT"],
  },
  planBloc: {
    nom: "Plan de financement",
    accepte: (d) =>
      d.source === "formulaire" && d.type === REPETITION &&
      Boolean(d.sousTypes?.includes(LISTE)) && Boolean(d.sousTypes?.some((t) => NOMBRE.has(t))),
    mots: ["financement", "financeur", "plan"],
  },
  planFinanceur: { nom: "Financeur (plan)", accepte: (d) => Boolean(d.blocId) && d.type === LISTE, mots: ["financeur"] },
  planMontant: { nom: "Montant (plan)", accepte: (d) => Boolean(d.blocId) && NOMBRE.has(d.type), mots: ["montant"] },
  planStatut: { nom: "Statut (plan)", accepte: (d) => Boolean(d.blocId) && d.type === LISTE, mots: ["statut", "état"] },
  planAnnee: {
    nom: "Année (plan)",
    accepte: (d) => Boolean(d.blocId) && (d.type === "IntegerNumberChampDescriptor" || d.type === LISTE || d.type === "TextChampDescriptor"),
    mots: ["année", "exercice"],
  },
  programmeSouhaite: {
    nom: "Programme souhaité",
    accepte: (d) => d.source === "formulaire" && !d.bloc && d.type === LISTE,
    mots: ["programme", "régime", "souhaité", "dotation"],
  },
  motifRepartition: {
    nom: "Motif de répartition",
    accepte: (d) => d.source === "annotation" && !d.bloc && TEXTE.has(d.type),
    mots: ["motif", "répartition"],
  },
  // Bloc de décision (§ B) : bloc répétable d'annotations privées, une ligne par régime d'aide.
  decisionBloc: {
    nom: "Bloc de décision",
    accepte: (d) =>
      d.source === "annotation" && d.type === REPETITION &&
      Boolean(d.sousTypes?.includes(LISTE)) && Boolean(d.sousTypes?.some((t) => NOMBRE.has(t))),
    mots: ["financement", "décision", "aide"],
  },
  decisionRegime: { nom: "Régime d'aide", accepte: (d) => d.source === "annotation" && Boolean(d.blocId) && d.type === LISTE, mots: ["régime", "programme", "dispositif"] },
  decisionMontant: { nom: "Montant (décision)", accepte: (d) => d.source === "annotation" && Boolean(d.blocId) && NOMBRE.has(d.type), mots: ["montant", "aide", "accordé"] },
  decisionStatut: { nom: "Statut (décision)", accepte: (d) => d.source === "annotation" && Boolean(d.blocId) && d.type === LISTE, mots: ["statut", "état", "décision"] },
  decisionAssiette: { nom: "Assiette", accepte: (d) => d.source === "annotation" && Boolean(d.blocId) && NOMBRE.has(d.type), mots: ["assiette", "éligible"] },
  decisionReference: {
    nom: "Référence d'engagement",
    accepte: (d) => d.source === "annotation" && Boolean(d.blocId) && TEXTE.has(d.type),
    mots: ["engagement", "référence", "EJ", "Chorus"],
  },
} satisfies Record<string, RoleDef>;

export type Role = keyof typeof ROLES;

export const normalize = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// Comparaison des libellés (régime, programme souhaité, financeur, statut) : casse, accents,
// espaces (y compris insécables) et apostrophes (' ‘ ’) normalisés (§ B).
export const cleLibelle = (s: string) => normalize(s).replace(/[‘’ʼ`´]/g, "'").replace(/\s+/g, " ").trim();
export const memeLibelle = (a: string | null | undefined, b: string | null | undefined) =>
  Boolean(a && b) && cleLibelle(a!) === cleLibelle(b!);
const tokens = (s: string) => normalize(s).replace(/([€%])/g, " $1 ").split(/[^a-z0-9€%]+/).filter(Boolean);

// Mot-clé reconnu au début d'un mot du libellé ; les mots courts (HT, EJ, €, %) doivent être exacts.
function contient(libelle: string, mot: string) {
  const m = normalize(mot);
  return tokens(libelle).some((t) => (m.length <= 2 ? t === m : t.startsWith(m)));
}

type Choix = { ref: ChampRef | null; raison: string };
const ref = (d: Descripteur): ChampRef => ({ id: d.id, libelle: d.libelle });

// Libellés de comptage (« Nombre total de salariés ») : jamais proposés par mot-clé.
const COMPTAGE = ["nombre", "etpt", "effectif"];

function proposer(candidats: Descripteur[], mots: string[], repli: { seul?: string; premier?: string; aucun?: string } = {}): Choix {
  for (const mot of mots) {
    const d = candidats.find((c) => contient(c.libelle, mot) && !COMPTAGE.some((x) => contient(c.libelle, x)));
    if (d) return { ref: ref(d), raison: `libellé contenant « ${mot} »` };
  }
  if (repli.seul && candidats.length === 1) return { ref: ref(candidats[0]), raison: repli.seul };
  if (repli.premier && candidats.length) return { ref: ref(candidats[0]), raison: repli.premier };
  if (repli.aucun) return { ref: null, raison: repli.aucun };
  return { ref: null, raison: candidats.length ? "aucun libellé reconnu : à choisir" : "aucun champ de ce type" };
}

// Financeurs publics proposés par défaut (§ B), reconnus dans les options du sous-champ financeur.
const FINANCEURS_PUBLICS = ["État", "Région", "Département", "Intercommunalité", "Union européenne", "Autre financeur public"];
const memeOption = (option: string, nom: string) => cleLibelle(option).includes(cleLibelle(nom));

// Titre DN tronqué à 120 caractères, sur une fin de mot.
function libelleCourt(title: string) {
  if (title.length <= 120) return title;
  const cut = title.slice(0, 119);
  return `${cut.slice(0, cut.lastIndexOf(" ") > 60 ? cut.lastIndexOf(" ") : 119)}…`;
}

// Valeur générique proposée pour une option du statut (§ B, propositions).
function statutPropose(option: string): StatutDecision | null {
  const o = cleLibelle(option);
  if (o.includes("demand")) return "demande";
  if (o.includes("propos")) return "propose";
  if (o.includes("accord") || o.includes("attribu")) return "accorde";
  return null;
}

export function proposition(demarche: any) {
  const all = descripteurs(demarche.activeRevision);
  const candidats = Object.fromEntries(
    (Object.keys(ROLES) as Role[]).map((r) => [r, all.filter(ROLES[r].accepte)]),
  ) as Record<Role, Descripteur[]>;

  // Plan de financement : un bloc répétable avec une liste (financeur) et un nombre (montant).
  const bloc = proposer(candidats.planBloc, ROLES.planBloc.mots, { seul: "seul bloc répétable avec une liste et un nombre" });
  const enfants = (role: Role) => candidats[role].filter((c) => bloc.ref && c.blocId === bloc.ref.id);
  const financeur = bloc.ref ? proposer(enfants("planFinanceur"), ["financeur"], { premier: "première liste du bloc" }) : null;
  const montantPlan = bloc.ref ? proposer(enfants("planMontant"), ["montant"], { premier: "premier nombre du bloc" }) : null;
  const statut = bloc.ref
    ? proposer(enfants("planStatut").filter((c) => c.id !== financeur?.ref?.id), ["statut", "état"], { aucun: "aucune liste « statut » dans le bloc" })
    : null;
  const annee = bloc.ref ? proposer(enfants("planAnnee").filter((c) => c.id !== financeur?.ref?.id), ["année", "exercice"], { aucun: "aucun sous-champ « année »" }) : null;
  const optionsFinanceur = financeur?.ref ? (all.find((d) => d.id === financeur.ref!.id)?.options ?? []) : [];
  const financeursPublics = optionsFinanceur.filter((o) => FINANCEURS_PUBLICS.some((n) => memeOption(o, n)));
  const plan = bloc.ref && financeur?.ref && montantPlan?.ref
    ? { bloc: bloc.ref, financeur: financeur.ref, montant: montantPlan.ref, statut: statut?.ref ?? null, annee: annee?.ref ?? null, financeursPublics }
    : null;

  // Bloc de décision : statut d'abord, puis le régime parmi les autres listes du bloc.
  const blocD = proposer(candidats.decisionBloc, ROLES.decisionBloc.mots, { seul: "seul bloc d'annotations avec une liste et un nombre" });
  const enfantsD = (role: Role) => candidats[role].filter((c) => blocD.ref && c.blocId === blocD.ref.id);
  const statutD = blocD.ref ? proposer(enfantsD("decisionStatut"), ROLES.decisionStatut.mots) : null;
  const regimeD = blocD.ref
    ? proposer(enfantsD("decisionRegime").filter((c) => c.id !== statutD?.ref?.id), ROLES.decisionRegime.mots, { seul: "la liste du bloc qui n'est pas le statut" })
    : null;
  const montantD = blocD.ref ? proposer(enfantsD("decisionMontant"), ROLES.decisionMontant.mots, { premier: "premier nombre du bloc" }) : null;
  const assietteD = blocD.ref
    ? proposer(enfantsD("decisionAssiette").filter((c) => c.id !== montantD?.ref?.id), ROLES.decisionAssiette.mots, { aucun: "aucun nombre « assiette » dans le bloc" })
    : null;
  const referenceD = blocD.ref ? proposer(enfantsD("decisionReference"), ROLES.decisionReference.mots, { aucun: "aucun texte « engagement » ou « référence » dans le bloc" }) : null;
  const optionsStatut = statutD?.ref ? (all.find((d) => d.id === statutD.ref!.id)?.options ?? []) : [];
  const optionsRegime = regimeD?.ref ? (all.find((d) => d.id === regimeD.ref!.id)?.options ?? []) : [];
  const statuts: Record<string, StatutDecision> = {};
  for (const o of optionsStatut) {
    const v = statutPropose(o);
    if (v) statuts[o] = v;
  }
  // Financeurs d'un régime : une option du financeur qui figure dans le libellé du régime,
  // sinon l'option « État ».
  const regimes: Record<string, Regime> = {};
  const raisonsRegimes: Record<string, string> = {};
  for (const r of optionsRegime) {
    const dans = optionsFinanceur.filter((o) => cleLibelle(r).includes(cleLibelle(o)));
    const etat = optionsFinanceur.filter((o) => memeOption(o, "État") || memeOption(o, "Etat")).slice(0, 1);
    const financeurs = dans.length ? dans : etat;
    regimes[r] = { financeurs: plan ? financeurs : [], systemeEngagement: null };
    raisonsRegimes[r] = !plan ? "aucun plan de financement" : dans.length ? "financeur cité dans le libellé du régime" : etat.length ? "option « État »" : "à choisir";
  }
  const decision: BlocDecision | null = blocD.ref && regimeD?.ref && montantD?.ref && statutD?.ref
    ? {
        bloc: blocD.ref, regime: regimeD.ref, montant: montantD.ref, statut: statutD.ref,
        assiette: assietteD?.ref ?? null, referenceEngagement: referenceD?.ref ?? null, statuts,
      }
    : null;

  const objet = proposer(candidats.objet, ROLES.objet.mots, { premier: "premier champ texte du formulaire" });
  // Avec un plan, le montant demandé des cartes se calcule à partir de la table des régimes.
  const montantDemande = plan
    ? { ref: null, raison: "calculé à partir du plan de financement (financeurs de la table des régimes)" }
    : proposer(candidats.montantDemande, ROLES.montantDemande.mots, { seul: "seul champ nombre du formulaire" });
  const coutTotal = proposer(candidats.coutTotal, ROLES.coutTotal.mots);
  const programmeSouhaite = proposer(candidats.programmeSouhaite, ROLES.programmeSouhaite.mots, { aucun: "aucune liste « programme » hors bloc dans le formulaire" });
  const motif = proposer(candidats.motifRepartition, ROLES.motifRepartition.mots, { aucun: "aucune annotation « motif » ou « répartition »" });
  const millesime = proposer(candidats.millesime, ROLES.millesime.mots, {
    aucun: "aucun champ « année », « millésime » ou « exercice » : année de dépôt",
  });

  return {
    candidats,
    proposition: {
      libelle: libelleCourt(demarche.title),
      mutations: false,
      delaiCibleJours: 45,
      champs: { objet: objet.ref, montantDemande: montantDemande.ref },
      finances: {
        millesime: millesime.ref ? { source: "champ" as const, ref: millesime.ref } : { source: "anneeDepot" as const },
        coutTotal: coutTotal.ref,
        planFinancement: plan,
        programmeSouhaite: programmeSouhaite.ref,
        tauxMaxAidesPubliques: null,
        motifRepartition: motif.ref,
        blocDecision: decision,
        regimes: decision ? regimes : {},
      },
    },
    raisons: {
      objet: objet.raison,
      montantDemande: montantDemande.raison,
      millesime: millesime.raison,
      coutTotal: coutTotal.raison,
      plan: {
        bloc: bloc.raison,
        financeur: financeur?.raison ?? null,
        montant: montantPlan?.raison ?? null,
        statut: statut?.raison ?? null,
        annee: annee?.raison ?? null,
        financeursPublics: financeur?.ref ? "options État, Région, Département, Intercommunalité, Union européenne, Autre financeur public" : null,
      },
      programmeSouhaite: programmeSouhaite.raison,
      motifRepartition: motif.raison,
      decision: {
        bloc: blocD.raison,
        regime: regimeD?.raison ?? null,
        montant: montantD?.raison ?? null,
        statut: statutD?.raison ?? null,
        assiette: assietteD?.raison ?? null,
        referenceEngagement: referenceD?.raison ?? null,
        statuts: optionsStatut.length ? "« demand… » → demandé, « propos… » → proposé, « accord… » ou « attribu… » → accordé" : null,
        regimes: raisonsRegimes,
      },
      sansBloc: candidats.decisionBloc.length ? null : "Aucun bloc répétable dans les annotations privées",
    },
  };
}

// Champs désignés qui n'existent plus dans la révision publiée : la fiche et le kanban
// l'affichent, et les calculs concernés sont suspendus (§ B).
export function introuvables(config: DemarcheConfig, revision: any) {
  const ids = new Set(descripteurs(revision).map((d) => d.id));
  const out: { role: string; libelle: string }[] = [];
  const check = (r: ChampRef | null | undefined, role: string) => r && !ids.has(r.id) && out.push({ role, libelle: r.libelle });
  check(config.champs.objet, ROLES.objet.nom);
  check(config.champs.montantDemande, ROLES.montantDemande.nom);
  const f = config.finances;
  if (f.millesime.source === "champ") check(f.millesime.ref, ROLES.millesime.nom);
  check(f.coutTotal, ROLES.coutTotal.nom);
  check(f.programmeSouhaite, ROLES.programmeSouhaite.nom);
  check(f.motifRepartition, ROLES.motifRepartition.nom);
  if (f.planFinancement) {
    const p = f.planFinancement;
    check(p.bloc, ROLES.planBloc.nom);
    check(p.financeur, ROLES.planFinanceur.nom);
    check(p.montant, ROLES.planMontant.nom);
    check(p.statut, ROLES.planStatut.nom);
    check(p.annee, ROLES.planAnnee.nom);
  }
  if (f.blocDecision) {
    const b = f.blocDecision;
    check(b.bloc, ROLES.decisionBloc.nom);
    check(b.regime, ROLES.decisionRegime.nom);
    check(b.montant, ROLES.decisionMontant.nom);
    check(b.statut, ROLES.decisionStatut.nom);
    check(b.assiette, ROLES.decisionAssiette.nom);
    check(b.referenceEngagement, ROLES.decisionReference.nom);
  }
  return out;
}
