// Fiche de paramétrage d'une démarche (docs/SPEC-multi-demarches.md § B). Pré-remplie par
// les propositions du serveur (avec leur raison) pour une démarche non déclarée, par la
// fiche enregistrée sinon. Rien n'est écrit avant « Enregistrer le paramétrage ».
import { useEffect, useId, useState } from "react";
import { Link, useParams } from "react-router";
import { useApi } from "../api.ts";
import { DEMARCHE_STATES, demarchePath } from "../board.ts";
import { formatDate } from "../format.tsx";

type ChampRef = { id: string; libelle: string };
type StatutDecision = "demande" | "propose" | "accorde";
type BlocDecision = {
  bloc: ChampRef; regime: ChampRef; montant: ChampRef; statut: ChampRef;
  assiette: ChampRef | null; referenceEngagement: ChampRef | null; statuts: Record<string, StatutDecision>;
};
type Regime = { financeurs: string[]; systemeEngagement: string | null };
type Plan = { bloc: ChampRef; financeur: ChampRef; montant: ChampRef; statut: ChampRef | null; annee: ChampRef | null; financeursPublics: string[] };
type Config = {
  libelle: string;
  mutations: boolean;
  annotations: boolean;
  delaiCibleJours: number;
  champs: { objet: ChampRef | null; montantDemande: ChampRef | null };
  finances: {
    millesime: { source: "anneeDepot" } | { source: "champ"; ref: ChampRef };
    coutTotal: ChampRef | null;
    planFinancement: Plan | null;
    programmeSouhaite: ChampRef | null;
    tauxMaxAidesPubliques: number | null;
    motifRepartition: ChampRef | null;
    blocDecision: BlocDecision | null;
    regimes: Record<string, Regime>;
  };
  valideLe?: string | null;
  ancienReglageLignes?: number;
};
type Descripteur = { id: string; libelle: string; type: string; source: "formulaire" | "annotation"; position: string; blocId?: string; options?: string[] };
type Role =
  | "objet" | "montantDemande" | "millesime" | "coutTotal" | "planBloc" | "planFinanceur" | "planMontant" | "planStatut" | "planAnnee"
  | "programmeSouhaite" | "motifRepartition"
  | "decisionBloc" | "decisionRegime" | "decisionMontant" | "decisionStatut" | "decisionAssiette" | "decisionReference";
type PlanRaisons = { bloc: string; financeur: string | null; montant: string | null; statut: string | null; annee: string | null; financeursPublics: string | null };
type DecisionRaisons = {
  bloc: string; regime: string | null; montant: string | null; statut: string | null; assiette: string | null; referenceEngagement: string | null;
  statuts: string | null; regimes: Record<string, string>;
};
type Proposition = {
  demarche: { number: number; title: string; state: string; datePublication: string | null; nbChamps: number; nbAnnotations: number; dnAdminUrl: string };
  mutationsGlobal: boolean;
  candidats: Record<Role, Descripteur[]>;
  proposition: Config;
  raisons: {
    objet: string; montantDemande: string; millesime: string; coutTotal: string; plan: PlanRaisons;
    programmeSouhaite: string; motifRepartition: string; decision: DecisionRaisons; sansBloc: string | null;
  };
  actuel: Config | null;
  introuvables: { role: string; libelle: string }[];
};

// État du formulaire : un champ est désigné par son identifiant ("" = aucun).
type Form = {
  libelle: string;
  delaiCibleJours: string;
  mutations: boolean;
  annotations: boolean;
  objet: string;
  montantDemande: string;
  millesime: string;
  coutTotal: string;
  planBloc: string;
  planFinanceur: string;
  planMontant: string;
  planStatut: string;
  planAnnee: string;
  financeursPublics: string[];
  programmeSouhaite: string;
  tauxMaxAidesPubliques: string;
  motifRepartition: string;
  decisionBloc: string;
  decisionRegime: string;
  decisionMontant: string;
  decisionStatut: string;
  decisionAssiette: string;
  decisionReference: string;
  // Option du statut → valeur générique ("" = aucune).
  statuts: Record<string, StatutDecision | "">;
  // Option du régime → financeurs et système d'engagement.
  regimes: Record<string, { financeurs: string[]; systemeEngagement: string }>;
};

const STATUTS_LIBELLES: Record<StatutDecision, string> = { demande: "Demandé", propose: "Proposé", accorde: "Accordé" };

const TYPES: Record<string, string> = {
  TextChampDescriptor: "texte court",
  TextareaChampDescriptor: "texte long",
  IntegerNumberChampDescriptor: "nombre entier",
  DecimalNumberChampDescriptor: "nombre décimal",
  NumberChampDescriptor: "nombre",
  DropDownListChampDescriptor: "liste déroulante",
  RepetitionChampDescriptor: "bloc répétable",
};

const id = (r: ChampRef | null | undefined) => r?.id ?? "";

function toForm(c: Config): Form {
  const plan = c.finances.planFinancement;
  const bd = c.finances.blocDecision;
  return {
    coutTotal: id(c.finances.coutTotal),
    planBloc: id(plan?.bloc),
    planFinanceur: id(plan?.financeur),
    planMontant: id(plan?.montant),
    planStatut: id(plan?.statut),
    planAnnee: id(plan?.annee),
    financeursPublics: plan?.financeursPublics ?? [],
    programmeSouhaite: id(c.finances.programmeSouhaite),
    tauxMaxAidesPubliques: c.finances.tauxMaxAidesPubliques === null ? "" : String(c.finances.tauxMaxAidesPubliques),
    motifRepartition: id(c.finances.motifRepartition),
    libelle: c.libelle,
    delaiCibleJours: String(c.delaiCibleJours),
    mutations: c.mutations,
    annotations: c.annotations ?? false,
    objet: id(c.champs.objet),
    montantDemande: id(c.champs.montantDemande),
    millesime: c.finances.millesime.source === "champ" ? c.finances.millesime.ref.id : "",
    decisionBloc: id(bd?.bloc),
    decisionRegime: id(bd?.regime),
    decisionMontant: id(bd?.montant),
    decisionStatut: id(bd?.statut),
    decisionAssiette: id(bd?.assiette),
    decisionReference: id(bd?.referenceEngagement),
    statuts: { ...(bd?.statuts ?? {}) },
    regimes: Object.fromEntries(
      Object.entries(c.finances.regimes ?? {}).map(([k, r]) => [k, { financeurs: r.financeurs, systemeEngagement: r.systemeEngagement ?? "" }]),
    ),
  };
}

// Le serveur ne reçoit que les identifiants ; il vérifie les types et reprend les libellés de DN.
// Montant des cartes : le sous-champ montant du plan de financement n'est pas permis (il
// additionnerait tous les financeurs) ; il vaut alors « calculé à partir du plan ».
const montantCartes = (f: Form) => (f.planBloc && f.montantDemande === f.planMontant ? "" : f.montantDemande);

function toBody(f: Form) {
  const ref = (v: string) => (v ? { id: v } : null);
  return {
    libelle: f.libelle,
    delaiCibleJours: Number(f.delaiCibleJours),
    mutations: f.mutations,
    annotations: f.annotations,
    champs: { objet: ref(f.objet), montantDemande: ref(montantCartes(f)) },
    finances: {
      millesime: f.millesime ? { source: "champ", ref: { id: f.millesime } } : { source: "anneeDepot" },
      coutTotal: ref(f.coutTotal),
      planFinancement: f.planBloc
        ? {
            bloc: { id: f.planBloc }, financeur: ref(f.planFinanceur), montant: ref(f.planMontant),
            statut: ref(f.planStatut), annee: ref(f.planAnnee), financeursPublics: f.financeursPublics,
          }
        : null,
      programmeSouhaite: ref(f.programmeSouhaite),
      tauxMaxAidesPubliques: f.tauxMaxAidesPubliques === "" ? null : Number(f.tauxMaxAidesPubliques),
      motifRepartition: ref(f.motifRepartition),
      blocDecision: f.decisionBloc
        ? {
            bloc: { id: f.decisionBloc }, regime: ref(f.decisionRegime), montant: ref(f.decisionMontant), statut: ref(f.decisionStatut),
            assiette: ref(f.decisionAssiette), referenceEngagement: ref(f.decisionReference),
            statuts: Object.fromEntries(Object.entries(f.statuts).filter(([, v]) => v)),
          }
        : null,
      // Le plan de financement retiré, les financeurs des régimes n'ont plus de sens.
      regimes: f.decisionBloc
        ? Object.fromEntries(
            Object.entries(f.regimes).map(([k, r]) => [k, { financeurs: f.planBloc ? r.financeurs : [], systemeEngagement: r.systemeEngagement.trim() || null }]),
          )
        : {},
    },
  };
}

// Libellés des champs de la fiche enregistrée, pour afficher un champ disparu de la révision.
function knownLabels(c: Config | null) {
  const out: Record<string, string> = {};
  const add = (r: ChampRef | null | undefined) => r && (out[r.id] = r.libelle);
  if (!c) return out;
  add(c.champs.objet);
  add(c.champs.montantDemande);
  if (c.finances.millesime.source === "champ") add(c.finances.millesime.ref);
  const p = c.finances.planFinancement;
  [c.finances.coutTotal, c.finances.programmeSouhaite, c.finances.motifRepartition, p?.bloc, p?.financeur, p?.montant, p?.statut, p?.annee].forEach(add);
  const b = c.finances.blocDecision;
  [b?.bloc, b?.regime, b?.montant, b?.statut, b?.assiette, b?.referenceEngagement].forEach(add);
  return out;
}

type SelectProps = {
  label: string;
  value: string;
  onChange: (v: string) => void;
  candidats: Descripteur[];
  aucun: string;
  known: Record<string, string>;
  // Proposition du serveur pour ce réglage : affichée avec sa raison.
  propose?: { id: string; raison: string };
  hint?: string;
  required?: boolean;
};

function ChampSelect({ label, value, onChange, candidats, aucun, known, propose, hint, required }: SelectProps) {
  const inputId = useId();
  const missing = value && !candidats.some((c) => c.id === value);
  const proposed = propose && candidats.find((c) => c.id === propose.id);
  return (
    <div className="field">
      <label htmlFor={inputId}>{label}</label>
      <select id={inputId} className="input" value={value} required={required} onChange={(e) => onChange(e.target.value)} aria-describedby={`${inputId}-hint`}>
        <option value="">{aucun}</option>
        {missing && <option value={value}>{known[value] ?? value} (introuvable dans la révision publiée)</option>}
        {candidats.map((c) => (
          <option key={c.id} value={c.id}>
            {c.libelle} — {TYPES[c.type] ?? c.type} · {c.source} n° {c.position}
          </option>
        ))}
      </select>
      <p id={`${inputId}-hint`} className="field__hint">
        {missing && <span className="field__bad">Ce champ n'existe plus dans la révision publiée : choisissez-en un autre. </span>}
        {propose && (propose.id === value
          ? <>Proposé : {propose.raison}.</>
          : <>Proposition : {proposed ? `« ${proposed.libelle} »` : aucun.toLowerCase()} ({propose.raison}).</>)}
        {hint && <> {hint}</>}
      </p>
    </div>
  );
}

export function Parametres() {
  const { numero } = useParams();
  const api = useApi<Proposition>(`/api/demarches/${numero}/proposition`);
  const p = api.data;
  const [form, setForm] = useState<Form | null>(null);
  const [saved, setSaved] = useState<Config | null>(null);
  const [created, setCreated] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (p) {
      setForm(toForm(p.actuel ?? p.proposition));
      setSaved(p.actuel);
    }
  }, [p]);

  const declaree = Boolean(saved);
  const known = knownLabels(p?.actuel ?? null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/demarches/${numero}/parametres`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toBody(form)),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `Erreur ${res.status}`);
      if (res.status === 201) setCreated(true);
      setSaved(body);
      setForm(toForm(body));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const set = (patch: Partial<Form>) => setForm((f) => (f ? { ...f, ...patch } : f));
  const proposeRef = (r: ChampRef | null | undefined, raison: string | undefined) => (raison ? { id: id(r), raison } : undefined);
  const pm = p?.proposition.finances.millesime;
  const pf = p?.proposition.finances ?? ({} as Partial<Config["finances"]>);
  // Sous-champs du bloc choisi pour le plan, et options de son sous-champ financeur.
  const enfants = (role: Role) => (p && form ? p.candidats[role].filter((c) => c.blocId === form.planBloc) : []);
  const optionsFinanceur = (p && form && p.candidats.planFinanceur.find((c) => c.id === form.planFinanceur)?.options) || [];
  const planPropose = (k: "financeur" | "montant" | "statut" | "annee") => {
    const raison = p?.raisons.plan[k];
    return raison && pf.planFinancement?.bloc.id === form?.planBloc ? { id: id(pf.planFinancement?.[k]), raison } : undefined;
  };
  // Bloc de décision : sous-champs du bloc choisi, options du statut et du régime.
  const enfantsD = (role: Role) => (p && form ? p.candidats[role].filter((c) => c.blocId === form.decisionBloc) : []);
  const optionsDe = (role: Role, champ: string) => (p && champ && p.candidats[role].find((c) => c.id === champ)?.options) || [];
  const optionsStatut = form ? optionsDe("decisionStatut", form.decisionStatut) : [];
  const optionsRegime = form ? optionsDe("decisionRegime", form.decisionRegime) : [];
  const decisionPropose = (k: "regime" | "montant" | "statut" | "assiette" | "referenceEngagement") => {
    const raison = p?.raisons.decision[k];
    return raison && pf.blocDecision?.bloc.id === form?.decisionBloc ? { id: id(pf.blocDecision?.[k]), raison } : undefined;
  };
  // Proposition pour les valeurs d'une liste qui vient de changer (statut, régime).
  const statutsProposes = (champ: string) =>
    pf.blocDecision?.statut.id === champ ? { ...pf.blocDecision.statuts } : {};
  const regimesProposes = (champ: string) =>
    pf.blocDecision?.regime.id === champ
      ? Object.fromEntries(Object.entries(pf.regimes ?? {}).map(([k, r]) => [k, { financeurs: r.financeurs, systemeEngagement: "" }]))
      : {};
  const setRegime = (option: string, patch: Partial<{ financeurs: string[]; systemeEngagement: string }>) =>
    setForm((f) => {
      if (!f) return f;
      const actuel = f.regimes[option] ?? { financeurs: [], systemeEngagement: "" };
      return { ...f, regimes: { ...f.regimes, [option]: { ...actuel, ...patch } } };
    });

  return (
    <main className="page">
      <Link to={declaree ? demarchePath(numero!) : "/"} className="back">
        {declaree ? "← Retour au kanban" : "← Toutes les démarches"}
      </Link>
      <h1>{declaree ? "Paramètres de la démarche" : "Nouvelle démarche"} n° {numero}</h1>
      {api.error && <p className="dialog__error" role="alert">Démarche Numérique a répondu : {api.error}</p>}
      {api.loading && !p && <p className="muted" role="status">Lecture de la démarche sur DN…</p>}

      {p && form && (
        <form className="settings" onSubmit={save}>
          {!declaree && (
            <p className="notice notice--info">
              Fiche pré-remplie d'après les champs de la démarche : vérifiez chaque proposition.
              La démarche ne sera ajoutée au back office qu'à l'enregistrement.
            </p>
          )}
          {p.introuvables.length > 0 && (
            <p className="notice notice--warn" role="alert">
              Champ introuvable dans la révision publiée : {p.introuvables.map((c) => `${c.role} (« ${c.libelle} »)`).join(", ")}.
              Les calculs concernés sont suspendus jusqu'à la correction du paramétrage.
            </p>
          )}

          <section className="settings__section" aria-labelledby="s-demarche">
            <h2 id="s-demarche">1. Démarche</h2>
            <dl className="fields">
              <dt>Titre sur DN</dt><dd>{p.demarche.title}</dd>
              <dt>État</dt><dd>{DEMARCHE_STATES[p.demarche.state] ?? p.demarche.state}</dd>
              <dt>Révision publiée le</dt><dd>{p.demarche.datePublication ? formatDate(p.demarche.datePublication) : "—"}</dd>
              <dt>Contenu</dt><dd>{p.demarche.nbChamps} champs, {p.demarche.nbAnnotations} annotations privées</dd>
            </dl>
            <div className="field">
              <label htmlFor="libelle">Libellé court</label>
              <input id="libelle" className="input" required maxLength={120} value={form.libelle} onChange={(e) => set({ libelle: e.target.value })} />
            </div>
          </section>

          <section className="settings__section" aria-labelledby="s-cartes">
            <h2 id="s-cartes">2. Affichage des cartes</h2>
            <ChampSelect label="Objet" value={form.objet} onChange={(v) => set({ objet: v })} candidats={p.candidats.objet} aucun="Aucun" known={known}
              propose={proposeRef(p.proposition.champs.objet, p.raisons.objet)} />
            <ChampSelect label="Montant demandé" value={montantCartes(form)} onChange={(v) => set({ montantDemande: v })}
              candidats={p.candidats.montantDemande.filter((c) => c.id !== form.planMontant)} aucun={form.planBloc ? "Calculé à partir du plan de financement" : "Aucun"} known={known}
              propose={proposeRef(p.proposition.champs.montantDemande, p.raisons.montantDemande)}
              hint={form.planBloc
                ? "Avec un plan de financement, laissez « calculé » : la carte affiche la somme du plan pour les financeurs des lignes."
                : "Un champ d'un bloc répétable vaut la somme de ses lignes."} />
            <div className="field">
              <label htmlFor="delai">Délai cible (jours)</label>
              <input id="delai" className="input input--short" type="number" min={1} max={3650} required value={form.delaiCibleJours} onChange={(e) => set({ delaiCibleJours: e.target.value })} />
            </div>
          </section>

          <section className="settings__section" aria-labelledby="s-finances">
            <h2 id="s-finances">3. Données financières</h2>
            <ChampSelect label="Millésime" value={form.millesime} onChange={(v) => set({ millesime: v })} candidats={p.candidats.millesime}
              aucun="Année de dépôt du dossier" known={known}
              propose={{ id: pm?.source === "champ" ? pm.ref.id : "", raison: p.raisons.millesime }} />
            <p className={form.millesime ? "muted" : "notice notice--info"}>
              {form.millesime
                ? "Source du millésime : le champ désigné ci-dessus."
                : "Source du millésime : année de dépôt du dossier, aucun champ désigné. Chaque enveloppe comptera les dossiers dont le millésime est ainsi déduit."}
            </p>

            <ChampSelect label="Coût total" value={form.coutTotal} onChange={(v) => set({ coutTotal: v })} candidats={p.candidats.coutTotal} aucun="Aucun" known={known}
              propose={proposeRef(pf.coutTotal, p.raisons.coutTotal)} hint="Base de la part du coût total et des taux d'aide publique." />

            <fieldset className="ligne">
              <legend>Plan de financement</legend>
              <ChampSelect label="Bloc répétable du plan" value={form.planBloc}
                onChange={(v) => set({
                  planBloc: v, planFinanceur: "", planMontant: "", planStatut: "", planAnnee: "", financeursPublics: [],
                  regimes: Object.fromEntries(Object.entries(form.regimes).map(([k, r]) => [k, { ...r, financeurs: [] }])),
                })}
                candidats={p.candidats.planBloc} aucun="Aucun plan de financement" known={known}
                propose={proposeRef(pf.planFinancement?.bloc, p.raisons.plan.bloc)}
                hint="Bloc du formulaire avec au moins une liste (financeur) et un nombre (montant)." />
              {form.planBloc && (
                <>
                  <ChampSelect label="Financeur" required value={form.planFinanceur} onChange={(v) => set({ planFinanceur: v, financeursPublics: [] })}
                    candidats={enfants("planFinanceur")} aucun="À choisir" known={known} propose={planPropose("financeur")} />
                  <ChampSelect label="Montant" required value={form.planMontant} onChange={(v) => set({ planMontant: v })}
                    candidats={enfants("planMontant")} aucun="À choisir" known={known} propose={planPropose("montant")} />
                  <ChampSelect label="Statut (facultatif)" value={form.planStatut} onChange={(v) => set({ planStatut: v })}
                    candidats={enfants("planStatut").filter((c) => c.id !== form.planFinanceur)} aucun="Aucun" known={known} propose={planPropose("statut")}
                    hint="Sert au taux « dont aides obtenues » (statut commençant par « obtenu »)." />
                  <ChampSelect label="Année (facultatif)" value={form.planAnnee} onChange={(v) => set({ planAnnee: v })}
                    candidats={enfants("planAnnee").filter((c) => c.id !== form.planFinanceur)} aucun="Aucune" known={known} propose={planPropose("annee")}
                    hint="Prise en compte plus tard (C4), pour imputer chaque ligne du plan sur le millésime de son année." />
                  {optionsFinanceur.length > 0 && (
                    <fieldset className="field">
                      <legend className="field__label">Financeurs publics</legend>
                      <div className="choices">
                        {optionsFinanceur.map((o) => (
                          <label key={o}>
                            <input type="checkbox" checked={form.financeursPublics.includes(o)}
                              onChange={() => set({ financeursPublics: form.financeursPublics.includes(o) ? form.financeursPublics.filter((x) => x !== o) : [...form.financeursPublics, o] })} />
                            {o}
                          </label>
                        ))}
                      </div>
                      {p.raisons.plan.financeursPublics && <p className="field__hint">Proposés : {p.raisons.plan.financeursPublics}.</p>}
                    </fieldset>
                  )}
                </>
              )}
            </fieldset>

            <ChampSelect label="Programme souhaité" value={form.programmeSouhaite} onChange={(v) => set({ programmeSouhaite: v })} candidats={p.candidats.programmeSouhaite}
              aucun="Aucun" known={known} propose={proposeRef(pf.programmeSouhaite, p.raisons.programmeSouhaite)}
              hint="Liste du formulaire, une valeur par dossier. Départage les régimes d'un même financeur (ex. « État » pour DETR et DSIL) : ses options doivent correspondre à celles du régime d'aide." />
            <div className="field">
              <label htmlFor="tauxmax">Taux maximal des aides publiques (%)</label>
              <input id="tauxmax" className="input input--short" type="number" min={0} max={100} step="any" placeholder="facultatif"
                value={form.tauxMaxAidesPubliques} onChange={(e) => set({ tauxMaxAidesPubliques: e.target.value })} aria-describedby="tauxmax-hint" />
              <p id="tauxmax-hint" className="field__hint">Plafond du cumul des aides publiques. Au-delà, le dossier est signalé (anomalie non bloquante).</p>
            </div>
            <ChampSelect label="Motif de répartition" value={form.motifRepartition} onChange={(v) => set({ motifRepartition: v })} candidats={p.candidats.motifRepartition}
              aucun="Aucun" known={known} propose={proposeRef(pf.motifRepartition, p.raisons.motifRepartition)}
              hint="Annotation affichée dans l'onglet Demande de la fiche dossier, sous les lignes de financement." />

            {p.actuel?.ancienReglageLignes && (
              <p className="notice notice--warn">
                L'ancien réglage « lignes de financement » ({p.actuel.ancienReglageLignes} ligne{p.actuel.ancienReglageLignes > 1 ? "s" : ""}) n'est plus utilisé :
                désignez le bloc de décision ci-dessous. Il disparaîtra du fichier au prochain enregistrement.
              </p>
            )}

            <fieldset className="ligne">
              <legend>Bloc de décision</legend>
              {p.raisons.sansBloc && (
                <p className="notice notice--warn">
                  {p.raisons.sansBloc}. Créez-en un dans l'éditeur de la démarche sur DN (régime d'aide, montant, statut), puis actualisez cette
                  page. <a href={p.demarche.dnAdminUrl} target="_blank" rel="noreferrer">Ouvrir la démarche sur DN</a>
                </p>
              )}
              <ChampSelect label="Bloc répétable d'annotations" value={form.decisionBloc}
                onChange={(v) => set({
                  decisionBloc: v, decisionRegime: "", decisionMontant: "", decisionStatut: "", decisionAssiette: "", decisionReference: "",
                  statuts: {}, regimes: {},
                })}
                candidats={p.candidats.decisionBloc} aucun="Aucun bloc de décision" known={known}
                propose={proposeRef(pf.blocDecision?.bloc, p.raisons.decision.bloc)}
                hint="Annotations privées, une ligne par régime d'aide : c'est la seule source du montant accordé." />
              {form.decisionBloc && (
                <>
                  <ChampSelect label="Régime d'aide" required value={form.decisionRegime}
                    onChange={(v) => set({ decisionRegime: v, regimes: regimesProposes(v) })}
                    candidats={enfantsD("decisionRegime").filter((c) => c.id !== form.decisionStatut)} aucun="À choisir" known={known}
                    propose={decisionPropose("regime")} hint="Le programme de la ligne ; ses options sont la liste fermée des programmes d'enveloppe." />
                  <ChampSelect label="Montant" required value={form.decisionMontant} onChange={(v) => set({ decisionMontant: v })}
                    candidats={enfantsD("decisionMontant")} aucun="À choisir" known={known} propose={decisionPropose("montant")}
                    hint="Montant accordé de la ligne, base du calcul de l'enveloppe." />
                  <ChampSelect label="Statut" required value={form.decisionStatut}
                    onChange={(v) => set({ decisionStatut: v, statuts: statutsProposes(v) })}
                    candidats={enfantsD("decisionStatut").filter((c) => c.id !== form.decisionRegime)} aucun="À choisir" known={known}
                    propose={decisionPropose("statut")} />
                  <ChampSelect label="Assiette (facultatif)" value={form.decisionAssiette} onChange={(v) => set({ decisionAssiette: v })}
                    candidats={enfantsD("decisionAssiette").filter((c) => c.id !== form.decisionMontant)} aucun="Aucune" known={known}
                    propose={decisionPropose("assiette")} hint="Taux de la ligne = montant ÷ assiette." />
                  <ChampSelect label="Référence d'engagement (facultatif)" value={form.decisionReference} onChange={(v) => set({ decisionReference: v })}
                    candidats={enfantsD("decisionReference")} aucun="Aucune" known={known} propose={decisionPropose("referenceEngagement")}
                    hint="Texte libre. La part de l'accepté qui porte une référence est comptée comme « engagée »." />

                  {optionsStatut.length > 0 && (
                    <fieldset className="field">
                      <legend className="field__label">Valeurs de statut</legend>
                      <div className="table-wrap">
                        <table className="table">
                          <thead><tr><th>Option dans DN</th><th>Valeur générique</th></tr></thead>
                          <tbody>
                            {optionsStatut.map((o) => (
                              <tr key={o}>
                                <td>{o}</td>
                                <td>
                                  <select className="input" aria-label={`Valeur générique de « ${o} »`} value={form.statuts[o] ?? ""}
                                    onChange={(e) => set({ statuts: { ...form.statuts, [o]: e.target.value as StatutDecision | "" } })}>
                                    <option value="">Aucune (anomalie si saisie)</option>
                                    {(Object.keys(STATUTS_LIBELLES) as StatutDecision[]).map((v) => <option key={v} value={v}>{STATUTS_LIBELLES[v]}</option>)}
                                  </select>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      {p.raisons.decision.statuts && <p className="field__hint">Proposées : {p.raisons.decision.statuts}.</p>}
                    </fieldset>
                  )}

                  {optionsRegime.length > 0 && (
                    <fieldset className="field">
                      <legend className="field__label">Table des régimes</legend>
                      <p className="field__hint">
                        Financeurs : le montant demandé du plan pour ces financeurs va à ce régime (au régime du programme souhaité s'il y en a plusieurs).
                        Système d'engagement : texte libre (Chorus, Osiris, logiciel de la collectivité…), affiché seulement pour l'instant.
                      </p>
                      <div className="table-wrap">
                        <table className="table">
                          <thead><tr><th>Régime</th><th>Financeurs</th><th>Système d'engagement</th></tr></thead>
                          <tbody>
                            {optionsRegime.map((o) => {
                              const r = form.regimes[o] ?? { financeurs: [], systemeEngagement: "" };
                              const raison = p.raisons.decision.regimes[o];
                              return (
                                <tr key={o}>
                                  <td>{o}</td>
                                  <td>
                                    {form.planBloc && optionsFinanceur.length > 0 ? (
                                      <div className="choices">
                                        {optionsFinanceur.map((fo) => (
                                          <label key={fo}>
                                            <input type="checkbox" checked={r.financeurs.includes(fo)}
                                              onChange={() => setRegime(o, { financeurs: r.financeurs.includes(fo) ? r.financeurs.filter((x) => x !== fo) : [...r.financeurs, fo] })} />
                                            {fo}
                                          </label>
                                        ))}
                                      </div>
                                    ) : <span className="muted">Aucun plan de financement</span>}
                                    {raison && pf.blocDecision?.regime.id === form.decisionRegime && <p className="field__hint">Proposé : {raison}.</p>}
                                  </td>
                                  <td>
                                    <input className="input" maxLength={80} aria-label={`Système d'engagement de « ${o} »`} placeholder="facultatif"
                                      value={r.systemeEngagement} onChange={(e) => setRegime(o, { systemeEngagement: e.target.value })} />
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </fieldset>
                  )}
                </>
              )}
            </fieldset>

            <h3>Enveloppes alimentées</h3>
            <p className="field__hint">
              Une enveloppe (libellé, millésime, montant) se crée à part : elle peut être alimentée par plusieurs démarches.{" "}
              {declaree
                ? <Link to={`/enveloppes?nouvelle=${numero}`}>Créer une enveloppe alimentée par cette démarche</Link>
                : "Enregistrez d'abord cette fiche pour pouvoir créer une enveloppe."}{" "}
              {declaree && <>· <Link to="/enveloppes">Toutes les enveloppes</Link></>}
            </p>
          </section>

          <section className="settings__section" aria-labelledby="s-mutations">
            <h2 id="s-mutations">4. Changements d'état et saisie</h2>
            <label className="check">
              <input type="checkbox" checked={form.mutations} onChange={(e) => set({ mutations: e.target.checked })} />
              Autoriser les changements d'état sur cette démarche
            </label>
            <label className="check">
              <input type="checkbox" checked={form.annotations} disabled={!form.decisionBloc && !form.annotations}
                onChange={(e) => set({ annotations: e.target.checked })} aria-describedby="annotations-hint" />
              Autoriser la saisie du bloc de décision depuis le back office
            </label>
            <p id="annotations-hint" className="field__hint">
              Seuls les sous-champs du bloc de décision (régime, montant, statut, assiette, référence d'engagement) sont modifiables, et
              une ligne peut être ajoutée. Chaque écriture est confirmée, avec ancienne et nouvelle valeur, et journalisée.
              {!form.decisionBloc && " Désignez d'abord un bloc de décision."}
            </p>
            <p className="field__hint">
              Ces deux écritures demandent aussi <code>DN_ENABLE_MUTATIONS=1</code> sur le serveur
              {p.mutationsGlobal ? " (actif actuellement)." : " (inactif actuellement : aucun changement d'état n'est possible)."}
            </p>
          </section>

          {error && <p className="dialog__error" role="alert">{error}</p>}
          <div className="settings__actions">
            <button type="submit" className="btn btn--primary" disabled={busy}>{busy ? "Enregistrement…" : "Enregistrer le paramétrage"}</button>
            <span role="status">
              {saved?.valideLe ? `Paramétrage validé le ${formatDate(saved.valideLe)}` : declaree ? "Paramétrage pas encore validé (réglages par défaut)" : "Rien n'est enregistré pour l'instant"}
              {created && <> · <Link to={demarchePath(numero!)}>Ouvrir le kanban</Link></>}
            </span>
          </div>
        </form>
      )}
    </main>
  );
}
