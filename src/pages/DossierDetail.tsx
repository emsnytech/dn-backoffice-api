// Fiche dossier en panneau latéral (docs/SPEC-kanban.md § 5, maquette docs/maquettes/Dossier.dc.html).
// Ouverte par-dessus le tableau (route imbriquée), elle lit le dossier via notre serveur ;
// les décisions passent par la boîte de confirmation du tableau, sans logique de mutation propre.
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useOutletContext, useParams } from "react-router";
import { useApi } from "../api.ts";
import { GeoMap } from "../GeoMap.tsx";
import { MessageBody } from "../components/MessageBody.tsx";
import { EVENTS, StateBadge, formatDate } from "../format.tsx";
import { age, demarchePath, dossierPath, formatMontant, type Card, type Kanban } from "../board.ts";
import { TRANSITIONS, type DossierState } from "../../shared/transitions.ts";

export type PanelContext = {
  numero: string;
  kanban?: Kanban;
  askMove: (card: Card, target: DossierState) => void;
  // Incrémenté par le tableau après chaque changement d'état : la fiche se relit.
  version: number;
};

// Types de champs sans valeur saisie : affichés comme structure, pas comme réponse.
const LAYOUT_TYPES = new Set(["HeaderSectionChampDescriptor", "ExplicationChampDescriptor"]);
const PJ = "PieceJustificativeChamp";

const GEO_SOURCES: Record<string, string> = {
  selection_utilisateur: "Tracé",
  cadastre: "Parcelle cadastrale",
};

const TABS = ["demande", "annotations", "messagerie", "avis", "historique"] as const;
type Tab = (typeof TABS)[number];

// Libellé du bouton de chaque transition, selon l'état de départ.
function actionLabel(from: string, to: DossierState) {
  switch (to) {
    case "en_instruction":
      return from === "en_construction" ? "Passer en instruction" : "Repasser en instruction";
    case "en_construction":
      return "Repasser en construction (demander une correction)";
    case "accepte":
      return "Accepter";
    case "refuse":
      return "Refuser";
    case "sans_suite":
      return "Sans suite";
  }
}

const sizeFormat = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 });
function formatSize(bytes: string | number | null | undefined) {
  const n = Number(bytes ?? 0);
  if (!n) return "";
  if (n < 1024 * 1024) return `${sizeFormat.format(n / 1024)} Ko`;
  return `${sizeFormat.format(n / 1024 / 1024)} Mo`;
}

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
    const value = c.rows ? (
      <Repetition rows={c.rows} descriptors={descriptors.find((x) => x.id === c.champDescriptorId)?.champDescriptors ?? []} />
    ) : c.geoAreas ? <GeoAreas areas={c.geoAreas} /> : c.files ? c.files.map((f: any) => f.filename).join(", ") : c.values ? c.values.join(", ") : c.stringValue;
    rows.push(
      <div key={c.id} style={{ display: "contents" }}>
        <dt>{c.label}</dt>
        <dd>{value || <em className="muted">Non renseigné</em>}</dd>
      </div>,
    );
  }
  return rows.length ? <dl className="fields">{rows}</dl> : <p className="muted">Aucun champ.</p>;
}

// Bloc répétable : une sous-liste de champs par ligne saisie par le demandeur.
function Repetition({ rows, descriptors }: { rows: any[]; descriptors: any[] }) {
  if (!rows.length) return null;
  return (
    <ol className="repetition">
      {rows.map((r) => (
        <li key={r.id}>
          <Champs champs={r.champs} descriptors={descriptors} />
        </li>
      ))}
    </ol>
  );
}

function PiecesJustificatives({ champs, descriptors }: { champs: any[]; descriptors: any[] }) {
  const required = new Map(descriptors.map((d) => [d.id, Boolean(d.required)]));
  const pj = champs.filter((c) => c.__typename === PJ);
  if (!pj.length) return <p className="muted">Aucune pièce justificative demandée.</p>;
  return (
    <ul className="pj-list">
      {pj.map((c) => {
        const files: any[] = c.files ?? [];
        const status = files.length ? "ok" : required.get(c.champDescriptorId) ? "missing" : "optional";
        return (
          <li key={c.id}>
            <span>
              {c.label}
              {files.map((f, i) => (
                <small key={i}>{f.filename}{formatSize(f.byteSizeBigInt) && ` · ${formatSize(f.byteSizeBigInt)}`}</small>
              ))}
            </span>
            <span className={`pj-status pj-status--${status}`}>
              {status === "ok" ? "Fournie" : status === "missing" ? "Manquante" : "Non fournie (facultative)"}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function AvisItem({ a }: { a: any }) {
  const answered = Boolean(a.reponse || a.questionAnswer !== null);
  return (
    <div className={answered ? "avis avis--answered" : "avis"}>
      <p className="avis__meta">
        Demandé le {formatDate(a.dateQuestion)}
        {a.expert?.email && ` à ${a.expert.email}`}
        {a.claimant?.email && ` par ${a.claimant.email}`}
      </p>
      <p>{a.questionLabel || a.question}</p>
      {answered ? (
        <p>
          <strong>Réponse du {formatDate(a.dateReponse)} :</strong>{" "}
          {a.questionAnswer !== null && <>{a.questionAnswer ? "Oui" : "Non"}. </>}
          {a.reponse}
        </p>
      ) : (
        <p className="avis__status">Sans réponse</p>
      )}
    </div>
  );
}

export function DossierDetail() {
  const { number } = useParams();
  const navigate = useNavigate();
  const { numero, kanban, askMove, version } = useOutletContext<PanelContext>();
  const demarche = useApi<any>(`/api/demarches/${numero}`);
  const dossier = useApi<any>(`/api/demarches/${numero}/dossiers/${number}?v=${version}`);
  const [tab, setTab] = useState<Tab>("demande");
  const titleRef = useRef<HTMLHeadingElement>(null);
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const d = dossier.data?.number === Number(number) ? dossier.data : undefined;
  const rev = demarche.data?.activeRevision;

  // Fermeture : retour au tableau, focus rendu à la carte (ou à la ligne) du dossier.
  function close() {
    navigate(demarchePath(numero));
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`a[href="${dossierPath(numero, number!)}"]`)?.focus());
  }

  useEffect(() => {
    setTab("demande");
  }, [number]);

  useEffect(() => {
    if (d) titleRef.current?.focus();
  }, [d?.number]);

  // Échap ferme la fiche, sauf si la boîte de confirmation est ouverte (elle gère sa propre touche).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !document.querySelector("dialog[open]")) close();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  function onTabKey(e: React.KeyboardEvent) {
    const i = TABS.indexOf(tab);
    const next = e.key === "ArrowRight" ? TABS[(i + 1) % TABS.length] : e.key === "ArrowLeft" ? TABS[(i - 1 + TABS.length) % TABS.length] : null;
    if (!next) return;
    e.preventDefault();
    setTab(next);
    tabRefs.current[next]?.focus();
  }

  // Carte du tableau pour la boîte de confirmation ; à défaut, reconstruite depuis la fiche.
  const card: Card | undefined = d
    ? (kanban?.dossiers.find((c) => c.number === d.number) ??
      ({ number: d.number, state: d.state, demandeur: { label: d.demandeurLabel, siret: d.demandeur?.siret ?? null } } as Card))
    : undefined;
  const a = d ? age(d as Card, kanban?.delaiCibleJours ?? 45) : null;
  const moves = d ? (Object.keys(TRANSITIONS[d.state as DossierState] ?? {}) as DossierState[]) : [];
  const isDecision = (m: DossierState) => m === "accepte" || m === "refuse" || m === "sans_suite";
  const decisions = moves.filter(isDecision);
  const others = moves.filter((m) => !isDecision(m));
  const canMove = Boolean(kanban?.mutationsEnabled);
  const champs = d ? d.champs.filter((c: any) => c.__typename !== PJ) : [];
  const tabLabels: Record<Tab, string> = {
    demande: "Demande",
    annotations: "Annotations",
    messagerie: d ? `Messagerie · ${d.messages.length}` : "Messagerie",
    avis: d ? `Avis · ${d.avis.length}` : "Avis",
    historique: "Historique",
  };

  return (
    <>
      <div className="panel-scrim" onClick={close} aria-hidden="true" />
      <aside className="dossier-panel" aria-labelledby="dossier-title">
        <div className="dossier-panel__head">
          <div className="dossier-panel__nav">
            <Link to={demarchePath(numero)} onClick={(e) => { e.preventDefault(); close(); }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg>
              Retour au tableau
            </Link>
            {d?.dnUrl && (
              <a href={d.dnUrl} target="_blank" rel="noopener noreferrer">
                Ouvrir dans DN
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 4h6v6" /><path d="M20 4 10 14" /><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" /></svg>
                <span className="sr-only"> (nouvel onglet)</span>
              </a>
            )}
          </div>

          {dossier.error && <p className="dialog__error" role="alert">Impossible de charger le dossier : {dossier.error}</p>}
          {!d && !dossier.error && <p className="muted" role="status">Chargement du dossier n° {number}…</p>}

          {d && a && (
            <>
              <div className="dossier-panel__meta">
                <span className="card__num">N° {d.number}</span>
                <StateBadge state={d.state} />
                {a.label !== "Clos" && (
                  <span className={a.late ? "card__age card__age--late" : "card__age"}>{a.label}{a.late && " · délai dépassé"}</span>
                )}
              </div>
              <h1 id="dossier-title" ref={titleRef} tabIndex={-1}>
                {d.demandeurLabel}
                {card?.objet && <> — {card.objet}</>}
              </h1>
              <p className="dossier-panel__sub">
                Déposé le {formatDate(d.dateDepot)}
                {d.instructeurs.length
                  ? ` · suivi par ${d.instructeurs.map((i: any) => i.email).join(", ")}`
                  : ` · groupe ${d.groupeInstructeur.label}`}
              </p>
            </>
          )}
        </div>

        {d && rev && (
          <>
            <div className="tabs" role="tablist" aria-label="Sections du dossier" onKeyDown={onTabKey}>
              {TABS.map((t) => (
                <button
                  key={t}
                  ref={(el) => { tabRefs.current[t] = el; }}
                  type="button"
                  role="tab"
                  id={`tab-${t}`}
                  aria-selected={tab === t}
                  aria-controls={`tabpanel-${t}`}
                  tabIndex={tab === t ? 0 : -1}
                  onClick={() => setTab(t)}
                >
                  {tabLabels[t]}
                </button>
              ))}
            </div>

            <div className="dossier-panel__body" role="tabpanel" id={`tabpanel-${tab}`} aria-labelledby={`tab-${tab}`} tabIndex={0}>
              {tab === "demande" && (
                <>
                  {d.motivation && (
                    <section>
                      <h2>Motivation de la décision</h2>
                      <p>{d.motivation}</p>
                    </section>
                  )}
                  <section>
                    <h2>Demandeur</h2>
                    <dl className="fields">
                      <dt>{d.demandeur?.__typename === "PersonnePhysique" ? "Nom" : "Raison sociale"}</dt>
                      <dd>{d.demandeurLabel}</dd>
                      {d.demandeur?.siret && (<><dt>SIRET</dt><dd className="num">{d.demandeur.siret}</dd></>)}
                      <dt>Compte usager</dt>
                      <dd>{d.usager?.email ?? "—"}</dd>
                      {card?.montant !== null && card?.montant !== undefined && (<><dt>Montant demandé</dt><dd className="num">{formatMontant(card.montant)}</dd></>)}
                    </dl>
                  </section>
                  <section>
                    <h2>Champs du formulaire</h2>
                    <Champs champs={champs} descriptors={rev.champDescriptors} />
                  </section>
                  <section>
                    <h2>Pièces justificatives</h2>
                    <PiecesJustificatives champs={d.champs} descriptors={rev.champDescriptors} />
                  </section>
                  {d.avis.length > 0 && (
                    <section>
                      <h2>Avis externe</h2>
                      <div className="stack">{d.avis.map((x: any) => <AvisItem key={x.id} a={x} />)}</div>
                    </section>
                  )}
                </>
              )}

              {tab === "annotations" && (
                <section>
                  <h2>Annotations privées</h2>
                  {d.annotations.length ? <Champs champs={d.annotations} descriptors={rev.annotationDescriptors} /> : <p className="muted">Aucune annotation.</p>}
                </section>
              )}

              {tab === "messagerie" && (
                <section>
                  <h2>Messagerie</h2>
                  {d.messages.length ? (
                    <div className="stack">
                      {d.messages.map((m: any) => (
                        <div key={m.id} className="message">
                          <p className="message__meta">{m.email} — {formatDate(m.createdAt)}</p>
                          <MessageBody body={m.body} />
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="muted">Aucun message.</p>
                  )}
                </section>
              )}

              {tab === "avis" && (
                <section>
                  <h2>Avis d'experts</h2>
                  {d.avis.length ? <div className="stack">{d.avis.map((x: any) => <AvisItem key={x.id} a={x} />)}</div> : <p className="muted">Aucun avis demandé.</p>}
                </section>
              )}

              {tab === "historique" && (
                <section>
                  <h2>Historique</h2>
                  <ul className="history">
                    {d.traitements.map((t: any) => (
                      <li key={t.id}>
                        <span className="num">{formatDate(t.dateTraitement)}</span> — {EVENTS[t.event] ?? t.event}
                        {t.emailAgentTraitant && ` par ${t.emailAgentTraitant}`}
                        {t.motivation && <p className="muted">{t.motivation}</p>}
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>

            {card && moves.length > 0 && (
              <div className="dossier-panel__foot">
                <p>
                  {canMove
                    ? "Décider : chaque bouton demande confirmation, puis applique le changement dans Démarche Numérique."
                    : "Changements d'état désactivés sur ce serveur (DN_ENABLE_MUTATIONS)."}
                </p>
                {decisions.length > 0 && (
                  <div className="decisions">
                    {decisions.map((m) => (
                      <button
                        key={m}
                        type="button"
                        disabled={!canMove}
                        className={m === "accepte" ? "btn btn--success" : m === "refuse" ? "btn btn--danger-outline" : "btn btn--secondary"}
                        onClick={() => askMove(card, m)}
                      >
                        {actionLabel(d.state, m)}
                      </button>
                    ))}
                  </div>
                )}
                {others.map((m) => (
                  <button
                    key={m}
                    type="button"
                    disabled={!canMove}
                    className={decisions.length ? "btn btn--link" : "btn btn--primary"}
                    onClick={() => askMove(card, m)}
                  >
                    {actionLabel(d.state, m)}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </aside>
    </>
  );
}
