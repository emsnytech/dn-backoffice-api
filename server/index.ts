// Serveur intermédiaire : seul à détenir le jeton. Lecture seule, sauf si DN_ENABLE_MUTATIONS=1.
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { TransitionError, changeDossierState, fetchDemarche, fetchDossier, fetchDossiers } from "./dn.ts";
import { fetchKanban } from "./kanban.ts";

const app = new Hono().basePath("/api");

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: "Erreur lors de l'appel à l'API Démarche Numérique" }, 502);
});

app.get("/kanban", async (c) => c.json(await fetchKanban()));

app.get("/demarche", async (c) => c.json(await fetchDemarche()));

app.get("/dossiers", async (c) => {
  const state = c.req.query("state");
  const dossiers = await fetchDossiers();
  return c.json(state ? dossiers.filter((d) => d.state === state) : dossiers);
});

app.get("/dossiers/:number{[0-9]+}", async (c) => {
  const dossier = await fetchDossier(Number(c.req.param("number")));
  return dossier ? c.json(dossier) : c.json({ error: "Dossier introuvable" }, 404);
});

// Seule route d'écriture, désactivée par défaut (étape 3 de docs/SPEC-kanban.md).
// Le Content-Type JSON imposé empêche qu'un autre site déclenche cette route
// depuis le navigateur (requête « simple » sans preflight).
const MUTATIONS_ENABLED = process.env.DN_ENABLE_MUTATIONS === "1";

app.post("/dossiers/:number{[0-9]+}/state", async (c) => {
  if (!MUTATIONS_ENABLED) return c.json({ error: "Changements d'état désactivés (DN_ENABLE_MUTATIONS)" }, 403);
  if (!c.req.header("content-type")?.startsWith("application/json")) {
    return c.json({ error: "Content-Type application/json attendu" }, 415);
  }
  const { state, motivation, disableNotification } = await c.req.json();
  try {
    const dossier = await changeDossierState(Number(c.req.param("number")), state, { motivation, disableNotification });
    console.log(`Dossier ${dossier.number} → ${dossier.state}`);
    return c.json(dossier);
  } catch (e) {
    if (e instanceof TransitionError) return c.json({ error: e.message }, 422);
    throw e;
  }
});

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, hostname: "127.0.0.1", port }, () =>
  console.log(`API sur http://127.0.0.1:${port}/api (changements d'état ${MUTATIONS_ENABLED ? "ACTIVÉS" : "désactivés"})`),
);
