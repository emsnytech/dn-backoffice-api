import { useSearchParams } from "react-router";
import { Link } from "react-router";
import { Alert } from "@codegouvfr/react-dsfr/Alert";
import { Select } from "@codegouvfr/react-dsfr/Select";
import { Table } from "@codegouvfr/react-dsfr/Table";
import { useApi } from "../api.ts";
import { RefreshButton } from "../RefreshButton.tsx";
import { STATES, StateBadge, demandeurName, formatDate } from "../format.tsx";

export function DossiersList() {
  const [params, setParams] = useSearchParams();
  const state = params.get("state") ?? "";
  const demarche = useApi<any>("/api/demarche");
  const dossiers = useApi<any[]>(`/api/dossiers${state ? `?state=${state}` : ""}`);

  return (
    <>
      <h1>{demarche.data ? demarche.data.title : "Dossiers"}</h1>
      {demarche.data && <p className="fr-text--sm">Démarche n° {demarche.data.number}</p>}

      <Select
        label="Filtrer par état"
        className="fr-col-12 fr-col-md-4"
        nativeSelectProps={{
          value: state,
          onChange: (e) => setParams(e.target.value ? { state: e.target.value } : {}),
        }}
      >
        <option value="">Tous les états</option>
        {Object.entries(STATES).map(([value, { label }]) => (
          <option key={value} value={value}>{label}</option>
        ))}
      </Select>

      <RefreshButton onClick={dossiers.reload} loading={dossiers.loading} loadedAt={dossiers.loadedAt} />
      {dossiers.loading && !dossiers.data && <p>Chargement des dossiers…</p>}
      {dossiers.error && <Alert severity="error" title="Impossible de charger les dossiers" description={dossiers.error} small />}
      {dossiers.data && dossiers.data.length === 0 && <p>Aucun dossier{state && " dans cet état"}.</p>}
      {dossiers.data && dossiers.data.length > 0 && (
        <Table
          caption={`${dossiers.data.length} dossier${dossiers.data.length > 1 ? "s" : ""}`}
          headers={["N°", "Demandeur", "État", "Déposé le", "Modifié le"]}
          data={dossiers.data.map((d) => [
            <Link to={`/dossiers/${d.number}`}>{d.number}</Link>,
            demandeurName(d),
            <StateBadge state={d.state} />,
            formatDate(d.dateDepot),
            formatDate(d.dateDerniereModification),
          ])}
        />
      )}
    </>
  );
}
