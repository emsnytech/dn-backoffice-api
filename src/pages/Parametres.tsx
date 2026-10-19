// Fiche de paramétrage d'une démarche (docs/SPEC-multi-demarches.md § B). Pré-remplie par
// les propositions du serveur (avec leur raison) pour une démarche non déclarée, par la
// fiche enregistrée sinon. Rien n'est écrit avant « Enregistrer le paramétrage ».
import { useEffect, useId, useState } from "react";
import { Link, useParams } from "react-router";
import { useApi } from "../api.ts";
import { DEMARCHE_STATES, demarchePath } from "../board.ts";
import { formatDate } from "../format.tsx";

type ChampRef = { id: string; libelle: string };
type Programme = { source: "fixe"; valeur: string } | { source: "champ"; ref: ChampRef } | null;
type Ligne = {
  programme: Programme;
  montantDemande: ChampRef | null;
  assiette: ChampRef | null;
  montantAccorde: ChampRef;
  taux: ChampRef | null;
  tauxMax: number | null;
  numeroEJ: ChampRef | null;
};
type Config = {
  libelle: string;
  mutations: boolean;
  delaiCibleJours: number;
  champs: { objet: ChampRef | null; montantDemande: ChampRef | null };
  finances: { millesime: { source: "anneeDepot" } | { source: "champ"; ref: ChampRef }; lignes: Ligne[] };
  valideLe?: string | null;
};
type Descripteur = { id: string; libelle: string; type: string; source: "formulaire" | "annotation"; position: string };
type Role = "objet" | "montantDemande" | "assiette" | "montantAccorde" | "taux" | "programme" | "millesime" | "numeroEJ";
type LigneRole = "programme" | "montantDemande" | "assiette" | "montantAccorde" | "taux" | "numeroEJ";
type Proposition = {
  demarche: { number: number; title: string; state: string; datePublication: string | null; nbChamps: number; nbAnnotations: number; dnAdminUrl: string };
  mutationsGlobal: boolean;
  candidats: Record<Role, Descripteur[]>;
  proposition: Config;
  raisons: { objet: string; montantDemande: string; millesime: string; lignes: Record<LigneRole, string>[]; sansLigne: string | null };
  actuel: Config | null;
  introuvables: { role: string; libelle: string }[];
};

// État du formulaire : un champ est désigné par son identifiant ("" = aucun).
type FormLigne = {
  programmeSource: "aucun" | "fixe" | "champ";
  programmeValeur: string;
  programmeChamp: string;
  montantDemande: string;
  assiette: string;
  montantAccorde: string;
  taux: string;
  tauxMax: string;
  numeroEJ: string;
};
type Form = {
  libelle: string;
  delaiCibleJours: string;
  mutations: boolean;
  objet: string;
  montantDemande: string;
  millesime: string;
  lignes: FormLigne[];
};

const TYPES: Record<string, string> = {
  TextChampDescriptor: "texte court",
  TextareaChampDescriptor: "texte long",
  IntegerNumberChampDescriptor: "nombre entier",
  DecimalNumberChampDescriptor: "nombre décimal",
  NumberChampDescriptor: "nombre",
  DropDownListChampDescriptor: "liste déroulante",
  EngagementJuridiqueChampDescriptor: "engagement juridique",
};

const id = (r: ChampRef | null | undefined) => r?.id ?? "";

const emptyLigne = (): FormLigne => ({
  programmeSource: "aucun", programmeValeur: "", programmeChamp: "",
  montantDemande: "", assiette: "", montantAccorde: "", taux: "", tauxMax: "", numeroEJ: "",
});

function toForm(c: Config): Form {
  return {
    libelle: c.libelle,
    delaiCibleJours: String(c.delaiCibleJours),
    mutations: c.mutations,
    objet: id(c.champs.objet),
    montantDemande: id(c.champs.montantDemande),
    millesime: c.finances.millesime.source === "champ" ? c.finances.millesime.ref.id : "",
    lignes: c.finances.lignes.map((l) => ({
      programmeSource: l.programme ? l.programme.source : "aucun",
      programmeValeur: l.programme?.source === "fixe" ? l.programme.valeur : "",
      programmeChamp: l.programme?.source === "champ" ? l.programme.ref.id : "",
      montantDemande: id(l.montantDemande),
      assiette: id(l.assiette),
      montantAccorde: l.montantAccorde.id,
      taux: id(l.taux),
      tauxMax: l.tauxMax === null ? "" : String(l.tauxMax),
      numeroEJ: id(l.numeroEJ),
    })),
  };
}

// Le serveur ne reçoit que les identifiants ; il vérifie les types et reprend les libellés de DN.
function toBody(f: Form) {
  const ref = (v: string) => (v ? { id: v } : null);
  return {
    libelle: f.libelle,
    delaiCibleJours: Number(f.delaiCibleJours),
    mutations: f.mutations,
    champs: { objet: ref(f.objet), montantDemande: ref(f.montantDemande) },
    finances: {
      millesime: f.millesime ? { source: "champ", ref: { id: f.millesime } } : { source: "anneeDepot" },
      lignes: f.lignes.map((l) => ({
        programme:
          l.programmeSource === "fixe" ? { source: "fixe", valeur: l.programmeValeur }
          : l.programmeSource === "champ" ? (l.programmeChamp ? { source: "champ", ref: { id: l.programmeChamp } } : null)
          : null,
        montantDemande: ref(l.montantDemande),
        assiette: ref(l.assiette),
        montantAccorde: ref(l.montantAccorde),
        taux: ref(l.taux),
        tauxMax: l.tauxMax === "" ? null : Number(l.tauxMax),
        numeroEJ: ref(l.numeroEJ),
      })),
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
  for (const l of c.finances.lignes) {
    if (l.programme?.source === "champ") add(l.programme.ref);
    [l.montantDemande, l.assiette, l.montantAccorde, l.taux, l.numeroEJ].forEach(add);
  }
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
  const setLigne = (i: number, patch: Partial<FormLigne>) =>
    setForm((f) => (f ? { ...f, lignes: f.lignes.map((l, j) => (j === i ? { ...l, ...patch } : l)) } : f));

  // Raisons des propositions de ligne, retrouvées par le montant accordé proposé.
  const propLigne = (accorde: string) => {
    const i = p?.proposition.finances.lignes.findIndex((l) => l.montantAccorde.id === accorde) ?? -1;
    return i < 0 ? null : { ligne: p!.proposition.finances.lignes[i], raisons: p!.raisons.lignes[i] };
  };
  const proposeRef = (r: ChampRef | null | undefined, raison: string | undefined) => (raison ? { id: id(r), raison } : undefined);
  const pm = p?.proposition.finances.millesime;

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
            <ChampSelect label="Montant demandé" value={form.montantDemande} onChange={(v) => set({ montantDemande: v })} candidats={p.candidats.montantDemande} aucun="Aucun" known={known}
              propose={proposeRef(p.proposition.champs.montantDemande, p.raisons.montantDemande)}
              hint="Un champ d'un bloc répétable vaut la somme de ses lignes." />
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

            {p.raisons.sansLigne && (
              <p className="notice notice--warn">
                {p.raisons.sansLigne}. Ajoutez-en une dans l'éditeur de la démarche sur DN (par exemple « Montant accordé »),
                puis actualisez cette page. <a href={p.demarche.dnAdminUrl} target="_blank" rel="noreferrer">Ouvrir la démarche sur DN</a>
              </p>
            )}

            {form.lignes.map((l, i) => {
              const prop = propLigne(l.montantAccorde);
              const r = prop?.raisons;
              const plusieurs = form.lignes.length > 1;
              return (
                <fieldset key={i} className="ligne">
                  <legend>Ligne de financement {i + 1}</legend>
                  <ChampSelect label="Montant accordé" required value={l.montantAccorde} onChange={(v) => setLigne(i, { montantAccorde: v })} candidats={p.candidats.montantAccorde}
                    aucun="À choisir" known={known} propose={r ? { id: prop!.ligne.montantAccorde.id, raison: r.montantAccorde } : undefined}
                    hint="Annotation privée de type nombre : base du calcul de l'enveloppe." />

                  <div className="field" role="radiogroup" aria-label={`Programme de la ligne ${i + 1}`}>
                    <span className="field__label">Programme {plusieurs && <span className="muted">(obligatoire avec plusieurs lignes)</span>}</span>
                    <div className="choices">
                      {(["aucun", "fixe", "champ"] as const).map((src) => (
                        <label key={src}>
                          <input type="radio" name={`programme-${i}`} checked={l.programmeSource === src} onChange={() => setLigne(i, { programmeSource: src })} />
                          {src === "aucun" ? "Aucun" : src === "fixe" ? "Valeur fixe" : "Lu dans un champ"}
                        </label>
                      ))}
                    </div>
                    {r && <p className="field__hint">{l.programmeSource === "aucun" && plusieurs ? "À renseigner : plusieurs lignes." : `Proposé : ${r.programme}.`}</p>}
                  </div>
                  {l.programmeSource === "fixe" && (
                    <div className="field">
                      <label htmlFor={`prog-${i}`}>Valeur du programme</label>
                      <input id={`prog-${i}`} className="input" required maxLength={80} placeholder="ex. DSIL" value={l.programmeValeur} onChange={(e) => setLigne(i, { programmeValeur: e.target.value })} />
                    </div>
                  )}
                  {l.programmeSource === "champ" && (
                    <ChampSelect label="Champ du programme" required value={l.programmeChamp} onChange={(v) => setLigne(i, { programmeChamp: v })} candidats={p.candidats.programme} aucun="À choisir" known={known} />
                  )}

                  <ChampSelect label="Montant demandé" value={l.montantDemande} onChange={(v) => setLigne(i, { montantDemande: v })} candidats={p.candidats.montantDemande}
                    aucun={plusieurs ? "Aucun" : "Celui des cartes"} known={known} propose={r ? proposeRef(prop!.ligne.montantDemande, r.montantDemande) : undefined} />
                  <ChampSelect label="Assiette éligible" value={l.assiette} onChange={(v) => setLigne(i, { assiette: v })} candidats={p.candidats.assiette}
                    aucun="Aucune" known={known} propose={r ? proposeRef(prop!.ligne.assiette, r.assiette) : undefined} />
                  <ChampSelect label="Taux" value={l.taux} onChange={(v) => setLigne(i, { taux: v })} candidats={p.candidats.taux}
                    aucun="Calculé (accordé ÷ assiette)" known={known} propose={r ? proposeRef(prop!.ligne.taux, r.taux) : undefined} />
                  <div className="field">
                    <label htmlFor={`tauxmax-${i}`}>Taux maximal (%)</label>
                    <input id={`tauxmax-${i}`} className="input input--short" type="number" min={0} max={100} step="any" placeholder="facultatif" value={l.tauxMax} onChange={(e) => setLigne(i, { tauxMax: e.target.value })} aria-describedby={`tauxmax-${i}-hint`} />
                    <p id={`tauxmax-${i}-hint`} className="field__hint">Au-delà, le dossier est signalé (alerte non bloquante).</p>
                  </div>
                  <ChampSelect label="N° d'engagement juridique" value={l.numeroEJ} onChange={(v) => setLigne(i, { numeroEJ: v })} candidats={p.candidats.numeroEJ}
                    aucun="Aucun" known={known} propose={r ? proposeRef(prop!.ligne.numeroEJ, r.numeroEJ) : undefined} />

                  <button type="button" className="btn btn--danger-outline" onClick={() => set({ lignes: form.lignes.filter((_, j) => j !== i) })}>
                    Retirer cette ligne
                  </button>
                </fieldset>
              );
            })}
            <button type="button" className="btn btn--secondary" disabled={!p.candidats.montantAccorde.length} onClick={() => set({ lignes: [...form.lignes, emptyLigne()] })}>
              Ajouter une ligne de financement
            </button>

            <h3>Enveloppes alimentées</h3>
            <p className="muted">Aucune pour l'instant : les enveloppes se créent à part, avec l'étape C.</p>
          </section>

          <section className="settings__section" aria-labelledby="s-mutations">
            <h2 id="s-mutations">4. Changements d'état</h2>
            <label className="check">
              <input type="checkbox" checked={form.mutations} onChange={(e) => set({ mutations: e.target.checked })} />
              Autoriser les changements d'état sur cette démarche
            </label>
            <p className="field__hint">
              Il faut aussi <code>DN_ENABLE_MUTATIONS=1</code> sur le serveur
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
