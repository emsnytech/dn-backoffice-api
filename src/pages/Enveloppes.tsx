// Liste des enveloppes (docs/SPEC-multi-demarches.md § C). Pas de total transverse : le
// demandé non affecté d'un dossier peut figurer dans plusieurs enveloppes.
import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { useApi } from "../api.ts";
import { Jauge } from "../components/Jauge.tsx";
import { EnveloppeForm } from "../components/EnveloppeForm.tsx";
import { enveloppePath, type EnveloppeCalculee } from "../finances.ts";

export function Enveloppes() {
  const navigate = useNavigate();
  const api = useApi<{ enveloppes: EnveloppeCalculee[]; demarches: Record<string, string> }>("/api/enveloppes");
  // ?nouvelle=<numéro> : formulaire ouvert, démarche cochée.
  const [params] = useSearchParams();
  const nouvelle = Number(params.get("nouvelle")) || null;
  const [creating, setCreating] = useState(params.has("nouvelle"));
  const data = api.data;
  const demarches = data ? Object.entries(data.demarches).map(([numero, libelle]) => ({ numero: Number(numero), libelle })) : [];

  return (
    <main className="page page--wide">
      <Link to="/" className="back">← Toutes les démarches</Link>
      <div className="page__head">
        <h1>Enveloppes</h1>
        <button type="button" className="btn btn--secondary" onClick={api.reload} disabled={api.loading}>{api.loading ? "Synchronisation…" : "Synchroniser"}</button>
        {!creating && <button type="button" className="btn btn--primary" onClick={() => setCreating(true)}>Créer une enveloppe</button>}
      </div>
      {api.error && <p className="dialog__error" role="alert">{api.error}</p>}
      {creating && data && (
        <EnveloppeForm demarches={demarches} demarchesInitiales={nouvelle ? [nouvelle] : undefined} autres={data.enveloppes.map(({ id, libelle }) => ({ id, libelle }))}
          onSaved={(e) => navigate(enveloppePath(e.id))} onCancel={() => setCreating(false)} />
      )}
      {data && data.enveloppes.length === 0 && !creating && <p className="muted">Aucune enveloppe. Créez-en une, puis rattachez-y les démarches qui l'alimentent.</p>}
      <ul className="enveloppes">
        {data?.enveloppes.map((e) => (
          <li key={e.id} className="settings__section">
            <Jauge e={e} />
            <p className="field__hint">
              Alimentée par : {e.demarches.map((n) => data.demarches[n] ?? `n° ${n}`).join(", ")} · {e.indicateurs.dossiers} dossier{e.indicateurs.dossiers > 1 ? "s" : ""}
            </p>
          </li>
        ))}
      </ul>
    </main>
  );
}
