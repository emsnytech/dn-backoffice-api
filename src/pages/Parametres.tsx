// Paramètres d'une démarche, en lecture seule pour l'étape A. La fiche de paramétrage
// modifiable, avec propositions automatiques, vient à l'étape B (docs/SPEC-multi-demarches.md § B).
import { Link, useParams } from "react-router";
import { useApi } from "../api.ts";
import { demarchePath } from "../board.ts";
import { formatDate } from "../format.tsx";

type ChampRef = { id: string; libelle: string } | null;
type Config = {
  numero: number;
  libelle: string;
  mutations: boolean;
  delaiCibleJours: number;
  champs: { objet: ChampRef; montantDemande: ChampRef };
  valideLe: string | null;
};

const champ = (ref: ChampRef) => (ref ? ref.libelle : <em className="muted">Aucun</em>);

export function Parametres() {
  const { numero } = useParams();
  const config = useApi<Config>(`/api/demarches/${numero}/parametres`);
  const c = config.data;

  return (
    <main className="page">
      <Link to={demarchePath(numero!)} className="back">← Retour au kanban</Link>
      <h1>Paramètres de la démarche n° {numero}</h1>
      {config.error && <p className="dialog__error" role="alert">{config.error}</p>}
      {c && (
        <>
          <p className="muted">La modification de ces réglages arrive avec la fiche de paramétrage (étape B).</p>
          <dl className="fields panel">
            <dt>Libellé court</dt><dd>{c.libelle}</dd>
            <dt>Objet sur les cartes</dt><dd>{champ(c.champs.objet)}</dd>
            <dt>Montant demandé</dt><dd>{champ(c.champs.montantDemande)}</dd>
            <dt>Délai cible</dt><dd>{c.delaiCibleJours} jours</dd>
            <dt>Changements d'état</dt><dd>{c.mutations ? "Autorisés (si DN_ENABLE_MUTATIONS=1 sur le serveur)" : "Non autorisés : lecture seule"}</dd>
            <dt>Paramétrage validé</dt><dd>{c.valideLe ? formatDate(c.valideLe) : <em className="muted">Pas encore (réglages par défaut)</em>}</dd>
          </dl>
        </>
      )}
    </main>
  );
}
