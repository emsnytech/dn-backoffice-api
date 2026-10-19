// Saisie du bloc de décision depuis la fiche dossier (docs/SPEC-multi-demarches.md § C, C2b) :
// régime, statut, montant, assiette et référence d'engagement de chaque ligne, ajout d'une
// ligne. Rien n'est envoyé sans la confirmation, qui montre ancienne et nouvelle valeur ; le
// serveur relit le dossier avant d'écrire et refuse si une valeur a changé dans DN entre-temps.
import { useEffect, useRef, useState } from "react";
import { STATE_LABELS } from "../board.ts";
import { ROLES_DECISION, parseEuros, type RoleDecision, type ValeurDecision, type VueDecision } from "../finances.ts";
import type { DossierState } from "../../shared/transitions.ts";

type Props = {
  numero: string;
  number: number;
  state: DossierState;
  decision: VueDecision;
  dnUrl: string;
  // Appelé après un enregistrement réussi : la fiche et le tableau sont relus depuis DN.
  onSaved: (message: string) => void;
  // Relit le dossier (après un refus pour valeur modifiée dans DN entre-temps).
  onReload: () => void;
};

// Saisie en cours : texte brut par champ (identifiant du champ → saisie).
type Saisies = Record<string, string>;
type Changement = { champId: string; role: RoleDecision; rang: number; libelle: string; avant: ValeurDecision; apres: ValeurDecision };

const vers = (v: ValeurDecision) => (v === null ? "" : typeof v === "number" ? String(v).replace(".", ",") : v);
const affiche = (v: ValeurDecision, nombre: boolean) =>
  v === null ? "vide" : nombre ? `${Number(v).toLocaleString("fr-FR", { maximumFractionDigits: 2 })} €` : `« ${v} »`;

export function DecisionEditor({ numero, number, state, decision, dnUrl, onSaved, onReload }: Props) {
  const [editing, setEditing] = useState(false);
  const [saisies, setSaisies] = useState<Saisies>({});
  const [nouvelle, setNouvelle] = useState<Partial<Record<RoleDecision, string>> | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [details, setDetails] = useState<string[] | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDialogElement>(null);
  const sc = decision.sousChamps;
  const roles = ROLES_DECISION.filter((r) => sc[r]);
  const nombre = (r: RoleDecision) => sc[r]?.genre === "entier" || sc[r]?.genre === "decimal";

  // Nouvelle lecture du dossier : la saisie repart des valeurs de DN.
  useEffect(() => {
    setEditing(false);
    setSaisies({});
    setNouvelle(null);
  }, [decision]);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (confirming && !d.open) d.showModal();
    if (!confirming && d.open) d.close();
  }, [confirming]);

  // Valeur saisie convertie ; undefined si illisible.
  function lire(role: RoleDecision, texte: string): ValeurDecision | undefined {
    const t = texte.trim();
    if (!t) return null;
    if (!nombre(role)) return t;
    const n = parseEuros(t);
    return n === null ? undefined : n;
  }

  function changements(): { liste: Changement[]; illisibles: string[] } {
    const liste: Changement[] = [];
    const illisibles: string[] = [];
    for (const l of decision.lignes) {
      for (const role of roles) {
        const c = l.champs[role];
        if (!c || saisies[c.champId] === undefined) continue;
        const apres = lire(role, saisies[c.champId]);
        if (apres === undefined) illisibles.push(`ligne ${l.rang}, ${sc[role]!.libelle}`);
        else if (vers(apres) !== vers(c.valeur)) liste.push({ champId: c.champId, role, rang: l.rang, libelle: sc[role]!.libelle, avant: c.valeur, apres });
      }
    }
    if (nouvelle) {
      for (const role of roles) if (nouvelle[role] && lire(role, nouvelle[role]!) === undefined) illisibles.push(`nouvelle ligne, ${sc[role]!.libelle}`);
    }
    return { liste, illisibles };
  }

  function verifier(e: React.FormEvent) {
    e.preventDefault();
    setErreur(null);
    setDetails(null);
    const { liste, illisibles } = changements();
    if (illisibles.length) return setErreur(`Montant illisible : ${illisibles.join(", ")}. Saisissez un nombre en euros, par exemple 15 000 ou 15 000,50.`);
    if (nouvelle && !nouvelle.regime) return setErreur("Nouvelle ligne : choisissez le régime d'aide.");
    if (!liste.length && !nouvelle) return setErreur("Aucune modification.");
    setConfirming(true);
  }

  async function enregistrer() {
    const { liste } = changements();
    setBusy(true);
    setErreur(null);
    setDetails(null);
    try {
      const res = await fetch(`/api/demarches/${numero}/dossiers/${number}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          modifications: liste.map(({ champId, role, avant, apres }) => ({ champId, role, avant, apres })),
          lignesAvant: decision.lignes.length,
          nouvelleLigne: nouvelle && Object.fromEntries(roles.map((r) => [r, nouvelle[r] ? lire(r, nouvelle[r]!) : null])),
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setDetails(Array.isArray(body.details) ? body.details : null);
        throw new Error(body.error ?? `Erreur ${res.status}`);
      }
      setConfirming(false);
      const n = body.modifications.length;
      onSaved(`Dossier n° ${number} : bloc de décision enregistré dans DN (${n} valeur${n > 1 ? "s" : ""} modifiée${n > 1 ? "s" : ""}${body.nouvelleLigne ? ", une ligne ajoutée" : ""}).`);
    } catch (e) {
      setErreur((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function champ(role: RoleDecision, valeur: string, onChange: (v: string) => void, label: string) {
    const s = sc[role]!;
    if (s.genre === "liste") {
      return (
        <select className="input" aria-label={label} value={valeur} onChange={(e) => onChange(e.target.value)}>
          <option value="">—</option>
          {valeur && !s.options?.includes(valeur) && <option value={valeur}>{valeur} (n'est plus une option)</option>}
          {s.options?.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      );
    }
    return (
      <input className={nombre(role) ? "input input--short" : "input"} aria-label={label} value={valeur} maxLength={nombre(role) ? 20 : 200}
        inputMode={nombre(role) ? "decimal" : undefined} onChange={(e) => onChange(e.target.value)} />
    );
  }

  if (!decision.saisie) return null;
  if (!editing) {
    return (
      <p>
        <button type="button" className="btn btn--secondary" onClick={() => setEditing(true)}>Modifier la décision</button>
      </p>
    );
  }

  const { liste } = confirming ? changements() : { liste: [] };
  const traite = state === "accepte" || state === "refuse" || state === "sans_suite";
  return (
    <form className="decision" onSubmit={verifier}>
      <h3>Modifier la décision</h3>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Ligne</th>{roles.map((r) => <th key={r}>{sc[r]!.libelle}{nombre(r) ? " (€)" : ""}</th>)}</tr></thead>
          <tbody>
            {decision.lignes.map((l) => (
              <tr key={l.rowId}>
                <td className="num">{l.rang}</td>
                {roles.map((r) => {
                  const c = l.champs[r];
                  const label = `Ligne ${l.rang}, ${sc[r]!.libelle}`;
                  return (
                    <td key={r}>
                      {c ? champ(r, saisies[c.champId] ?? vers(c.valeur), (v) => setSaisies((s) => ({ ...s, [c.champId]: v })), label) : <span className="muted">absent dans DN</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
            {nouvelle && (
              <tr>
                <td>Nouvelle</td>
                {roles.map((r) => (
                  <td key={r}>{champ(r, nouvelle[r] ?? "", (v) => setNouvelle((n) => ({ ...n, [r]: v })), `Nouvelle ligne, ${sc[r]!.libelle}`)}</td>
                ))}
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="field__hint">
        Supprimer une ligne n'est pas possible par l'API : <a href={dnUrl} target="_blank" rel="noopener noreferrer">ouvrir le dossier dans DN</a>.
      </p>
      {erreur && !confirming && <p className="dialog__error" role="alert">{erreur}</p>}
      <div className="settings__actions">
        <button type="submit" className="btn btn--primary">Vérifier les modifications</button>
        {!nouvelle && decision.blocChampId && <button type="button" className="btn btn--secondary" onClick={() => setNouvelle({})}>Ajouter une ligne</button>}
        {nouvelle && <button type="button" className="btn btn--secondary" onClick={() => setNouvelle(null)}>Retirer la nouvelle ligne</button>}
        <button type="button" className="btn btn--secondary" onClick={() => { setEditing(false); setSaisies({}); setNouvelle(null); setErreur(null); }}>Annuler</button>
      </div>

      <dialog ref={ref} className="dialog" aria-labelledby="decision-title" onCancel={(e) => { e.preventDefault(); if (!busy) setConfirming(false); }}>
        <div className="dialog__body">
          <h2 id="decision-title">Enregistrer la décision dans DN ?</h2>
          <p className="muted">Dossier n° {number} · {STATE_LABELS[state]}. Les valeurs sont écrites immédiatement dans les annotations privées.</p>
          {traite && (
            <p className="notice notice--warn">
              Ce dossier est {STATE_LABELS[state].toLowerCase()} : la décision a été notifiée à l'usager. Modifier le montant change
              {state === "accepte" ? " l'accepté de l'enveloppe" : " le suivi de l'enveloppe"}, sans nouvelle notification.
            </p>
          )}
          {liste.length > 0 && (
            <ul className="decision__changes">
              {liste.map((c) => (
                <li key={c.champId}>Ligne {c.rang}, {c.libelle} : {affiche(c.avant, nombre(c.role))} → <strong>{affiche(c.apres, nombre(c.role))}</strong></li>
              ))}
            </ul>
          )}
          {nouvelle && (
            <p>
              Nouvelle ligne : {roles.filter((r) => nouvelle[r]).map((r) => `${sc[r]!.libelle} ${affiche(lire(r, nouvelle[r]!) ?? null, nombre(r))}`).join(", ")}.
              <span className="muted"> Ajoutée en deux temps : si la seconde écriture échoue, une ligne vide reste dans DN.</span>
            </p>
          )}
          {erreur && (
            <div className="dialog__error" role="alert">
              {erreur}
              {details && <ul>{details.map((x) => <li key={x}>{x}</li>)}</ul>}
            </div>
          )}
          {details && (
            <p>
              <button type="button" className="btn btn--secondary" onClick={() => { setConfirming(false); onReload(); }}>Recharger le dossier</button>
            </p>
          )}
          <div className="dialog__actions">
            <button type="button" className="btn btn--secondary" onClick={() => setConfirming(false)} disabled={busy}>Annuler</button>
            <button type="button" className="btn btn--primary" onClick={enregistrer} disabled={busy}>{busy ? "Envoi à DN…" : "Enregistrer dans DN"}</button>
          </div>
        </div>
      </dialog>
    </form>
  );
}
