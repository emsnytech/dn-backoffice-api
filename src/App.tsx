import { useEffect, useState } from "react";
import { Navigate, Routes, Route, useParams } from "react-router";
import { Board } from "./pages/Board.tsx";
import { DossierDetail } from "./pages/DossierDetail.tsx";
import { Home } from "./pages/Home.tsx";
import { Parametres } from "./pages/Parametres.tsx";
import { Enveloppes } from "./pages/Enveloppes.tsx";
import { Enveloppe } from "./pages/Enveloppe.tsx";
import { dossierPath } from "./board.ts";

// key={numero} : changer de démarche remonte le kanban avec un état vierge.
function BoardRoute() {
  const { numero } = useParams();
  return <Board key={numero} numero={numero!} />;
}

// Anciennes adresses /dossiers/:n (avant le multi-démarches) : redirection vers la démarche du dossier.
function LegacyDossier() {
  const { number } = useParams();
  const [target, setTarget] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    fetch(`/api/dossiers/${number}/demarche`)
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((body) => setTarget(dossierPath(body.numero, number!)))
      .catch(() => setFailed(true));
  }, [number]);
  if (target) return <Navigate to={target} replace />;
  return <main className="page"><p className={failed ? "dialog__error" : "muted"} role="status">{failed ? `Dossier n° ${number} introuvable dans les démarches déclarées.` : "Recherche du dossier…"}</p></main>;
}

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      {/* La fiche s'ouvre en panneau par-dessus le tableau ; son URL reste partageable. */}
      <Route path="/demarches/:numero" element={<BoardRoute />}>
        <Route path="dossiers/:number" element={<DossierDetail />} />
      </Route>
      <Route path="/demarches/:numero/parametres" element={<Parametres />} />
      <Route path="/dossiers/:number" element={<LegacyDossier />} />
      <Route path="/enveloppes" element={<Enveloppes />} />
      <Route path="/enveloppes/:id" element={<Enveloppe />} />
    </Routes>
  );
}
