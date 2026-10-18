// Ajout d'une démarche par son numéro (docs/SPEC-multi-demarches.md § A). Le serveur
// vérifie l'accès du jeton ; rien n'est déclaré avant la confirmation de l'agent. La
// démarche est déclarée en lecture seule, avec les réglages par défaut.
// À l'étape B, la fiche de paramétrage pré-remplie remplacera cette confirmation.
import { useEffect, useRef, useState } from "react";
import { DEMARCHE_STATES } from "../board.ts";

type Checked = { number: number; title: string; state: string; declaree: boolean };

type Props = {
  open: boolean;
  onClose: () => void;
  onAdded: (numero: number) => void;
};

export function AddDemarcheDialog({ open, onClose, onAdded }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const [numero, setNumero] = useState("");
  const [checked, setChecked] = useState<Checked | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open) {
      setNumero("");
      setChecked(null);
      setError(null);
      if (!dialog.open) dialog.showModal();
    } else if (dialog.open) {
      dialog.close();
    }
  }, [open]);

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setChecked(null);
    try {
      const res = await fetch(`/api/demarches/${numero}/verifier`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `Erreur ${res.status}`);
      setChecked(body);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function declare() {
    if (!checked) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/demarches/${checked.number}/parametres`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          libelle: checked.title.slice(0, 120),
          mutations: false,
          delaiCibleJours: 45,
          champs: { objet: null, montantDemande: null },
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `Erreur ${res.status}`);
      onAdded(checked.number);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog ref={ref} className="dialog" aria-labelledby="add-demarche-title" onCancel={(e) => { e.preventDefault(); if (!busy) onClose(); }}>
      <form onSubmit={verify}>
        <h2 id="add-demarche-title">Ajouter une démarche</h2>
        <p className="muted">
          L'API ne permet pas de lister les démarches ouvertes par le jeton : saisissez le numéro
          de la démarche, visible dans son adresse sur Démarche Numérique.
        </p>
        <label>
          Numéro de la démarche
          <input
            className="input"
            inputMode="numeric"
            pattern="[0-9]+"
            required
            value={numero}
            onChange={(e) => { setNumero(e.target.value.replace(/\D/g, "")); setChecked(null); }}
            autoFocus
          />
        </label>

        {error && <p className="dialog__error" role="alert">Démarche Numérique a répondu : {error}</p>}

        {checked && (
          <div className="panel" role="status">
            <p><strong>{checked.title}</strong></p>
            <p className="muted">n° {checked.number} · {DEMARCHE_STATES[checked.state] ?? checked.state}</p>
            <p>
              {checked.declaree
                ? "Cette démarche est déjà déclarée dans le back office."
                : "Le jeton y a accès. Elle sera ajoutée en lecture seule : les changements d'état s'autorisent ensuite dans ses paramètres."}
            </p>
          </div>
        )}

        <div className="dialog__actions">
          <button type="button" className="btn btn--secondary" onClick={onClose} disabled={busy}>Annuler</button>
          {checked && !checked.declaree ? (
            <button type="button" className="btn btn--primary" onClick={declare} disabled={busy}>
              {busy ? "Enregistrement…" : "Ajouter cette démarche"}
            </button>
          ) : checked?.declaree ? (
            <button type="button" className="btn btn--primary" onClick={() => onAdded(checked.number)}>Ouvrir son kanban</button>
          ) : (
            <button type="submit" className="btn btn--primary" disabled={busy || !numero}>
              {busy ? "Vérification…" : "Vérifier l'accès"}
            </button>
          )}
        </div>
      </form>
    </dialog>
  );
}
