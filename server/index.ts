// Serveur intermédiaire : seul à détenir le jeton, n'expose que des routes en lecture.
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { fetchDemarche, fetchDossier, fetchDossiers } from "./dn.ts";

const app = new Hono().basePath("/api");

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: "Erreur lors de l'appel à l'API Démarche Numérique" }, 502);
});

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

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, hostname: "127.0.0.1", port }, () =>
  console.log(`API sur http://127.0.0.1:${port}/api`),
);
