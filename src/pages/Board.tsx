import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { useApi } from "../api.ts";
import { COLUMNS, STATE_LABELS, age, filters, formatMontant, matchesSearch, type Card, type FilterId, type Kanban } from "../board.ts";
import { KanbanCard } from "../components/KanbanCard.tsx";
import { TransitionDialog, type PendingMove } from "../components/TransitionDialog.tsx";
import { canTransition, type DossierState } from "../../shared/transitions.ts";

// Transitions autorisées par DN (docs/SPEC-kanban.md § 7), rappelées sous le tableau.
const TRANSITIONS = [
  ["Construction → Instruction", "dossierPasserEnInstruction"],
  ["Instruction → Construction", "dossierRepasserEnConstruction"],
  ["Instruction → Accepté", "dossierAccepter"],
  ["Instruction → Refusé", "dossierRefuser"],
  ["Instruction → Sans suite", "dossierClasserSansSuite"],
  ["Décision → Instruction", "dossierRepasserEnInstruction"],
];

function sinceLabel(iso: string, now: number) {
  const min = Math.floor((now - new Date(iso).getTime()) / 60000);
  if (min < 1) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  return `à ${new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`;
}

export function Board() {
  const kanban = useApi<Kanban>("/api/kanban");
  const [view, setView] = useState<"kanban" | "liste">("kanban");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FilterId>("tous");
  const [now, setNow] = useState(Date.now());
  const [dragged, setDragged] = useState<Card | null>(null);
  const [over, setOver] = useState<DossierState | null>(null);
  const [pending, setPending] = useState<PendingMove | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const k = kanban.data;
  const filterList = useMemo(() => (k ? filters(k) : []), [k]);
  const searched = useMemo(() => (k ? k.dossiers.filter((c) => matchesSearch(c, query)) : []), [k, query]);
  const active = filterList.find((f) => f.id === filter) ?? filterList[0];
  const visible = active ? searched.filter(active.test) : searched;
  const canMove = Boolean(k?.mutationsEnabled);

  function askMove(card: Card, target: DossierState) {
    if (canTransition(card.state, target)) setPending({ card, target });
  }

  // Pas de mise à jour optimiste : la carte ne bouge qu'une fois le tableau relu depuis DN.
  async function confirmMove(options: { motivation: string; disableNotification: boolean }) {
    if (!pending) return;
    const res = await fetch(`/api/dossiers/${pending.card.number}/state`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state: pending.target, ...options }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error ?? `Erreur ${res.status}`);
    setPending(null);
    setToast(
      `Dossier n° ${body.number} : ${STATE_LABELS[body.state as DossierState] ?? body.state}` +
        (options.disableNotification ? " (usager non notifié)." : "."),
    );
    kanban.reload();
  }

  // Attributs d'une zone de dépôt pour l'état cible donné.
  function dropZone(target: DossierState) {
    if (!canMove) return {};
    const allowed = dragged !== null && canTransition(dragged.state, target);
    const state = !dragged || dragged.state === target ? undefined : !allowed ? "forbidden" : over === target ? "over" : "allowed";
    return {
      "data-drop": state,
      onDragOver: (e: React.DragEvent) => {
        if (!allowed) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setOver(target);
      },
      onDragLeave: (e: React.DragEvent) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver((o) => (o === target ? null : o));
      },
      onDrop: (e: React.DragEvent) => {
        e.preventDefault();
        if (dragged && allowed) askMove(dragged, target);
        setDragged(null);
        setOver(null);
      },
    };
  }

  const renderCard = (c: Card) => (
    <KanbanCard
      key={c.number}
      card={c}
      delaiCibleJours={k!.delaiCibleJours}
      move={
        canMove
          ? {
              dragging: dragged?.number === c.number,
              onDragStart: () => setDragged(c),
              onDragEnd: () => {
                setDragged(null);
                setOver(null);
              },
              onMove: (target) => askMove(c, target),
            }
          : undefined
      }
    />
  );

  return (
    <>
      <header className="app-header">
        <div className="app-header__titles">
          <div className="app-header__kicker">Back office indépendant · connecté à Démarche Numérique</div>
          <h1>{k ? `Démarche test n° ${k.demarche.number} — ${k.demarche.title}` : "Chargement de la démarche…"}</h1>
        </div>
        <div className={kanban.error ? "sync sync--error" : "sync"} role="status">
          <span>
            {kanban.error
              ? "Échec de la synchronisation"
              : k
                ? `Synchronisé par l'API GraphQL · ${sinceLabel(k.syncedAt, now)}`
                : "Synchronisation…"}
          </span>
          <button type="button" onClick={kanban.reload} disabled={kanban.loading}>
            {kanban.loading ? "Synchronisation…" : "Synchroniser"}
          </button>
        </div>
        <div className="segmented" role="group" aria-label="Mode d'affichage">
          <button type="button" aria-pressed={view === "kanban"} onClick={() => setView("kanban")}>Kanban</button>
          <button type="button" aria-pressed={view === "liste"} onClick={() => setView("liste")}>Liste</button>
        </div>
      </header>

      {kanban.error && <p className="notice" role="alert">{kanban.error}</p>}
      {toast && (
        <div className="toast" role="status">
          <span>{toast}</span>
          <button type="button" onClick={() => setToast(null)}>Fermer<span className="sr-only"> le message</span></button>
        </div>
      )}

      {k && (
        <>
          <div className="toolbar">
            <label className="search">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
              </svg>
              <span className="sr-only">Rechercher un dossier</span>
              <input type="search" placeholder="N° de dossier, demandeur, SIRET…" value={query} onChange={(e) => setQuery(e.target.value)} />
            </label>
            <div className="filters" role="group" aria-label="Filtres">
              {filterList.map((f) => (
                <button key={f.id} type="button" className="pill" aria-pressed={active?.id === f.id} onClick={() => setFilter(f.id)}>
                  {f.label} · {searched.filter(f.test).length}
                </button>
              ))}
            </div>
          </div>

          <main className="board-wrap">
            {view === "kanban" ? (
              <div className="board">
                {COLUMNS.map((col) => {
                  const count = visible.filter((c) => col.groups.some((g) => g.state === c.state)).length;
                  const single = col.groups.length === 1 ? col.groups[0].state : null;
                  return (
                    <section
                      key={col.id}
                      className={single ? "column drop-zone" : "column"}
                      aria-labelledby={`col-${col.id}`}
                      {...(single ? dropZone(single) : {})}
                    >
                      <div className="column__head">
                        <h2 id={`col-${col.id}`}>
                          <span className="dot" style={{ background: col.dot }} aria-hidden="true" />
                          <span>{col.label}</span>
                          <span className="column__count"><span className="sr-only">, </span>{count}<span className="sr-only"> dossiers</span></span>
                        </h2>
                        <code className="column__api">{col.apiState}</code>
                      </div>
                      <p className="column__hint">{col.hint}</p>
                      {col.groups.map((g) => {
                        const cards = visible.filter((c) => c.state === g.state);
                        return (
                          <div key={g.state} style={{ display: "contents" }}>
                            {g.title && (
                              <h3 className="group__head">
                                <span>{g.title} · {cards.length}</span>
                                <code>{g.state}</code>
                              </h3>
                            )}
                            <div className={single ? "group" : "group drop-zone"} {...(single ? {} : dropZone(g.state))}>
                              {cards.map(renderCard)}
                            </div>
                          </div>
                        );
                      })}
                      {count === 0 && single && <p className="column__empty">Aucun dossier.</p>}
                    </section>
                  );
                })}
              </div>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <caption className="sr-only">{visible.length} dossiers</caption>
                  <thead>
                    <tr><th scope="col">N°</th><th scope="col">Demandeur</th><th scope="col">État</th><th scope="col">Ancienneté</th><th scope="col">Messages</th><th scope="col">Montant</th></tr>
                  </thead>
                  <tbody>
                    {visible.map((c) => {
                      const a = age(c, k.delaiCibleJours, now);
                      return (
                        <tr key={c.number}>
                          <td><Link to={`/dossiers/${c.number}`} className="mono">{c.number}</Link></td>
                          <td>{c.demandeur.label}</td>
                          <td>{STATE_LABELS[c.state]}</td>
                          <td>{a.late ? <span className="card__age card__age--late">{a.label} · délai dépassé</span> : a.label}</td>
                          <td>{c.messages}</td>
                          <td className="mono">{c.montant !== null ? formatMontant(c.montant) : "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            <section className="transitions" aria-label="Transitions autorisées">
              <div className="transitions__intro">
                <strong>Déplacer une carte = une mutation API</strong>
                <span>
                  {canMove
                    ? "Glissez une carte ou utilisez « Déplacer vers… ». Seuls les déplacements autorisés par DN sont proposés, après confirmation."
                    : "Changements d'état désactivés sur ce serveur (DN_ENABLE_MUTATIONS)."}
                </span>
              </div>
              <ul>
                {TRANSITIONS.map(([label, mutation]) => (
                  <li key={mutation + label}><span>{label}</span><code>{mutation}</code></li>
                ))}
              </ul>
            </section>
          </main>
        </>
      )}

      <TransitionDialog pending={pending} onCancel={() => setPending(null)} onConfirm={confirmMove} />
    </>
  );
}
