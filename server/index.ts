// Serveur intermédiaire : seul à détenir le jeton. Lecture seule, sauf si DN_ENABLE_MUTATIONS=1.
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { appendFile, mkdir } from "node:fs/promises";
import { DEMARCHE_NUMBER, DN_WEB_ORIGIN, MUTATIONS_ENABLED, TransitionError, changeDossierState, fetchDemarche, fetchDossier, fetchDossiers } from "./dn.ts";
import { demandeur, fetchKanban } from "./kanban.ts";

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
  if (!dossier) return c.json({ error: "Dossier introuvable" }, 404);
  return c.json({
    ...dossier,
    demandeurLabel: demandeur(dossier.demandeur).label,
    // Page instructeur du dossier dans DN (le numéro de démarche est l'identifiant de procédure).
    dnUrl: `${DN_WEB_ORIGIN}/procedures/${DEMARCHE_NUMBER}/dossiers/${dossier.number}`,
  });
});

// Journal local des changements d'état (docs/SPEC-kanban.md § 7) : une ligne JSON par
// tentative. Ni jeton ni texte de motivation, qui peut contenir des données personnelles.
const LOG_DIR = new URL("../logs/", import.meta.url);

async function logMutation(entry: Record<string, unknown>) {
  await mkdir(LOG_DIR, { recursive: true });
  await appendFile(new URL("mutations.log", LOG_DIR), JSON.stringify({ date: new Date().toISOString(), ...entry }) + "\n");
}

// Seule route d'écriture, désactivée par défaut (étape 3 de docs/SPEC-kanban.md).
// Le Content-Type JSON imposé empêche qu'un autre site déclenche cette route
// depuis le navigateur (requête « simple » sans preflight).

app.post("/dossiers/:number{[0-9]+}/state", async (c) => {
  if (!MUTATIONS_ENABLED) return c.json({ error: "Changements d'état désactivés (DN_ENABLE_MUTATIONS)" }, 403);
  if (!c.req.header("content-type")?.startsWith("application/json")) {
    return c.json({ error: "Content-Type application/json attendu" }, 415);
  }
  const number = Number(c.req.param("number"));
  const { state, motivation, disableNotification } = await c.req.json();
  const base = { dossier: number, vers: state, notificationUsager: !disableNotification };
  try {
    const { dossier, from } = await changeDossierState(number, state, { motivation, disableNotification });
    await logMutation({ ...base, depuis: from, resultat: "ok" });
    console.log(`Dossier ${dossier.number} : ${from} → ${dossier.state}`);
    return c.json(dossier);
  } catch (e) {
    await logMutation({ ...base, resultat: "erreur", message: (e as Error).message });
    if (e instanceof TransitionError) return c.json({ error: e.message }, 422);
    throw e;
  }
});

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, hostname: "127.0.0.1", port }, () =>
  console.log(`API sur http://127.0.0.1:${port}/api (changements d'état ${MUTATIONS_ENABLED ? "ACTIVÉS" : "désactivés"})`),
);
