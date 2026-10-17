import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Link } from "react-router";
import { startReactDsfr } from "@codegouvfr/react-dsfr/spa";
import { App } from "./App.tsx";

startReactDsfr({ defaultColorScheme: "system", Link });

declare module "@codegouvfr/react-dsfr/spa" {
  interface RegisterLink {
    Link: typeof Link;
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
