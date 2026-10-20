// Encadré « Aides déjà accordées à ce SIRET » de l'onglet Demande (docs/SPEC-multi-demarches.md
// § C, C3) : dossiers acceptés du même SIRET dans toutes les démarches déclarées, sur les trois
// dernières années. Chargé à part, après la fiche, car il lit les dossiers de chaque démarche.
import { Link } from "react-router";
import { useApi } from "../api.ts";
import { dossierPath, formatMontant } from "../board.ts";
import { formatDate } from "../format.tsx";

type Aides = {
  siret: string | null;
  depuis?: string;
  aides?: {
    demarche: number;
    libelle: string;
    number: number;
    dateTraitement: string | null;
    millesime: number | null;
    lignes: { programme: string | null; accorde: number }[];
    accorde: number | null;
    aVerifier: boolean;
  }[];
  total?: number;
  sansMontant?: number;
  echecs?: { demarche: number; libelle: string; message: string }[];
};

export function AidesSiret({ numero, number }: { numero: string; number: number }) {
  const { data, error, loading } = useApi<Aides>(`/api/demarches/${numero}/dossiers/${number}/aides-siret`);
  if (data?.siret === null) return null;
  const aides = data?.aides ?? [];
  return (
    <section aria-busy={loading}>
      <h2>Aides déjà accordées à ce SIRET</h2>
      {error && <p className="notice notice--warn aides__notice" role="alert">{error}</p>}
      {loading && !data && <p className="muted">Recherche dans les démarches déclarées…</p>}
      {data?.echecs?.map((e) => (
        <p key={e.demarche} className="notice notice--warn aides__notice" role="status">
          {e.libelle} ({e.demarche}) non consultée : {e.message}
        </p>
      ))}
      {data && (
        <>
          <p className="muted">
            Dossiers acceptés depuis le {formatDate(data.depuis!)}, dans toutes les démarches déclarées (hors ce dossier).
          </p>
          {aides.length === 0 ? <p>Aucune aide accordée.</p> : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Démarche</th><th>Dossier</th><th>Accepté le</th><th>Régime</th><th className="num">Montant accordé</th></tr></thead>
                <tbody>
                  {aides.map((a) => (
                    <tr key={`${a.demarche}-${a.number}`}>
                      <td>{a.libelle}</td>
                      <td><Link to={dossierPath(String(a.demarche), a.number)} className="num">n° {a.number}</Link></td>
                      <td className="num">{a.dateTraitement ? formatDate(a.dateTraitement) : "—"}</td>
                      <td>{a.lignes.length ? a.lignes.map((l) => l.programme ?? "—").join(", ") : "—"}</td>
                      <td className="num">
                        {a.accorde !== null ? formatMontant(a.accorde) : <span className="muted">non renseigné</span>}
                        {a.aVerifier && <span className="badge badge--tag aides__verifier">à vérifier</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {aides.length > 0 && (
            <dl className="fields aides__total">
              <dt>Total accordé</dt>
              <dd className="num">
                {formatMontant(data.total!)}
                {data.sansMontant! > 0 && <span className="muted"> · {data.sansMontant} dossier{data.sansMontant! > 1 ? "s" : ""} sans montant renseigné</span>}
              </dd>
            </dl>
          )}
        </>
      )}
    </section>
  );
}
