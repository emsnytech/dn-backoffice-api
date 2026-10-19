// Ajout d'une démarche par son numéro (docs/SPEC-multi-demarches.md § A). Le serveur
// vérifie l'accès du jeton, puis la fiche de paramétrage s'ouvre pré-remplie (§ B) :
// rien n'est déclaré avant son enregistrement.
import { useEffect, useRef, useState } from "react";
import { DEMARCHE_STATES } from "../board.ts";

type Checked = { number: number; title: string; state: string; declaree: boolean };

type Props = {
  open: boolean;
  onClose: () => void;
  // Démarche déjà déclarée : ouvrir son kanban ; sinon : ouvrir sa fiche de paramétrage.
  onOpen: (numero: number, declaree: boolean) => void;
};

export function AddDemarcheDialog({ open, onClose, onOpen }: Props) {
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
                : "Le jeton y a accès. La fiche de paramétrage va s'ouvrir, pré-remplie : la démarche ne sera ajoutée qu'à son enregistrement."}
            </p>
          </div>
        )}

        <div className="dialog__actions">
          <button type="button" className="btn btn--secondary" onClick={onClose} disabled={busy}>Annuler</button>
          {checked ? (
            <button type="button" className="btn btn--primary" onClick={() => onOpen(checked.number, checked.declaree)}>
              {checked.declaree ? "Ouvrir son kanban" : "Paramétrer cette démarche"}
            </button>
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
