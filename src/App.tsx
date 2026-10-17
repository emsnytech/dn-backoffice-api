import { Routes, Route } from "react-router";
import { Board } from "./pages/Board.tsx";
import { DossierDetail } from "./pages/DossierDetail.tsx";

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Board />} />
      <Route path="/dossiers/:number" element={<DossierDetail />} />
    </Routes>
  );
}
