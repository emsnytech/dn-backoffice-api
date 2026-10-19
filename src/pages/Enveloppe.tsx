// Détail d'une enveloppe (docs/SPEC-multi-demarches.md § C) : indicateurs, dossiers imputés,
// anomalies, modification et suppression.
import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router";
import { useApi } from "../api.ts";
import { STATE_LABELS, dossierPath } from "../board.ts";
import { Jauge } from "../components/Jauge.tsx";
import { EnveloppeForm } from "../components/EnveloppeForm.tsx";
import { STATUTS_LIGNE, formatCentimes, type Anomalie, type EnveloppeCalculee } from "../finances.ts";

type Detail = EnveloppeCalculee & { demarchesLibelles: Record<string, string>; autres: { id: string; libelle: string }[] };

function AnomalieItem({ a }: { a: Anomalie }) {
  return (
    <li>
      {a.dossier ? <Link to={dossierPath(a.demarche!, a.dossier)}>Dossier n° {a.dossier}</Link> : a.demarche ? <>Démarche n° {a.demarche}</> : <>Enveloppe</>}
      {" "}: {a.message}
    </li>
  );
}

export function Enveloppe() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { hash } = useLocation();
  const api = useApi<Detail>(`/api/enveloppes/${id}`);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const e = api.data;

  useEffect(() => {
    if (e && hash) document.getElementById(hash.slice(1))?.scrollIntoView();
  }, [e, hash]);

  async function remove() {
    setError(null);
    const res = await fetch(`/api/enveloppes/${id}`, { method: "DELETE" });
    if (res.ok) return navigate("/enveloppes");
    setError((await res.json()).error ?? `Erreur ${res.status}`);
  }

  const graves = e?.anomalies.filter((a) => a.grave) ?? [];
  const nonBloquantes = e?.anomalies.filter((a) => !a.grave) ?? [];
  const demarches = e ? Object.entries(e.demarchesLibelles).map(([numero, libelle]) => ({ numero: Number(numero), libelle })) : [];

  return (
    <main className="page page--wide">
      <Link to="/enveloppes" className="back">← Toutes les enveloppes</Link>
      {api.error && <p className="dialog__error" role="alert">{api.error}</p>}
      {e && (
        <>
          <div className="page__head">
            <h1>{e.libelle}</h1>
            <button type="button" className="btn btn--secondary" onClick={api.reload} disabled={api.loading}>{api.loading ? "Synchronisation…" : "Synchroniser"}</button>
            {!editing && <button type="button" className="btn btn--secondary" onClick={() => setEditing(true)}>Modifier</button>}
          </div>

          {editing ? (
            <EnveloppeForm id={e.id} initial={e} demarches={demarches} autres={e.autres}
              onSaved={() => { setEditing(false); api.reload(); }} onCancel={() => setEditing(false)} />
          ) : (
            <div className="settings">
              <section className="settings__section"><Jauge e={e} /></section>

              <section className="settings__section" aria-labelledby="s-autres">
                <h2 id="s-autres">Autres indicateurs</h2>
                <dl className="fields">
                  <dt>Régime</dt><dd>{e.programme ?? "Tous régimes"}</dd>
                  <dt>Demandé</dt><dd className="num">{formatCentimes(e.indicateurs.demande)}</dd>
                  <dt>Demandé non affecté</dt>
                  <dd className="num">
                    {formatCentimes(e.indicateurs.nonAffecte)}
                    {e.indicateurs.dossiersNonAffecte.length > 0 && (
                      <span className="field__hint"> — dossiers {e.indicateurs.dossiersNonAffecte.map((n, i) => (
                        <span key={n}>{i > 0 && ", "}n° {n}</span>
                      ))}. Montant d'un financeur partagé par plusieurs régimes que le programme souhaité n'a pas permis d'affecter ; il n'entre ni dans le demandé ni dans le reste.</span>
                    )}
                  </dd>
                  <dt>Dossiers imputés</dt><dd className="num">{e.indicateurs.dossiers}</dd>
                  <dt>Millésime par défaut</dt>
                  <dd className="num">{e.indicateurs.millesimeParDefaut} dossier{e.indicateurs.millesimeParDefaut > 1 ? "s" : ""} (année de dépôt, faute de millésime renseigné)</dd>
                  <dt>Alimentée par</dt><dd>{e.demarches.map((n) => e.demarchesLibelles[n] ?? `n° ${n}`).join(", ")}</dd>
                  {e.parent && <><dt>Enveloppe mère</dt><dd><Link to={`/enveloppes/${e.parent}`}>{e.autres.find((a) => a.id === e.parent)?.libelle ?? e.parent}</Link></dd></>}
                </dl>
              </section>

              <section className="settings__section" id="anomalies" aria-labelledby="s-anomalies" tabIndex={-1}>
                <h2 id="s-anomalies">Anomalies</h2>
                {graves.length === 0 && nonBloquantes.length === 0 && <p className="muted">Aucune anomalie.</p>}
                {graves.length > 0 && <ul className="anomalies anomalies--grave">{graves.map((a, i) => <AnomalieItem key={i} a={a} />)}</ul>}
                {nonBloquantes.length > 0 && (
                  <>
                    <h3>Non bloquantes (rien n'est retiré du calcul)</h3>
                    <ul className="anomalies">{nonBloquantes.map((a, i) => <AnomalieItem key={i} a={a} />)}</ul>
                  </>
                )}
              </section>

              <section className="settings__section" aria-labelledby="s-dossiers">
                <h2 id="s-dossiers">Dossiers imputés</h2>
                {e.imputations.length === 0 ? <p className="muted">Aucun dossier imputé.</p> : (
                  <div className="table-wrap">
                    <table className="table">
                      <thead><tr><th>Dossier</th><th>Démarche</th><th>Régime</th><th>Statut</th><th className="num">Demandé</th><th className="num">Accordé</th><th>Engagé</th></tr></thead>
                      <tbody>
                        {e.imputations.map((x) => (
                          <tr key={`${x.demarche}-${x.dossier}-${x.ligne}`}>
                            <td><Link to={dossierPath(x.demarche, x.dossier)}>n° {x.dossier}</Link></td>
                            <td>{e.demarchesLibelles[x.demarche] ?? x.demarche}</td>
                            <td>{x.programme ?? "—"}</td>
                            <td>{STATUTS_LIGNE[x.statut]}</td>
                            <td className="num">{formatCentimes(x.demande)}</td>
                            <td className="num">{formatCentimes(x.accorde)}</td>
                            <td>{x.engage ? "Oui" : "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              <section className="settings__section" aria-labelledby="s-suppr">
                <h2 id="s-suppr">Supprimer l'enveloppe</h2>
                <p className="field__hint">Seul le fichier de l'enveloppe est supprimé ; les dossiers et leurs annotations restent dans DN.</p>
                {confirmDelete ? (
                  <div className="settings__actions">
                    <span>Supprimer définitivement « {e.libelle} » ?</span>
                    <button type="button" className="btn btn--danger" onClick={remove}>Supprimer</button>
                    <button type="button" className="btn btn--secondary" onClick={() => setConfirmDelete(false)}>Annuler</button>
                  </div>
                ) : (
                  <button type="button" className="btn btn--danger-outline" onClick={() => setConfirmDelete(true)}>Supprimer…</button>
                )}
                {error && <p className="dialog__error" role="alert">{error}</p>}
              </section>
              <p className="field__hint">États DN pris en compte : {STATE_LABELS.en_construction}, {STATE_LABELS.en_instruction}, {STATE_LABELS.accepte}. Les dossiers refusés ou classés sans suite sont hors calcul.</p>
            </div>
          )}
        </>
      )}
    </main>
  );
}
