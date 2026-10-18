// Fiche dossier provisoire, en lecture seule. Elle sera remplacée par le panneau
// latéral de l'étape 2 (docs/SPEC-kanban.md § 5).
import { Link, useParams } from "react-router";
import { useApi } from "../api.ts";
import { GeoMap } from "../GeoMap.tsx";
import { MessageBody } from "../components/MessageBody.tsx";
import { EVENTS, StateBadge, demandeurName, formatDate } from "../format.tsx";

// Types de champs sans valeur saisie : affichés comme structure, pas comme réponse.
const LAYOUT_TYPES = new Set(["HeaderSectionChampDescriptor", "ExplicationChampDescriptor"]);

const GEO_SOURCES: Record<string, string> = {
  selection_utilisateur: "Tracé",
  cadastre: "Parcelle cadastrale",
};

function GeoAreas({ areas }: { areas: any[] }) {
  if (!areas.length) return null;
  return (
    <>
      <GeoMap areas={areas} />
      <ul>
        {areas.map((a) => (
          <li key={a.id}>
            {GEO_SOURCES[a.source] ?? a.source} ({a.geometry.type}){a.description && ` : ${a.description}`}
          </li>
        ))}
      </ul>
    </>
  );
}

function Champs({ champs, descriptors }: { champs: any[]; descriptors: any[] }) {
  const typeById = new Map(descriptors.map((d) => [d.id, d.__typename]));
  const rows = [];
  for (const c of champs) {
    const type = typeById.get(c.champDescriptorId);
    if (type === "HeaderSectionChampDescriptor") {
      rows.push(<h3 key={c.id} style={{ gridColumn: "1 / -1" }}>{c.label}</h3>);
      continue;
    }
    if (LAYOUT_TYPES.has(type)) continue;
    const value = c.geoAreas ? <GeoAreas areas={c.geoAreas} /> : c.values ? c.values.join(", ") : c.stringValue;
    rows.push(
      <div key={c.id} style={{ display: "contents" }}>
        <dt>{c.label}</dt>
        <dd>{value || <em className="muted">Non renseigné</em>}</dd>
      </div>,
    );
  }
  return <dl className="fields panel">{rows}</dl>;
}

export function DossierDetail() {
  const { number } = useParams();
  const demarche = useApi<any>("/api/demarche");
  const dossier = useApi<any>(`/api/dossiers/${number}`);
  const d = dossier.data;
  const rev = demarche.data?.activeRevision;

  return (
    <main className="page">
      <Link to="/" className="back">← Retour au tableau</Link>
      {(dossier.loading || demarche.loading) && !d && <p>Chargement du dossier…</p>}
      {dossier.error && <p className="notice" role="alert" style={{ margin: 0 }}>Impossible de charger le dossier : {dossier.error}</p>}
      {d && rev && (
        <>
          <p className="num" style={{ margin: "8px 0 0", fontWeight: 600, color: "var(--admin)" }}>N° {d.number}</p>
          <h1>{demandeurName(d)}</h1>
          <StateBadge state={d.state} />
          <p className="muted">
            Déposé le {formatDate(d.dateDepot)} · modifié le {formatDate(d.dateDerniereModification)}
            {d.dateTraitement && ` · traité le ${formatDate(d.dateTraitement)}`} · groupe {d.groupeInstructeur.label}
          </p>
          {d.motivation && <p className="panel"><strong>Motivation :</strong> {d.motivation}</p>}

          <h2>Formulaire</h2>
          <Champs champs={d.champs} descriptors={rev.champDescriptors} />

          <h2>Annotations privées</h2>
          {d.annotations.length ? <Champs champs={d.annotations} descriptors={rev.annotationDescriptors} /> : <p className="muted">Aucune annotation.</p>}

          <h2>Messagerie · {d.messages.length}</h2>
          {d.messages.map((m: any) => (
            <div key={m.id} className="message">
              <p className="message__meta">{m.email} — {formatDate(m.createdAt)}</p>
              <MessageBody body={m.body} />
            </div>
          ))}

          <h2>Historique</h2>
          <ul>
            {d.traitements.map((t: any) => (
              <li key={t.id}>
                {formatDate(t.dateTraitement)} — {EVENTS[t.event] ?? t.event}
                {t.emailAgentTraitant && ` par ${t.emailAgentTraitant}`}
              </li>
            ))}
          </ul>
        </>
      )}
    </main>
  );
}
