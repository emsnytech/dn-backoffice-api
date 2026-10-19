// Serveur intermédiaire : seul à détenir le jeton. Il n'accède qu'aux démarches déclarées
// dans config/demarches/ (docs/SPEC-multi-demarches.md § A). Lecture seule, sauf si
// DN_ENABLE_MUTATIONS=1 et que la démarche autorise les changements d'état.
import { Hono, type Context, type Next } from "hono";
import { serve } from "@hono/node-server";
import { appendFile, mkdir } from "node:fs/promises";
import {
  DN_WEB_ORIGIN,
  MUTATIONS_ENABLED,
  TransitionError,
  changeDossierState,
  checkDemarche,
  fetchDemarche,
  fetchDossier,
  fetchDossierDemarche,
} from "./dn.ts";
import { demandeur, fetchKanban, fetchSummary } from "./kanban.ts";
import { introuvables, proposition } from "./parametrage.ts";
import {
  ConfigError,
  getConfig,
  isNumero,
  listConfigs,
  migrateLegacyConfig,
  parseConfig,
  saveConfig,
  type DemarcheConfig,
} from "./config.ts";

type Env = { Variables: { config: DemarcheConfig } };
const app = new Hono<Env>().basePath("/api");

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: "Erreur lors de l'appel à l'API Démarche Numérique" }, 502);
});

// Les écritures n'acceptent que du JSON : un autre site ne peut pas les déclencher depuis
// le navigateur par une requête « simple », sans preflight.
const requireJson = (c: Context) =>
  c.req.header("content-type")?.startsWith("application/json") ? null : c.json({ error: "Content-Type application/json attendu" }, 415);

// Démarche complète (révision publiée comprise), ou réponse d'erreur avec le message de DN.
async function demarcheOrError(c: Context, numero: number) {
  try {
    return { demarche: await fetchDemarche(numero) };
  } catch (e: any) {
    if (!e.code || !e.dnMessage) throw e;
    return { error: c.json({ error: e.dnMessage, code: e.code }, e.code === "not_found" ? 404 : 403) };
  }
}

// Toute route d'une démarche non déclarée répond 404 (sauf verifier, proposition et parametres en PUT).
async function declared(c: Context<Env>, next: Next) {
  const config = await getConfig(Number(c.req.param("numero")));
  if (!config) return c.json({ error: "Démarche non déclarée dans ce back office" }, 404);
  c.set("config", config);
  await next();
}

// Accueil : démarches déclarées et résumé. Une démarche inaccessible n'empêche pas les autres.
// ?resume=0 : liste seule, sans appel à DN (sélecteur de démarche du kanban).
app.get("/demarches", async (c) => {
  const configs = await listConfigs();
  if (c.req.query("resume") === "0") {
    return c.json({ mutationsGlobal: MUTATIONS_ENABLED, demarches: configs.map(({ numero, libelle, mutations }) => ({ numero, libelle, mutations })) });
  }
  const summaries = await Promise.allSettled(configs.map(fetchSummary));
  return c.json({
    mutationsGlobal: MUTATIONS_ENABLED,
    demarches: configs.map((config, i) => {
      const s = summaries[i];
      const base = { numero: config.numero, libelle: config.libelle, mutations: config.mutations };
      if (s.status === "fulfilled") return { ...base, accessible: true, ...s.value };
      const e = s.reason as any;
      if (!e?.dnMessage) console.error(e);
      return { ...base, accessible: false, error: e?.dnMessage ?? "Erreur lors de l'appel à l'API Démarche Numérique" };
    }),
  });
});

// Accès du jeton à une démarche, qu'elle soit déclarée ou non (ajout d'une démarche).
app.get("/demarches/:numero{[0-9]+}/verifier", async (c) => {
  const numero = Number(c.req.param("numero"));
  if (!isNumero(numero)) return c.json({ error: "Numéro invalide" }, 400);
  const result = await checkDemarche(numero);
  if (!result.ok) return c.json({ error: result.message, code: result.code }, result.code === "not_found" ? 404 : 403);
  return c.json({ ...result.demarche, declaree: Boolean(await getConfig(numero)) });
});

app.get("/demarches/:numero{[0-9]+}", declared, async (c) => c.json(await fetchDemarche(c.get("config").numero)));

app.get("/demarches/:numero{[0-9]+}/kanban", declared, async (c) => c.json(await fetchKanban(c.get("config"))));

app.get("/demarches/:numero{[0-9]+}/parametres", declared, (c) => c.json(c.get("config")));

// Fiche de paramétrage (§ B), déclarée ou non : champs candidats par rôle, paramétrage
// proposé avec ses raisons (jamais enregistré ici), fiche actuelle et champs disparus.
app.get("/demarches/:numero{[0-9]+}/proposition", async (c) => {
  const numero = Number(c.req.param("numero"));
  if (!isNumero(numero)) return c.json({ error: "Numéro invalide" }, 400);
  const { demarche, error } = await demarcheOrError(c, numero);
  if (error) return error;
  const actuel = await getConfig(numero);
  const rev = demarche.activeRevision;
  return c.json({
    demarche: {
      number: demarche.number,
      title: demarche.title,
      state: demarche.state,
      datePublication: rev.datePublication,
      nbChamps: rev.champDescriptors.length,
      nbAnnotations: rev.annotationDescriptors.length,
      // Page d'administration de la démarche dans DN, pour y ajouter une annotation.
      dnAdminUrl: `${DN_WEB_ORIGIN}/admin/procedures/${numero}`,
    },
    mutationsGlobal: MUTATIONS_ENABLED,
    ...proposition(demarche),
    actuel,
    introuvables: actuel ? introuvables(actuel, rev) : [],
  });
});

// Déclare ou modifie une démarche. Le serveur relit la démarche sur DN avant d'écrire :
// accès du jeton, et champs désignés présents dans la révision publiée avec le bon type.
app.put("/demarches/:numero{[0-9]+}/parametres", async (c) => {
  const notJson = requireJson(c);
  if (notJson) return notJson;
  const numero = Number(c.req.param("numero"));
  if (!isNumero(numero)) return c.json({ error: "Numéro invalide" }, 400);
  const { demarche, error } = await demarcheOrError(c, numero);
  if (error) return error;
  const previous = await getConfig(numero);
  try {
    const config = parseConfig(numero, await c.req.json(), demarche.activeRevision);
    await saveConfig(config);
    console.log(`Paramétrage de la démarche ${numero} ${previous ? "modifié" : "créé"}`);
    return c.json(config, previous ? 200 : 201);
  } catch (e) {
    if (e instanceof ConfigError) return c.json({ error: e.message }, 422);
    throw e;
  }
});

app.get("/demarches/:numero{[0-9]+}/dossiers/:number{[0-9]+}", declared, async (c) => {
  const { numero } = c.get("config");
  const dossier = await fetchDossier(numero, Number(c.req.param("number")));
  if (!dossier) return c.json({ error: "Dossier introuvable dans cette démarche" }, 404);
  return c.json({
    ...dossier,
    demandeurLabel: demandeur(dossier.demandeur).label,
    // Page instructeur du dossier dans DN (le numéro de démarche est l'identifiant de procédure).
    dnUrl: `${DN_WEB_ORIGIN}/procedures/${numero}/dossiers/${dossier.number}`,
  });
});

// Anciennes adresses /dossiers/:n : démarche du dossier, si elle est déclarée.
app.get("/dossiers/:number{[0-9]+}/demarche", async (c) => {
  const numero = await fetchDossierDemarche(Number(c.req.param("number")));
  if (!numero || !(await getConfig(numero))) return c.json({ error: "Dossier introuvable" }, 404);
  return c.json({ numero });
});

// Journal local des changements d'état (docs/SPEC-kanban.md § 7) : une ligne JSON par
// tentative. Ni jeton ni texte de motivation, qui peut contenir des données personnelles.
const LOG_DIR = new URL("../logs/", import.meta.url);

async function logMutation(entry: Record<string, unknown>) {
  await mkdir(LOG_DIR, { recursive: true });
  await appendFile(new URL("mutations.log", LOG_DIR), JSON.stringify({ date: new Date().toISOString(), ...entry }) + "\n");
}

// Seule écriture vers DN : changement d'état, si l'interrupteur général et la démarche
// l'autorisent tous les deux.
app.post("/demarches/:numero{[0-9]+}/dossiers/:number{[0-9]+}/state", declared, async (c) => {
  const config = c.get("config");
  if (!MUTATIONS_ENABLED) return c.json({ error: "Changements d'état désactivés sur ce serveur (DN_ENABLE_MUTATIONS)" }, 403);
  if (!config.mutations) return c.json({ error: "Changements d'état non autorisés pour cette démarche (voir ses paramètres)" }, 403);
  const notJson = requireJson(c);
  if (notJson) return notJson;
  const number = Number(c.req.param("number"));
  const { state, motivation, disableNotification } = await c.req.json();
  const base = { demarche: config.numero, dossier: number, vers: state, notificationUsager: !disableNotification };
  try {
    const { dossier, from } = await changeDossierState(config.numero, number, state, { motivation, disableNotification });
    await logMutation({ ...base, depuis: from, resultat: "ok" });
    console.log(`Démarche ${config.numero}, dossier ${dossier.number} : ${from} → ${dossier.state}`);
    return c.json(dossier);
  } catch (e) {
    await logMutation({ ...base, resultat: "erreur", message: (e as Error).message });
    if (e instanceof TransitionError) return c.json({ error: e.message }, 422);
    throw e;
  }
});

const migrated = await migrateLegacyConfig(fetchDemarche);
if (migrated) console.log(`Migration : démarche ${migrated.numero} déclarée dans config/demarches/${migrated.numero}.json`);

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, hostname: "127.0.0.1", port }, async () => {
  const configs = await listConfigs();
  console.log(`API sur http://127.0.0.1:${port}/api (changements d'état ${MUTATIONS_ENABLED ? "ACTIVÉS" : "désactivés"})`);
  console.log(`Démarches déclarées : ${configs.map((d) => `${d.numero}${d.mutations ? "" : " (lecture seule)"}`).join(", ") || "aucune"}`);
});
