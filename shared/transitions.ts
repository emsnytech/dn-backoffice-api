// Changements d'état autorisés par Démarche Numérique, et mutation GraphQL associée.
// Partagé entre le serveur (validation) et le front (cibles de dépôt du kanban).

export type DossierState = "en_construction" | "en_instruction" | "accepte" | "refuse" | "sans_suite";

export const COLUMNS: DossierState[] = ["en_construction", "en_instruction", "accepte", "refuse", "sans_suite"];

const reopen = { en_instruction: "dossierRepasserEnInstruction" } as const;

export const TRANSITIONS: Record<DossierState, Partial<Record<DossierState, string>>> = {
  en_construction: { en_instruction: "dossierPasserEnInstruction" },
  en_instruction: {
    en_construction: "dossierRepasserEnConstruction",
    accepte: "dossierAccepter",
    refuse: "dossierRefuser",
    sans_suite: "dossierClasserSansSuite",
  },
  accepte: reopen,
  refuse: reopen,
  sans_suite: reopen,
};

// États finaux pour lesquels une motivation est possible, et ceux où elle est obligatoire.
export const MOTIVATION_ALLOWED = new Set<DossierState>(["accepte", "refuse", "sans_suite"]);
export const MOTIVATION_REQUIRED = new Set<DossierState>(["refuse", "sans_suite"]);

export const canTransition = (from: string, to: string) =>
  Boolean(TRANSITIONS[from as DossierState]?.[to as DossierState]);
