// Fiche de paramétrage (docs/SPEC-multi-demarches.md § B) : champs candidats pour chaque
// rôle, propositions automatiques avec leur raison, contrôle des champs désignés.
import type { ChampRef, DemarcheConfig, LigneFinancement, Programme } from "./config.ts";

// Champ ou annotation de la révision publiée, aplati. Les champs d'un bloc répétable
// gardent le nom du bloc ; leurs valeurs s'additionnent ligne à ligne.
export type Descripteur = {
  id: string;
  libelle: string;
  type: string;
  source: "formulaire" | "annotation";
  position: string;
  bloc?: string;
  options?: string[];
};

const STRUCTURE = new Set(["HeaderSectionChampDescriptor", "ExplicationChampDescriptor"]);
const NOMBRE = new Set(["IntegerNumberChampDescriptor", "DecimalNumberChampDescriptor", "NumberChampDescriptor"]);
const TEXTE = new Set(["TextChampDescriptor", "TextareaChampDescriptor"]);
const LISTE = "DropDownListChampDescriptor";
const EJ = "EngagementJuridiqueChampDescriptor";
// Une liste déroulante ne peut servir de millésime que si toutes ses options sont des années.
const listeAnnees = (d: Descripteur) => d.type === LISTE && Boolean(d.options?.length) && d.options!.every((o) => /^\s*(19|20)\d\d\s*$/.test(o));

export function descripteurs(revision: any): Descripteur[] {
  const out: Descripteur[] = [];
  for (const [source, list] of [["formulaire", revision.champDescriptors], ["annotation", revision.annotationDescriptors]] as const) {
    let pos = 0;
    for (const d of list ?? []) {
      if (STRUCTURE.has(d.__typename)) continue;
      pos++;
      out.push({ id: d.id, libelle: d.label, type: d.__typename, source, position: `${pos}`, ...(d.options && { options: d.options }) });
      if (d.__typename !== "RepetitionChampDescriptor") continue;
      let k = 0;
      for (const c of d.champDescriptors ?? []) {
        if (STRUCTURE.has(c.__typename)) continue;
        k++;
        out.push({ id: c.id, libelle: `${d.label} › ${c.label}`, type: c.__typename, source, position: `${pos}.${k}`, bloc: d.label });
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
  assiette: {
    nom: "Assiette éligible",
    accepte: (d) => NOMBRE.has(d.type),
    mots: ["coût", "assiette", "éligible", "total", "HT"],
  },
  montantAccorde: {
    nom: "Montant accordé",
    accepte: (d) => d.source === "annotation" && !d.bloc && NOMBRE.has(d.type),
    mots: ["accordé", "attribué", "montant"],
  },
  taux: {
    nom: "Taux",
    accepte: (d) => d.source === "annotation" && !d.bloc && NOMBRE.has(d.type),
    mots: ["taux", "%"],
  },
  programme: {
    nom: "Programme",
    accepte: (d) => !d.bloc && d.type === LISTE,
    mots: ["dotation", "programme", "dispositif", "fonds"],
  },
  millesime: {
    nom: "Millésime",
    accepte: (d) => !d.bloc && (d.type === "IntegerNumberChampDescriptor" || listeAnnees(d)),
    mots: ["année", "millésime", "exercice"],
  },
  numeroEJ: {
    nom: "N° d'engagement juridique",
    accepte: (d) => !d.bloc && (d.type === EJ || (d.source === "annotation" && d.type === "TextChampDescriptor")),
    mots: ["engagement", "EJ", "Chorus"],
  },
} satisfies Record<string, RoleDef>;

export type Role = keyof typeof ROLES;

const normalize = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const tokens = (s: string) => normalize(s).replace(/([€%])/g, " $1 ").split(/[^a-z0-9€%]+/).filter(Boolean);

// Mot-clé reconnu au début d'un mot du libellé ; les mots courts (HT, EJ, €, %) doivent être exacts.
function contient(libelle: string, mot: string) {
  const m = normalize(mot);
  return tokens(libelle).some((t) => (m.length <= 2 ? t === m : t.startsWith(m)));
}

type Choix = { ref: ChampRef | null; raison: string };
const ref = (d: Descripteur): ChampRef => ({ id: d.id, libelle: d.libelle });

function proposer(candidats: Descripteur[], mots: string[], repli: { seul?: string; premier?: string; aucun?: string } = {}): Choix {
  for (const mot of mots) {
    const d = candidats.find((c) => contient(c.libelle, mot));
    if (d) return { ref: ref(d), raison: `libellé contenant « ${mot} »` };
  }
  if (repli.seul && candidats.length === 1) return { ref: ref(candidats[0]), raison: repli.seul };
  if (repli.premier && candidats.length) return { ref: ref(candidats[0]), raison: repli.premier };
  if (repli.aucun) return { ref: null, raison: repli.aucun };
  return { ref: null, raison: candidats.length ? "aucun libellé reconnu : à choisir" : "aucun champ de ce type" };
}

const MOTS_VIDES = new Set(["de", "du", "la", "le", "les", "des", "au", "aux", "en", "et", "pour", "sur"]);

// Avec plusieurs lignes, un champ est proposé pour une ligne s'il partage avec son montant
// accordé un mot distinctif (ex. « DSIL » dans « Montant accordé DSIL » et « Taux DSIL »).
function proposerPourLigne(candidats: Descripteur[], role: Role, accorde: ChampRef): Choix {
  const generiques = new Set(ROLES.montantAccorde.mots.map(normalize));
  const distinctifs = tokens(accorde.libelle).filter((t) => t.length >= 2 && !MOTS_VIDES.has(t) && ![...generiques].some((g) => t.startsWith(g)));
  for (const mot of ROLES[role].mots) {
    for (const t of distinctifs) {
      const d = candidats.find((c) => contient(c.libelle, mot) && tokens(c.libelle).includes(t));
      if (d) return { ref: ref(d), raison: `libellé contenant « ${mot} » et « ${t.toUpperCase()} », comme le montant accordé` };
    }
  }
  return { ref: null, raison: "à choisir pour cette ligne" };
}

// Titre DN tronqué à 120 caractères, sur une fin de mot.
function libelleCourt(title: string) {
  if (title.length <= 120) return title;
  const cut = title.slice(0, 119);
  return `${cut.slice(0, cut.lastIndexOf(" ") > 60 ? cut.lastIndexOf(" ") : 119)}…`;
}

type RaisonsLigne = Record<"programme" | "montantDemande" | "assiette" | "montantAccorde" | "taux" | "numeroEJ", string>;

export function proposition(demarche: any) {
  const all = descripteurs(demarche.activeRevision);
  const candidats = Object.fromEntries(
    (Object.keys(ROLES) as Role[]).map((r) => [r, all.filter(ROLES[r].accepte)]),
  ) as Record<Role, Descripteur[]>;

  const objet = proposer(candidats.objet, ROLES.objet.mots, { premier: "premier champ texte du formulaire" });
  const montantDemande = proposer(candidats.montantDemande, ROLES.montantDemande.mots, { seul: "seul champ nombre du formulaire" });
  const millesime = proposer(candidats.millesime, ROLES.millesime.mots, {
    aucun: "aucun champ « année », « millésime » ou « exercice » : année de dépôt",
  });

  // Une ligne par annotation « montant accordé » : d'abord « accordé » ou « attribué »,
  // sinon « montant », sinon la seule annotation nombre.
  const accordes = candidats.montantAccorde;
  let lignesAccorde = accordes.filter((c) => contient(c.libelle, "accordé") || contient(c.libelle, "attribué"));
  let raisonAccorde = "libellé contenant « accordé » ou « attribué »";
  if (!lignesAccorde.length) {
    lignesAccorde = accordes.filter((c) => contient(c.libelle, "montant"));
    raisonAccorde = "libellé contenant « montant »";
  }
  if (!lignesAccorde.length && accordes.length === 1) {
    lignesAccorde = accordes;
    raisonAccorde = "seule annotation privée nombre";
  }

  const plusieurs = lignesAccorde.length > 1;
  const lignes: LigneFinancement[] = [];
  const raisonsLignes: RaisonsLigne[] = [];
  for (const d of lignesAccorde) {
    const accorde = ref(d);
    const pick = (role: Role, repli?: Parameters<typeof proposer>[2]) =>
      plusieurs ? proposerPourLigne(candidats[role], role, accorde) : proposer(candidats[role], ROLES[role].mots, repli);
    const programme = plusieurs ? null : proposer(candidats.programme, ROLES.programme.mots);
    const dem = plusieurs ? pick("montantDemande") : { ref: null, raison: "celui des cartes (une seule ligne)" };
    const assiette = pick("assiette");
    const taux = pick("taux", { aucun: "aucune annotation « taux » : taux calculé (accordé ÷ assiette)" });
    const ej = pick("numeroEJ");
    lignes.push({
      programme: programme?.ref ? { source: "champ", ref: programme.ref } : null,
      montantDemande: dem.ref,
      assiette: assiette.ref,
      montantAccorde: accorde,
      taux: taux.ref,
      tauxMax: null,
      numeroEJ: ej.ref,
    });
    raisonsLignes.push({
      programme: programme ? programme.raison : "à renseigner : plusieurs lignes",
      montantDemande: dem.raison,
      assiette: assiette.raison,
      montantAccorde: raisonAccorde,
      taux: taux.raison,
      numeroEJ: ej.raison,
    });
  }

  return {
    candidats,
    proposition: {
      libelle: libelleCourt(demarche.title),
      mutations: false,
      delaiCibleJours: 45,
      champs: { objet: objet.ref, montantDemande: montantDemande.ref },
      finances: {
        millesime: millesime.ref ? { source: "champ" as const, ref: millesime.ref } : { source: "anneeDepot" as const },
        lignes,
      },
    },
    raisons: {
      objet: objet.raison,
      montantDemande: montantDemande.raison,
      millesime: millesime.raison,
      lignes: raisonsLignes,
      sansLigne: accordes.length ? null : "Aucune annotation privée de type nombre dans cette démarche",
    },
  };
}

// Champs désignés qui n'existent plus dans la révision publiée : la fiche et le kanban
// l'affichent, et les calculs concernés sont suspendus (§ B).
export function introuvables(config: DemarcheConfig, revision: any) {
  const ids = new Set(descripteurs(revision).map((d) => d.id));
  const out: { role: string; libelle: string }[] = [];
  const check = (r: ChampRef | null | undefined, role: string) => r && !ids.has(r.id) && out.push({ role, libelle: r.libelle });
  const checkProgramme = (p: Programme, role: string) => p?.source === "champ" && check(p.ref, role);
  check(config.champs.objet, ROLES.objet.nom);
  check(config.champs.montantDemande, ROLES.montantDemande.nom);
  if (config.finances.millesime.source === "champ") check(config.finances.millesime.ref, ROLES.millesime.nom);
  config.finances.lignes.forEach((l, i) => {
    const suffix = config.finances.lignes.length > 1 ? ` (ligne ${i + 1})` : "";
    checkProgramme(l.programme, ROLES.programme.nom + suffix);
    for (const role of ["montantDemande", "assiette", "montantAccorde", "taux", "numeroEJ"] as const) check(l[role], ROLES[role].nom + suffix);
  });
  return out;
}
