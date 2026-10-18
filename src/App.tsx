import { Routes, Route } from "react-router";
import { Board } from "./pages/Board.tsx";
import { DossierDetail } from "./pages/DossierDetail.tsx";

export function App() {
  return (
    <Routes>
      {/* La fiche s'ouvre en panneau par-dessus le tableau ; son URL reste partageable. */}
      <Route path="/" element={<Board />}>
        <Route path="dossiers/:number" element={<DossierDetail />} />
      </Route>
    </Routes>
  );
}
