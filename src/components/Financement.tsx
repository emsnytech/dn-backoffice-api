// Données financières d'un dossier, dans l'onglet Demande de la fiche (docs/SPEC-multi-demarches.md
// § C) : plan de financement, taux d'aide publique, lignes de financement, motif de répartition.
import { STATUTS_LIGNE, formatCentimes, formatPct, type DossierFinance } from "../finances.ts";

export function Financement({ f }: { f: DossierFinance }) {
  const part = (m: number | null) => (m !== null && f.coutTotal ? formatPct(Math.round((m / f.coutTotal) * 1000) / 10) : "—");
  return (
    <section>
      <h2>Financement</h2>
      {f.anomalies.length > 0 && (
        <ul className="notice notice--warn finance__anomalies" role="status">
          {f.anomalies.map((a, i) => <li key={i}>{a.message}{a.grave ? "" : " (non bloquant)"}</li>)}
        </ul>
      )}

      {f.plan && (
        <>
          <h3>Plan de financement</h3>
          {f.plan.lignes.length === 0 ? <p className="muted">Plan de financement vide.</p> : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Financeur</th><th className="num">Montant</th><th>Statut</th><th className="num">Part du coût total</th></tr></thead>
                <tbody>
                  {f.plan.lignes.map((r, i) => (
                    <tr key={i}>
                      <td>{r.financeur ?? "—"}{r.public && <span className="badge badge--tag finance__public">public</span>}</td>
                      <td className="num">{formatCentimes(r.montant)}</td>
                      <td>{r.statut ?? "—"}</td>
                      <td className="num">{part(r.montant)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <dl className="fields">
            <dt>Total des aides publiques</dt><dd className="num">{formatCentimes(f.plan.totalPublic)}</dd>
            <dt>Total du plan</dt><dd className="num">{formatCentimes(f.plan.total)}</dd>
            <dt>Coût total</dt><dd className="num">{formatCentimes(f.coutTotal)}</dd>
            <dt>Taux d'aide publique cumulé prévisionnel</dt><dd className="num">{formatPct(f.taux.cumule)}</dd>
            {f.taux.obtenues !== null && <><dt>dont aides obtenues</dt><dd className="num">{formatPct(f.taux.obtenues)}</dd></>}
            <dt>Taux après décision</dt>
            <dd className="num">{f.taux.apresDecision !== null ? formatPct(f.taux.apresDecision) : <span className="muted">aucun montant accordé renseigné</span>}</dd>
          </dl>
        </>
      )}
      {!f.plan && f.coutTotal !== null && (
        <dl className="fields"><dt>Coût total</dt><dd className="num">{formatCentimes(f.coutTotal)}</dd></dl>
      )}

      {f.lignes.length > 0 && (
        <>
          <h3>Lignes de financement</h3>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Programme</th><th className="num">Demandé</th><th className="num">Accordé</th><th className="num">Assiette</th><th className="num">Taux</th><th>N° d'EJ</th><th>Statut</th></tr></thead>
              <tbody>
                {f.lignes.map((l) => (
                  <tr key={l.index}>
                    <td>{l.programme ?? "—"}</td>
                    <td className="num">{formatCentimes(l.demande)}</td>
                    <td className="num">{formatCentimes(l.accorde)}</td>
                    <td className="num">{formatCentimes(l.assiette)}</td>
                    <td className="num">{formatPct(l.taux)}</td>
                    <td>{l.numeroEJ ?? "—"}</td>
                    <td>{STATUTS_LIGNE[l.statut]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {f.nonAffecte.map((n, i) => (
            <p key={i} className="field__hint">
              Demandé non affecté : {formatCentimes(n.montant)} ({n.financeur}), faute de programme souhaité correspondant à l'une des lignes.
            </p>
          ))}
          <p className="field__hint">
            Millésime {f.millesime ?? "illisible"}{f.millesimeParDefaut ? " (par défaut : année de dépôt)" : ""}
            {f.programmeSouhaite && <> · programme souhaité : {f.programmeSouhaite}</>}
          </p>
        </>
      )}
      {f.motifRepartition && (
        <>
          <h3>Motif de répartition</h3>
          <p className="finance__motif">{f.motifRepartition}</p>
        </>
      )}
    </section>
  );
}
