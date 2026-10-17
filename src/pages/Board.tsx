import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { useApi } from "../api.ts";
import { COLUMNS, STATE_LABELS, age, filters, formatMontant, matchesSearch, type FilterId, type Kanban } from "../board.ts";
import { KanbanCard } from "../components/KanbanCard.tsx";

// Transitions de l'étape 3, affichées pour information (aucune n'est déclenchée ici).
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

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const k = kanban.data;
  const filterList = useMemo(() => (k ? filters(k) : []), [k]);
  const searched = useMemo(() => (k ? k.dossiers.filter((c) => matchesSearch(c, query)) : []), [k, query]);
  const active = filterList.find((f) => f.id === filter) ?? filterList[0];
  const visible = active ? searched.filter(active.test) : searched;

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
                  return (
                    <section key={col.id} className="column" aria-labelledby={`col-${col.id}`}>
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
                            {cards.map((c) => <KanbanCard key={c.number} card={c} delaiCibleJours={k.delaiCibleJours} />)}
                          </div>
                        );
                      })}
                      {count === 0 && <p className="column__empty">Aucun dossier.</p>}
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
                <span>Disponible à l'étape 3. Seuls les déplacements autorisés par DN seront proposés.</span>
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
    </>
  );
}
