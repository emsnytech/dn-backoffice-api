import { Button } from "@codegouvfr/react-dsfr/Button";

const timeFormat = new Intl.DateTimeFormat("fr-FR", { timeStyle: "medium" });

// Bouton « Actualiser » : relit les données depuis Démarche Numérique.
export function RefreshButton({ onClick, loading, loadedAt }: { onClick: () => void; loading: boolean; loadedAt?: Date }) {
  return (
    <div className="fr-mb-3w" style={{ display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
      <Button iconId="fr-icon-refresh-line" priority="secondary" size="small" onClick={onClick} disabled={loading}>
        {loading ? "Actualisation…" : "Actualiser"}
      </Button>
      {loadedAt && (
        <span className="fr-text--xs fr-mb-0 fr-text-mention--grey" aria-live="polite">
          Données de Démarche Numérique à {timeFormat.format(loadedAt)}
        </span>
      )}
    </div>
  );
}
