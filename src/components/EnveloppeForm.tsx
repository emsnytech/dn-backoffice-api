// Création ou modification d'une enveloppe (docs/SPEC-multi-demarches.md § C). Montant saisi
// en euros ; le serveur le valide et le stocke en centimes.
import { useEffect, useState } from "react";

// Montant saisi à la française : « 50 000 € », « 1.500.000 », « 12 500,50 ». null si illisible.
export function parseEuros(saisie: string): number | null {
  let s = saisie.replace(/[\s€]/g, "");
  if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(s)) s = s.replace(/\./g, "");
  s = s.replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  return Number(s);
}

type Initial = { libelle: string; programme: string | null; millesime: number; montantCentimes: number; demarches: number[]; parent: string | null };
type Props = {
  id?: string;
  initial?: Initial;
  // Démarches cochées d'office à la création (lien depuis le kanban ou les paramètres).
  demarchesInitiales?: number[];
  demarches: { numero: number; libelle: string }[];
  autres: { id: string; libelle: string }[];
  onSaved: (e: { id: string }) => void;
  onCancel?: () => void;
};

export function EnveloppeForm({ id, initial, demarchesInitiales, demarches, autres, onSaved, onCancel }: Props) {
  const [libelle, setLibelle] = useState(initial?.libelle ?? "");
  const [millesime, setMillesime] = useState(String(initial?.millesime ?? new Date().getFullYear()));
  const [montant, setMontant] = useState(initial ? String(initial.montantCentimes / 100) : "");
  const [choisies, setChoisies] = useState<number[]>(initial?.demarches ?? demarchesInitiales ?? []);
  const [parent, setParent] = useState(initial?.parent ?? "");
  const [programme, setProgramme] = useState(initial?.programme ?? "");
  // Liste fermée : régimes d'aide des démarches cochées (§ C), relue à chaque changement.
  const [programmes, setProgrammes] = useState<string[] | null>(null);
  useEffect(() => {
    if (!choisies.length) return setProgrammes([]);
    let stale = false;
    fetch(`/api/enveloppes/programmes?demarches=${choisies.join(",")}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`Erreur ${r.status}`))))
      .then((b) => !stale && setProgrammes(b.programmes))
      .catch(() => !stale && setProgrammes(null));
    return () => {
      stale = true;
    };
  }, [choisies.join(",")]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const euros = parseEuros(montant);
    if (euros === null) {
      setError("Montant illisible : saisissez un nombre en euros, par exemple 150 000 ou 150 000,50");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(id ? `/api/enveloppes/${id}` : "/api/enveloppes", {
        method: id ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ libelle, millesime: Number(millesime), montant: euros, demarches: choisies, programme: programme || null, parent: parent || null }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `Erreur ${res.status}`);
      onSaved(body);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const toggle = (n: number) => setChoisies((c) => (c.includes(n) ? c.filter((x) => x !== n) : [...c, n]));

  return (
    <form className="settings__section" onSubmit={submit}>
      <h2>{id ? "Modifier l'enveloppe" : "Créer une enveloppe"}</h2>
      <div className="field">
        <label htmlFor="env-libelle">Libellé</label>
        <input id="env-libelle" className="input" required maxLength={120} value={libelle} onChange={(e) => setLibelle(e.target.value)} placeholder="ex. DSIL 2026" />
      </div>
      <div className="field">
        <label htmlFor="env-millesime">Millésime</label>
        <input id="env-millesime" className="input input--short" type="number" min={2000} max={2100} required value={millesime} onChange={(e) => setMillesime(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="env-montant">Montant de l'enveloppe (€)</label>
        <input id="env-montant" className="input input--short" inputMode="decimal" required value={montant} onChange={(e) => setMontant(e.target.value)} aria-describedby="env-montant-hint" />
        <p id="env-montant-hint" className="field__hint">Saisi ici : ce montant n'existe pas dans Démarche Numérique.</p>
      </div>
      <fieldset className="field">
        <legend className="field__label">Démarches qui alimentent l'enveloppe</legend>
        {demarches.map((d) => (
          <label key={d.numero} className="check">
            <input type="checkbox" checked={choisies.includes(d.numero)} onChange={() => toggle(d.numero)} />
            {d.libelle} <span className="muted">n° {d.numero}</span>
          </label>
        ))}
        {!choisies.length && <p className="field__hint">Cochez au moins une démarche pour pouvoir enregistrer.</p>}
      </fieldset>
      <div className="field">
        <label htmlFor="env-programme">Régime d'aide</label>
        <select id="env-programme" className="input" value={programme} onChange={(e) => setProgramme(e.target.value)} aria-describedby="env-programme-hint">
          <option value="">Tous régimes</option>
          {programme && programmes && !programmes.includes(programme) && <option value={programme}>{programme} (absent des démarches cochées)</option>}
          {programmes?.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
        <p id="env-programme-hint" className="field__hint">
          {programmes === null
            ? "Liste des régimes indisponible (Démarche Numérique injoignable)."
            : programmes.length
              ? "Options du sous-champ « régime d'aide » du bloc de décision des démarches cochées."
              : "Aucun régime : les démarches cochées n'ont pas de bloc de décision dans leur paramétrage."}
        </p>
      </div>
      <div className="field">
        <label htmlFor="env-parent">Enveloppe mère (délégation, facultatif)</label>
        <select id="env-parent" className="input" value={parent} onChange={(e) => setParent(e.target.value)}>
          <option value="">Aucune</option>
          {autres.map((a) => <option key={a.id} value={a.id}>{a.libelle}</option>)}
        </select>
      </div>
      {error && <p className="dialog__error" role="alert">{error}</p>}
      <div className="settings__actions">
        <button type="submit" className="btn btn--primary" disabled={busy || !choisies.length}>{busy ? "Enregistrement…" : "Enregistrer l'enveloppe"}</button>
        {onCancel && <button type="button" className="btn btn--secondary" onClick={onCancel} disabled={busy}>Annuler</button>}
      </div>
    </form>
  );
}
