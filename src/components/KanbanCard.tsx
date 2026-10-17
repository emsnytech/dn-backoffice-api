import { Link } from "react-router";
import { age, formatMontant, initials, type Card } from "../board.ts";

// Couleurs des étiquettes DN (LabelColorEnum) : fond clair, texte foncé.
const LABEL_COLORS: Record<string, [string, string]> = {
  green_tilleul_verveine: ["#fbf6c8", "#5a5200"],
  green_bourgeon: ["#e6f4d7", "#2f5a12"],
  green_emeraude: ["#d9f2e3", "#1b5e3b"],
  green_menthe: ["#d6f2ee", "#14564d"],
  blue_ecume: ["#e3e9fa", "#2a3c7a"],
  purple_glycine: ["#f2e3f5", "#5e2463"],
  pink_macaron: ["#fce4e6", "#7a2532"],
  yellow_tournesol: ["#fdf0c4", "#6a4a00"],
  brown_cafe_creme: ["#f4ead9", "#5c4320"],
  beige_gris_galet: ["#efede7", "#3a3e49"],
};

const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;

export function KanbanCard({ card, delaiCibleJours }: { card: Card; delaiCibleJours: number }) {
  const a = age(card, delaiCibleJours);
  const agents = card.instructeurs.map((i) => i.email);

  return (
    <Link to={`/dossiers/${card.number}`} className="card">
      <div className="card__row">
        <span className="card__num">N° {card.number}</span>
        <span className={a.late ? "card__age card__age--late" : "card__age"}>
          {a.label}
          {a.late && <span className="sr-only"> (délai dépassé)</span>}
        </span>
      </div>
      <div>
        <div className="card__who">{card.demandeur.label}</div>
        {card.objet && <div className="card__what">{card.objet}</div>}
      </div>
      <div className="card__row">
        <div className="card__badges">
          {card.messages > 0 && <span className="badge badge--msg">{plural(card.messages, "message", "messages")}</span>}
          {card.avisDemandes > 0 && <span className="badge badge--avis">Avis demandé</span>}
          {card.avisDemandes === 0 && card.avisRecus > 0 && <span className="badge badge--avis">Avis reçu</span>}
          {card.pjManquantes > 0 && <span className="badge badge--pj">{plural(card.pjManquantes, "PJ manquante", "PJ manquantes")}</span>}
          {card.labels.map((l) => {
            const [bg, fg] = LABEL_COLORS[l.color] ?? LABEL_COLORS.beige_gris_galet;
            return (
              <span key={l.name} className="badge" style={{ background: bg, color: fg }}>{l.name}</span>
            );
          })}
        </div>
        {agents.length > 0 && (
          <span className="card__agent" title={agents.join(", ")}>
            {initials(agents[0])}
            <span className="sr-only">, suivi par {agents.join(", ")}</span>
          </span>
        )}
      </div>
      {card.montant !== null && (
        <div className="card__amount">
          <span>Montant demandé</span>
          <span>{formatMontant(card.montant)}</span>
        </div>
      )}
    </Link>
  );
}
