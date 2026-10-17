import { Badge } from "@codegouvfr/react-dsfr/Badge";
import type { AlertProps } from "@codegouvfr/react-dsfr/Alert";

export const STATES: Record<string, { label: string; severity?: AlertProps.Severity | "new" }> = {
  en_construction: { label: "En construction", severity: "info" },
  en_instruction: { label: "En instruction", severity: "new" },
  accepte: { label: "Accepté", severity: "success" },
  refuse: { label: "Refusé", severity: "error" },
  sans_suite: { label: "Classé sans suite" },
};

export function StateBadge({ state }: { state: string }) {
  const s = STATES[state] ?? { label: state };
  return <Badge small severity={s.severity} noIcon>{s.label}</Badge>;
}

// Événements de l'historique (Traitement.event)
export const EVENTS: Record<string, string> = {
  depose: "Déposé",
  passe_en_construction: "Repassé en construction",
  repasse_en_construction: "Repassé en construction",
  passe_en_instruction: "Passé en instruction",
  passe_en_instruction_automatiquement: "Passé en instruction automatiquement",
  repasse_en_instruction: "Repassé en instruction",
  accepte: "Accepté",
  accepte_automatiquement: "Accepté automatiquement",
  refuse: "Refusé",
  refuse_automatiquement: "Refusé automatiquement",
  classe_sans_suite: "Classé sans suite",
};

const dateFormat = new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short" });
export const formatDate = (iso?: string | null) => (iso ? dateFormat.format(new Date(iso)) : "—");

export function demandeurName(d: any) {
  const dem = d.demandeur;
  if (dem?.__typename === "PersonnePhysique") return [dem.prenom, dem.nom].filter(Boolean).join(" ") || d.usager.email;
  if (dem?.__typename === "PersonneMorale") return `SIRET ${dem.siret}`;
  return d.usager?.email ?? "—";
}
