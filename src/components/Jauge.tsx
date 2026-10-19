// Jauge d'une enveloppe (docs/SPEC-multi-demarches.md § C) : accepté (plein) et programmé
// (clair) sur le montant. Le texte donne les mêmes informations : la couleur ne porte
// jamais seule le sens.
import { Link } from "react-router";
import { enveloppePath, formatCentimes, type EnveloppeCalculee } from "../finances.ts";

export function Jauge({ e, compact = false }: { e: EnveloppeCalculee; compact?: boolean }) {
  const i = e.indicateurs;
  const base = Math.max(i.montant, i.accepte + i.programme, 1);
  const accepte = (i.accepte / base) * 100;
  const programme = (i.programme / base) * 100;
  const pct = i.montant > 0 ? Math.round((i.accepte / i.montant) * 1000) / 10 : null;
  const depasse = i.reste < 0;
  const depassePrev = !depasse && i.restePrevisionnel < 0;
  const graves = e.anomalies.filter((a) => a.grave).length;
  const nonBloquantes = e.anomalies.length - graves;
  const resume =
    `Accepté ${formatCentimes(i.accepte)}${pct !== null ? ` (${pct.toLocaleString("fr-FR")} %)` : ""}, ` +
    `programmé ${formatCentimes(i.programme)}, reste ${formatCentimes(i.reste)} sur ${formatCentimes(i.montant)}`;

  return (
    <div className={compact ? "jauge jauge--compact" : "jauge"}>
      <div className="jauge__head">
        <Link to={enveloppePath(e.id)} className="jauge__title">{e.libelle}</Link>
        <span className="muted">Millésime {e.millesime}</span>
        {e.anomalies.length > 0 && (
          <Link to={`${enveloppePath(e.id)}#anomalies`} className="badge badge--warn">
            {graves > 0 && `${graves} anomalie${graves > 1 ? "s" : ""}`}
            {graves > 0 && nonBloquantes > 0 && " · "}
            {nonBloquantes > 0 && `${nonBloquantes} non bloquante${nonBloquantes > 1 ? "s" : ""}`}
          </Link>
        )}
      </div>
      <div className={depasse ? "jauge__bar jauge__bar--bad" : "jauge__bar"} role="img" aria-label={resume}>
        <span className="jauge__accepte" style={{ width: `${accepte}%` }} />
        <span className="jauge__programme" style={{ width: `${programme}%` }} />
      </div>
      {compact ? (
        <p className="jauge__text">{resume}</p>
      ) : (
        <dl className="jauge__figures">
          <div><dt>Enveloppe</dt><dd>{formatCentimes(i.montant)}</dd></div>
          <div><dt>Accepté</dt><dd>{formatCentimes(i.accepte)}{pct !== null && <small> {pct.toLocaleString("fr-FR")} %</small>}</dd></div>
          <div><dt>Programmé</dt><dd>{formatCentimes(i.programme)}</dd></div>
          <div><dt>Engagé</dt><dd>{formatCentimes(i.engage)}</dd></div>
          <div className={depasse ? "jauge__bad" : undefined}><dt>Reste</dt><dd>{formatCentimes(i.reste)}</dd></div>
          <div className={depassePrev ? "jauge__warn" : undefined}><dt>Reste prévisionnel</dt><dd>{formatCentimes(i.restePrevisionnel)}</dd></div>
        </dl>
      )}
      {depasse && <p className="jauge__alert" role="alert">Enveloppe dépassée de {formatCentimes(-i.reste)}.</p>}
      {depassePrev && <p className="jauge__alert jauge__alert--warn">Les montants programmés dépassent le reste de {formatCentimes(-i.restePrevisionnel)}.</p>}
    </div>
  );
}
