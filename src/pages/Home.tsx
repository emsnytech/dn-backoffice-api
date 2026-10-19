// Accueil : une carte par démarche déclarée (docs/SPEC-multi-demarches.md § A).
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { useApi } from "../api.ts";
import { COLUMNS, DEMARCHE_STATES, demarchePath } from "../board.ts";
import { AddDemarcheDialog } from "../components/AddDemarcheDialog.tsx";

type Summary = {
  numero: number;
  libelle: string;
  mutations: boolean;
  accessible: boolean;
  error?: string;
  title?: string;
  state?: string;
  counts?: Record<string, number>;
};

export function Home() {
  const navigate = useNavigate();
  const home = useApi<{ mutationsGlobal: boolean; demarches: Summary[] }>("/api/demarches");
  const [adding, setAdding] = useState(false);

  return (
    <>
      <header className="app-header">
        <div className="app-header__titles">
          <div className="app-header__kicker">Back office indépendant · connecté à Démarche Numérique</div>
          <h1>Démarches</h1>
        </div>
        <div className={home.error ? "sync sync--error" : "sync"} role="status">
          <span>{home.error ? "Échec de la synchronisation" : home.data ? "Synchronisé par l'API GraphQL" : "Synchronisation…"}</span>
          <button type="button" onClick={home.reload} disabled={home.loading}>
            {home.loading ? "Synchronisation…" : "Synchroniser"}
          </button>
        </div>
        <button type="button" className="btn btn--primary" onClick={() => setAdding(true)}>Ajouter une démarche</button>
      </header>

      {home.error && <p className="notice" role="alert">{home.error}</p>}

      <main className="home">
        {home.data && home.data.demarches.length === 0 && (
          <p className="muted">Aucune démarche déclarée. Ajoutez-en une avec son numéro.</p>
        )}
        <ul className="home__grid">
          {home.data?.demarches.map((d) => (
            <li key={d.numero} className={d.accessible ? "demarche-card" : "demarche-card demarche-card--error"}>
              <div className="demarche-card__head">
                <span className="card__num">N° {d.numero}</span>
                {d.state && <span className="state-badge">{DEMARCHE_STATES[d.state] ?? d.state}</span>}
                {!d.mutations && <span className="badge badge--tag">Lecture seule</span>}
              </div>
              <h2>
                {d.accessible ? <Link to={demarchePath(d.numero)}>{d.libelle}</Link> : d.libelle}
              </h2>
              {d.title && d.title !== d.libelle && <p className="demarche-card__title">{d.title}</p>}

              {d.accessible && d.counts ? (
                <dl className="demarche-card__counts">
                  {COLUMNS.map((col) => (
                    <div key={col.id}>
                      <dt><span className="dot" style={{ background: col.dot }} aria-hidden="true" /> {col.label}</dt>
                      <dd>{col.groups.reduce((n, g) => n + (d.counts![g.state] ?? 0), 0)}</dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="dialog__error" role="alert">Inaccessible avec le jeton actuel. Démarche Numérique a répondu : {d.error}</p>
              )}

              <div className="demarche-card__links">
                {d.accessible && <Link to={demarchePath(d.numero)}>Ouvrir le kanban</Link>}
                <Link to={`${demarchePath(d.numero)}/parametres`}>Paramètres</Link>
              </div>
            </li>
          ))}
        </ul>
      </main>

      <AddDemarcheDialog
        open={adding}
        onClose={() => setAdding(false)}
        onOpen={(numero, declaree) => {
          setAdding(false);
          navigate(declaree ? demarchePath(numero) : `${demarchePath(numero)}/parametres`);
        }}
      />
    </>
  );
}
