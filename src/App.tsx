import { Routes, Route, useLocation } from "react-router";
import { Header } from "@codegouvfr/react-dsfr/Header";
import { Footer } from "@codegouvfr/react-dsfr/Footer";
import { Kanban } from "./pages/Kanban.tsx";
import { DossiersList } from "./pages/DossiersList.tsx";
import { DossierDetail } from "./pages/DossierDetail.tsx";

export function App() {
  const { pathname } = useLocation();
  return (
    <>
      <Header
        brandTop={<>République<br />Française</>}
        serviceTitle="Back office"
        serviceTagline="Instruction des dossiers Démarche Numérique"
        homeLinkProps={{ to: "/", title: "Accueil – Back office" }}
        navigation={[
          { text: "Tableau d'instruction", linkProps: { to: "/" }, isActive: pathname === "/" },
          { text: "Liste des dossiers", linkProps: { to: "/liste" }, isActive: pathname === "/liste" },
        ]}
      />
      <main className="fr-container--fluid fr-px-4w fr-py-6w" style={{ minHeight: "60vh" }}>
        <Routes>
          <Route path="/" element={<Kanban />} />
          <Route path="/liste" element={<DossiersList />} />
          <Route path="/dossiers/:number" element={<DossierDetail />} />
        </Routes>
      </main>
      <Footer accessibility="non compliant" contentDescription="Back office indépendant connecté à l'API GraphQL de Démarche Numérique." />
    </>
  );
}
