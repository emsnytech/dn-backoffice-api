import { useEffect, useState } from "react";
import { Link } from "react-router";
import { Alert } from "@codegouvfr/react-dsfr/Alert";
import { Checkbox } from "@codegouvfr/react-dsfr/Checkbox";
import { Input } from "@codegouvfr/react-dsfr/Input";
import { createModal } from "@codegouvfr/react-dsfr/Modal";
import { useApi } from "../api.ts";
import { RefreshButton } from "../RefreshButton.tsx";
import { STATES, demandeurName, formatDate } from "../format.tsx";
import {
  COLUMNS,
  MOTIVATION_ALLOWED,
  MOTIVATION_REQUIRED,
  TRANSITIONS,
  canTransition,
  type DossierState,
} from "../../shared/transitions.ts";
import "./kanban.css";

const confirmModal = createModal({ id: "transition-modal", isOpenedByDefault: false });

type Pending = { dossier: any; target: DossierState };

export function Kanban() {
  const demarche = useApi<any>("/api/demarche");
  const initial = useApi<any[]>("/api/dossiers");
  const [dossiers, setDossiers] = useState<any[]>([]);
  const [dragged, setDragged] = useState<any>(null);
  const [over, setOver] = useState<DossierState | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [motivation, setMotivation] = useState("");
  const [disableNotification, setDisableNotification] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (initial.data) setDossiers(initial.data);
  }, [initial.data]);

  function askTransition(dossier: any, target: DossierState) {
    if (!canTransition(dossier.state, target)) return;
    setPending({ dossier, target });
    setMotivation("");
    setDisableNotification(false);
    setError(null);
    confirmModal.open();
  }

  async function confirm() {
    if (!pending) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/dossiers/${pending.dossier.number}/state`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state: pending.target, motivation, disableNotification }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `Erreur ${res.status}`);
      setDossiers((list) => list.map((d) => (d.number === body.number ? { ...d, ...body } : d)));
      setSuccess(`Dossier n° ${body.number} passé en « ${STATES[body.state]?.label ?? body.state} ».`);
      confirmModal.close();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  function dropState(column: DossierState) {
    if (!dragged) return undefined;
    if (dragged.state === column) return undefined;
    if (!canTransition(dragged.state, column)) return "forbidden";
    return over === column ? "over" : "allowed";
  }

  const motivationRequired = pending && MOTIVATION_REQUIRED.has(pending.target);
  const motivationAllowed = pending && MOTIVATION_ALLOWED.has(pending.target);

  return (
    <>
      <h1 className="fr-mb-1w">{demarche.data?.title ?? "Instruction"}</h1>
      <p className="fr-text--sm">
        Glissez une carte vers une autre colonne, ou utilisez « Déplacer vers… », pour changer l'état d'un dossier.
        Les colonnes estompées ne sont pas accessibles depuis l'état actuel.
      </p>

      <RefreshButton onClick={initial.reload} loading={initial.loading} loadedAt={initial.loadedAt} />
      {success && <Alert severity="success" small description={success} closable onClose={() => setSuccess(null)} className="fr-mb-3w" />}
      {initial.loading && !initial.data && <p>Chargement des dossiers…</p>}
      {initial.error && <Alert severity="error" title="Impossible de charger les dossiers" description={initial.error} small />}

      {initial.data && (
        <div className="kanban">
          {COLUMNS.map((column) => {
            const cards = dossiers.filter((d) => d.state === column);
            return (
              <section
                key={column}
                className="kanban-column"
                aria-label={STATES[column].label}
                data-drop={dropState(column)}
                onDragOver={(e) => {
                  if (dragged && canTransition(dragged.state, column)) {
                    e.preventDefault();
                    setOver(column);
                  }
                }}
                onDragLeave={() => setOver((o) => (o === column ? null : o))}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragged) askTransition(dragged, column);
                  setDragged(null);
                  setOver(null);
                }}
              >
                <h2 className="fr-h6">
                  {STATES[column].label}
                  <span className="fr-badge fr-badge--sm">{cards.length}</span>
                </h2>
                {cards.map((d) => (
                  <article
                    key={d.number}
                    className="kanban-card"
                    draggable
                    data-dragging={dragged?.number === d.number}
                    onDragStart={(e) => {
                      e.dataTransfer.effectAllowed = "move";
                      setDragged(d);
                    }}
                    onDragEnd={() => {
                      setDragged(null);
                      setOver(null);
                    }}
                  >
                    <p className="fr-text--bold">
                      <Link to={`/dossiers/${d.number}`}>N° {d.number}</Link>
                    </p>
                    <p className="fr-text--sm">{demandeurName(d)}</p>
                    <p className="fr-text--xs fr-text-mention--grey">Déposé le {formatDate(d.dateDepot)}</p>
                    <div className="fr-select-group">
                      <label className="fr-sr-only" htmlFor={`move-${d.number}`}>Déplacer le dossier {d.number} vers</label>
                      <select
                        id={`move-${d.number}`}
                        className="fr-select fr-select--sm"
                        value=""
                        onChange={(e) => askTransition(d, e.target.value as DossierState)}
                      >
                        <option value="" disabled>Déplacer vers…</option>
                        {Object.keys(TRANSITIONS[d.state as DossierState] ?? {}).map((target) => (
                          <option key={target} value={target}>{STATES[target].label}</option>
                        ))}
                      </select>
                    </div>
                  </article>
                ))}
              </section>
            );
          })}
        </div>
      )}

      <confirmModal.Component
        title={pending ? `Dossier n° ${pending.dossier.number}` : "Changement d'état"}
        buttons={[
          { children: "Annuler", priority: "secondary" },
          {
            children: submitting ? "Envoi…" : "Confirmer",
            doClosesModal: false,
            disabled: submitting || Boolean(motivationRequired && !motivation.trim()),
            onClick: confirm,
          },
        ]}
      >
        {pending && (
          <>
            <p>
              Passer de <strong>« {STATES[pending.dossier.state].label} »</strong> à{" "}
              <strong>« {STATES[pending.target].label} »</strong>.
              Ce changement est appliqué immédiatement dans Démarche Numérique.
            </p>
            {motivationAllowed && (
              <Input
                label={`Motivation${motivationRequired ? " (obligatoire)" : " (facultative)"}`}
                hintText="Transmise à l'usager avec la décision."
                textArea
                nativeTextAreaProps={{ value: motivation, onChange: (e) => setMotivation(e.target.value), rows: 4 }}
              />
            )}
            <Checkbox
              small
              options={[
                {
                  label: "Ne pas notifier l'usager par e-mail",
                  nativeInputProps: { checked: disableNotification, onChange: (e) => setDisableNotification(e.target.checked) },
                },
              ]}
            />
            {error && <Alert severity="error" small description={error} />}
          </>
        )}
      </confirmModal.Component>
    </>
  );
}
