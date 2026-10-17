import { useParams } from "react-router";
import { Alert } from "@codegouvfr/react-dsfr/Alert";
import { Breadcrumb } from "@codegouvfr/react-dsfr/Breadcrumb";
import { useApi } from "../api.ts";
import { EVENTS, StateBadge, demandeurName, formatDate } from "../format.tsx";

// Types de champs sans valeur saisie : affichés comme structure, pas comme réponse.
const LAYOUT_TYPES = new Set(["HeaderSectionChampDescriptor", "ExplicationChampDescriptor"]);

function Champs({ champs, descriptors }: { champs: any[]; descriptors: any[] }) {
  const typeById = new Map(descriptors.map((d) => [d.id, d.__typename]));
  return (
    <dl>
      {champs.map((c) => {
        const type = typeById.get(c.champDescriptorId);
        if (type === "HeaderSectionChampDescriptor") return <h3 key={c.id} className="fr-h5 fr-mt-4w">{c.label}</h3>;
        if (LAYOUT_TYPES.has(type)) return null;
        const value = c.values ? c.values.join(", ") : c.stringValue;
        return (
          <div key={c.id} className="fr-mb-2w">
            <dt className="fr-text--bold fr-mb-0">{c.label}</dt>
            <dd className="fr-ml-0">{value || <em className="fr-text-mention--grey">Non renseigné</em>}</dd>
          </div>
        );
      })}
    </dl>
  );
}

export function DossierDetail() {
  const { number } = useParams();
  const demarche = useApi<any>("/api/demarche");
  const dossier = useApi<any>(`/api/dossiers/${number}`);
  const d = dossier.data;
  const rev = demarche.data?.activeRevision;

  return (
    <>
      <Breadcrumb
        currentPageLabel={`Dossier n° ${number}`}
        homeLinkProps={{ to: "/" }}
        segments={[]}
      />
      {(dossier.loading || demarche.loading) && <p>Chargement du dossier…</p>}
      {dossier.error && <Alert severity="error" title="Impossible de charger le dossier" description={dossier.error} small />}
      {d && rev && (
        <>
          <h1 className="fr-mb-1w">Dossier n° {d.number}</h1>
          <p><StateBadge state={d.state} /></p>
          <ul className="fr-text--sm">
            <li>Demandeur : {demandeurName(d)} ({d.usager.email})</li>
            <li>Groupe instructeur : {d.groupeInstructeur.label}</li>
            <li>Déposé le {formatDate(d.dateDepot)}, modifié le {formatDate(d.dateDerniereModification)}</li>
            {d.dateTraitement && <li>Traité le {formatDate(d.dateTraitement)}</li>}
          </ul>
          {d.motivation && <Alert severity="info" title="Motivation" description={d.motivation} small className="fr-mb-4w" />}

          <h2>Formulaire</h2>
          <Champs champs={d.champs} descriptors={rev.champDescriptors} />

          <h2 className="fr-mt-6w">Annotations privées</h2>
          {d.annotations.length ? <Champs champs={d.annotations} descriptors={rev.annotationDescriptors} /> : <p>Aucune annotation.</p>}

          <h2 className="fr-mt-6w">Historique</h2>
          <ul>
            {d.traitements.map((t: any) => (
              <li key={t.id}>
                {formatDate(t.dateTraitement)} — {EVENTS[t.event] ?? t.event}
                {t.emailAgentTraitant && ` par ${t.emailAgentTraitant}`}
              </li>
            ))}
          </ul>

          <h2 className="fr-mt-6w">Messagerie ({d.messages.length})</h2>
          {d.messages.map((m: any) => (
            <div key={m.id} className="fr-card fr-p-2w fr-mb-2w">
              <p className="fr-text--xs fr-mb-1v">{m.email} — {formatDate(m.createdAt)}</p>
              <p className="fr-mb-0" style={{ whiteSpace: "pre-line" }}>{m.body}</p>
            </div>
          ))}
        </>
      )}
    </>
  );
}
