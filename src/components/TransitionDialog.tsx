import { useEffect, useRef, useState } from "react";
import { STATE_LABELS, type Card } from "../board.ts";
import { MOTIVATION_ALLOWED, MOTIVATION_REQUIRED, type DossierState } from "../../shared/transitions.ts";

export type PendingMove = { card: Card; target: DossierState };

// Question posée avant chaque mutation (docs/SPEC-kanban.md § 7).
function question({ card, target }: PendingMove) {
  const n = `le dossier n° ${card.number}`;
  switch (target) {
    case "en_instruction":
      return card.state === "en_construction" ? `Passer ${n} en instruction ?` : `Repasser ${n} en instruction ?`;
    case "en_construction":
      return `Repasser ${n} en construction ?`;
    case "accepte":
      return `Accepter ${n} ?`;
    case "refuse":
      return `Refuser ${n} ?`;
    case "sans_suite":
      return `Classer sans suite ${n} ?`;
  }
}

type Props = {
  pending: PendingMove | null;
  onCancel: () => void;
  // Résout quand DN a confirmé ; rejette avec le message d'erreur de DN sinon.
  onConfirm: (options: { motivation: string; disableNotification: boolean }) => Promise<void>;
};

export function TransitionDialog({ pending, onCancel, onConfirm }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const [motivation, setMotivation] = useState("");
  const [disableNotification, setDisableNotification] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (pending) {
      setMotivation("");
      setDisableNotification(false);
      setError(null);
      if (!dialog.open) dialog.showModal();
    } else if (dialog.open) {
      dialog.close();
    }
  }, [pending]);

  if (!pending) return <dialog ref={ref} className="dialog" />;

  const required = MOTIVATION_REQUIRED.has(pending.target);
  const allowed = MOTIVATION_ALLOWED.has(pending.target);
  const negative = pending.target === "refuse" || pending.target === "sans_suite";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await onConfirm({ motivation, disableNotification });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <dialog
      ref={ref}
      className="dialog"
      aria-labelledby="transition-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!submitting) onCancel();
      }}
    >
      <form onSubmit={submit}>
        <h2 id="transition-title">{question(pending)}</h2>
        <p>
          {pending.card.demandeur.label}<br />
          <span className="muted">
            {STATE_LABELS[pending.card.state]} → <strong>{STATE_LABELS[pending.target]}</strong>.
            Le changement est appliqué immédiatement dans Démarche Numérique.
          </span>
        </p>
        {allowed && (
          <label>
            Motivation {required ? "(obligatoire)" : "(facultative)"}
            <textarea
              value={motivation}
              onChange={(e) => setMotivation(e.target.value)}
              required={required}
              aria-describedby="motivation-hint"
            />
            <span id="motivation-hint" className="muted" style={{ fontWeight: 400, fontSize: 13 }}>
              Transmise au demandeur avec la décision.
            </span>
          </label>
        )}
        <label className="checkbox">
          <input type="checkbox" checked={disableNotification} onChange={(e) => setDisableNotification(e.target.checked)} />
          Ne pas notifier l'usager par e-mail
        </label>
        {error && <p className="dialog__error" role="alert">Démarche Numérique a refusé le changement : {error}</p>}
        <div className="dialog__actions">
          <button type="button" className="btn btn--secondary" onClick={onCancel} disabled={submitting}>Annuler</button>
          <button
            type="submit"
            className={negative ? "btn btn--danger" : "btn btn--primary"}
            disabled={submitting || (required && !motivation.trim())}
          >
            {submitting ? "Envoi à DN…" : "Confirmer"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
