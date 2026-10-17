import { Routes, Route } from "react-router";
import { Header } from "@codegouvfr/react-dsfr/Header";
import { Footer } from "@codegouvfr/react-dsfr/Footer";
import { DossiersList } from "./pages/DossiersList.tsx";
import { DossierDetail } from "./pages/DossierDetail.tsx";

export function App() {
  return (
    <>
      <Header
        brandTop={<>République<br />Française</>}
        serviceTitle="Back office"
        serviceTagline="Instruction des dossiers Démarche Numérique"
        homeLinkProps={{ to: "/", title: "Accueil – Back office" }}
      />
      <main className="fr-container fr-py-6w" style={{ minHeight: "60vh" }}>
        <Routes>
          <Route path="/" element={<DossiersList />} />
          <Route path="/dossiers/:number" element={<DossierDetail />} />
        </Routes>
      </main>
      <Footer accessibility="non compliant" contentDescription="Back office indépendant connecté à l'API GraphQL de Démarche Numérique." />
    </>
  );
}
