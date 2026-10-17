// Règles d'affichage du kanban (docs/SPEC-kanban.md § 4) : colonnes, ancienneté, filtres.

export type Card = {
  number: number;
  state: "en_construction" | "en_instruction" | "accepte" | "refuse" | "sans_suite";
  dateDepot: string;
  datePassageEnInstruction: string | null;
  dateTraitement: string | null;
  demandeur: { label: string; siret: string | null };
  objet: string | null;
  montant: number | null;
  instructeurs: { id: string; email: string }[];
  messages: number;
  avisDemandes: number;
  avisRecus: number;
  pjManquantes: number;
  labels: { name: string; color: string }[];
  annotations: number;
};

export type Kanban = {
  demarche: { number: number; title: string };
  me: { id: string; email: string } | null;
  delaiCibleJours: number;
  syncedAt: string;
  dossiers: Card[];
};

export const STATE_LABELS: Record<Card["state"], string> = {
  en_construction: "En construction",
  en_instruction: "En instruction",
  accepte: "Accepté",
  refuse: "Refusé",
  sans_suite: "Classé sans suite",
};

type Group = { state: Card["state"]; title?: string };
export type Column = { id: string; label: string; apiState: string; hint: string; dot: string; groups: Group[] };

export const COLUMNS: Column[] = [
  {
    id: "construction",
    label: "En construction",
    apiState: "en_construction",
    hint: "Déposés, encore modifiables par le demandeur.",
    dot: "var(--color-neutral-dot)",
    groups: [{ state: "en_construction" }],
  },
  {
    id: "instruction",
    label: "En instruction",
    apiState: "en_instruction",
    hint: "Gelés pour le demandeur. Avis, messages et annotations en cours.",
    dot: "var(--color-accent)",
    groups: [{ state: "en_instruction" }],
  },
  {
    id: "decision",
    label: "Décision",
    apiState: "terminé",
    hint: "Dossiers clos. Une décision peut être annulée en repassant le dossier en instruction.",
    dot: "var(--color-success)",
    groups: [
      { state: "accepte", title: "Accepté" },
      { state: "refuse", title: "Refusé" },
      { state: "sans_suite", title: "Classé sans suite" },
    ],
  },
];

const DAY = 24 * 60 * 60 * 1000;
const daysSince = (iso: string, now: number) => Math.max(0, Math.floor((now - new Date(iso).getTime()) / DAY));

// Ancienneté affichée sur la carte : depuis le dépôt en construction, depuis le passage
// en instruction ensuite (seul état soumis au délai cible), « Clos » une fois décidé.
export function age(card: Card, delaiCibleJours: number, now = Date.now()) {
  if (card.state === "en_construction") return { label: `J+${daysSince(card.dateDepot, now)}`, late: false };
  if (card.state === "en_instruction") {
    const days = daysSince(card.datePassageEnInstruction ?? card.dateDepot, now);
    return { label: `J+${days}`, late: days > delaiCibleJours };
  }
  return { label: "Clos", late: false };
}

// Initiales tirées de l'e-mail : l'API ne fournit pas le nom des instructeurs.
export function initials(email: string) {
  const parts = email.split("@")[0].split(/[._-]+/).filter(Boolean);
  return (parts.length > 1 ? parts[0][0] + parts[1][0] : (parts[0] ?? "?").slice(0, 2)).toUpperCase();
}

export type FilterId = "tous" | "moi" | "messages" | "avis" | "retard";

export function filters(k: Kanban) {
  const list: { id: FilterId; label: string; test: (c: Card) => boolean }[] = [
    { id: "tous", label: "Tous", test: () => true },
  ];
  if (k.me) list.push({ id: "moi", label: "Suivis par moi", test: (c) => c.instructeurs.some((i) => i.id === k.me!.id) });
  list.push(
    // L'API ne dit pas si un message est lu : on filtre sur les dossiers qui en ont.
    { id: "messages", label: "Avec messages", test: (c) => c.messages > 0 },
    { id: "avis", label: "Avis en attente", test: (c) => c.avisDemandes > 0 },
    { id: "retard", label: "Délai dépassé", test: (c) => age(c, k.delaiCibleJours).late },
  );
  return list;
}

export function matchesSearch(card: Card, query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    String(card.number).includes(q) ||
    card.demandeur.label.toLowerCase().includes(q) ||
    (card.demandeur.siret ?? "").includes(q.replace(/\s/g, ""))
  );
}

export const formatMontant = (n: number) =>
  new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);
