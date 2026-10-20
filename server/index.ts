// Serveur intermédiaire : seul à détenir le jeton. Il n'accède qu'aux démarches déclarées
// dans config/demarches/ (docs/SPEC-multi-demarches.md § A). Lecture seule, sauf si
// DN_ENABLE_MUTATIONS=1 et que la démarche autorise les changements d'état.
import { Hono, type Context, type Next } from "hono";
import { serve } from "@hono/node-server";
import { appendFile, mkdir } from "node:fs/promises";
import {
  AnnotationError,
  DN_WEB_ORIGIN,
  MUTATIONS_ENABLED,
  TransitionError,
  changeDossierState,
  checkDemarche,
  fetchDemarche,
  fetchDossier,
  fetchDossierDemarche,
} from "./dn.ts";
import { demandeur, fetchDemarcheDossiers, fetchKanban, fetchSummary } from "./kanban.ts";
import { computeDossier } from "./finances.ts";
import { aidesSiret, normaliserSiret } from "./aides.ts";
import { DecisionError, appliquerDecision, vueDecision } from "./decision.ts";
import {
  computeEnveloppes,
  deleteEnveloppe,
  getEnveloppe,
  isEnveloppeId,
  listEnveloppes,
  newEnveloppeId,
  parseEnveloppe,
  programmesDe,
  saveEnveloppe,
  unionProgrammes,
  type DemarcheDossiers,
  type Enveloppe,
} from "./enveloppes.ts";
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
  const config = c.get("config");
  const f = config.finances;
  // Bloc de décision modifiable (C2b) : identifiants des champs, options et types des sous-champs.
  const decision = f.blocDecision ? vueDecision(dossier, config, (await fetchDemarche(numero)).activeRevision) : null;
  return c.json({
    ...dossier,
    demandeurLabel: demandeur(dossier.demandeur).label,
    // Données financières (§ C) : plan de financement, bloc de décision, taux d'aide publique, anomalies.
    finance: f.blocDecision || f.planFinancement || f.coutTotal ? computeDossier(dossier, config) : null,
    decision: decision && { ...decision, saisie: MUTATIONS_ENABLED && config.annotations },
    // Page instructeur du dossier dans DN (le numéro de démarche est l'identifiant de procédure).
    dnUrl: `${DN_WEB_ORIGIN}/procedures/${numero}/dossiers/${dossier.number}`,
  });
});

// Aides déjà accordées au SIRET du dossier (C3), chargées à part pour ne pas ralentir la fiche.
app.get("/demarches/:numero{[0-9]+}/dossiers/:number{[0-9]+}/aides-siret", declared, async (c) => {
  const { numero } = c.get("config");
  const number = Number(c.req.param("number"));
  const dossier = await fetchDossier(numero, number);
  if (!dossier) return c.json({ error: "Dossier introuvable dans cette démarche" }, 404);
  const siret = normaliserSiret(dossier.demandeur?.siret);
  if (!siret) return c.json({ siret: null });
  return c.json(await aidesSiret(siret, { demarche: numero, number }));
});

// --- Enveloppes (§ C) --------------------------------------------------------

// Dossiers des démarches qui alimentent les enveloppes. Une démarche inaccessible est
// signalée en anomalie dans ses enveloppes, sans bloquer les autres.
async function calculerEnveloppes(enveloppes: Enveloppe[]) {
  const numeros = [...new Set(enveloppes.flatMap((e) => e.demarches))];
  const sources = new Map<number, DemarcheDossiers>();
  const echecs: { numero: number; message: string }[] = [];
  await Promise.all(
    numeros.map(async (numero) => {
      const config = await getConfig(numero);
      if (!config) return echecs.push({ numero, message: "démarche non déclarée" });
      try {
        const { demarche, nodes } = await fetchDemarcheDossiers(numero);
        const rev = demarche.activeRevision;
        sources.set(numero, { config, introuvables: introuvables(config, rev), programmes: programmesDe(config, rev), dossiers: nodes });
      } catch (e: any) {
        if (!e.dnMessage) console.error(e);
        echecs.push({ numero, message: e.dnMessage ?? "erreur lors de l'appel à l'API Démarche Numérique" });
      }
    }),
  );
  const calculees = computeEnveloppes(enveloppes, sources);
  for (const { numero, message } of echecs) {
    for (const e of calculees.filter((x) => x.demarches.includes(numero))) {
      e.anomalies.push({ code: "demarche_inaccessible", message: `Démarche ${numero} non comptée : ${message}`, grave: true, demarche: numero, dossier: null });
    }
  }
  return calculees;
}

const libelles = async () => Object.fromEntries((await listConfigs()).map((d) => [d.numero, d.libelle]));

app.get("/enveloppes", async (c) => {
  const calculees = await calculerEnveloppes(await listEnveloppes());
  return c.json({ enveloppes: calculees, demarches: await libelles() });
});

// Liste fermée des programmes d'enveloppe (§ C) : régimes d'aide des démarches choisies.
async function programmesPour(numeros: number[]) {
  const listes = await Promise.all(
    numeros.map(async (n) => {
      const config = await getConfig(n);
      return config?.finances.blocDecision ? programmesDe(config, (await fetchDemarche(n)).activeRevision) : [];
    }),
  );
  return unionProgrammes(listes);
}

app.get("/enveloppes/programmes", async (c) => {
  const numeros = (c.req.query("demarches") ?? "").split(",").map(Number).filter(isNumero);
  const declared = new Set((await listConfigs()).map((d) => d.numero));
  return c.json({ programmes: await programmesPour(numeros.filter((n) => declared.has(n))) });
});

app.get("/enveloppes/:id", async (c) => {
  const all = await listEnveloppes();
  const e = (await calculerEnveloppes(all)).find((x) => x.id === c.req.param("id"));
  if (!e) return c.json({ error: "Enveloppe introuvable" }, 404);
  return c.json({ ...e, demarchesLibelles: await libelles(), autres: all.filter((x) => x.id !== e.id).map(({ id, libelle }) => ({ id, libelle })) });
});

async function writeEnveloppe(c: Context, id: string | null) {
  const notJson = requireJson(c);
  if (notJson) return notJson;
  const all = await listEnveloppes();
  const declared = (await listConfigs()).map((d) => d.numero);
  const body = await c.req.json();
  try {
    const choisies = Array.isArray(body?.demarches) ? body.demarches.map(Number).filter((n: number) => declared.includes(n)) : [];
    const programmes = body?.programme ? await programmesPour(choisies) : [];
    const e = parseEnveloppe(id ?? newEnveloppeId(String(body?.libelle ?? ""), all), body, declared, all.filter((x) => x.id !== id), programmes);
    await saveEnveloppe(e);
    console.log(`Enveloppe ${e.id} ${id ? "modifiée" : "créée"}`);
    return c.json(e, id ? 200 : 201);
  } catch (err) {
    if (err instanceof ConfigError) return c.json({ error: err.message }, 422);
    throw err;
  }
}

app.post("/enveloppes", (c) => writeEnveloppe(c, null));

app.put("/enveloppes/:id", async (c) => {
  const id = c.req.param("id");
  if (!(await getEnveloppe(id))) return c.json({ error: "Enveloppe introuvable" }, 404);
  return writeEnveloppe(c, id);
});

app.delete("/enveloppes/:id", async (c) => {
  const id = c.req.param("id");
  if (!isEnveloppeId(id) || !(await getEnveloppe(id))) return c.json({ error: "Enveloppe introuvable" }, 404);
  const filles = (await listEnveloppes()).filter((e) => e.parent === id);
  if (filles.length) return c.json({ error: `Enveloppe mère de : ${filles.map((e) => e.libelle).join(", ")}. Retirez d'abord cette délégation.` }, 409);
  await deleteEnveloppe(id);
  console.log(`Enveloppe ${id} supprimée`);
  return c.body(null, 204);
});

// Enveloppes alimentées par une démarche (bandeau du kanban), avec les imputations de ses dossiers.
app.get("/demarches/:numero{[0-9]+}/enveloppes", declared, async (c) => {
  const { numero } = c.get("config");
  const all = await listEnveloppes();
  const concernees = all.filter((e) => e.demarches.includes(numero));
  const calculees = (await calculerEnveloppes(concernees)).map((e) => ({
    ...e,
    imputations: e.imputations.filter((i) => i.demarche === numero),
    anomalies: e.anomalies.filter((a) => a.demarche === numero || a.demarche === 0),
  }));
  return c.json({ enveloppes: calculees });
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

// Saisie du bloc de décision (C2b) : journal local, une ligne JSON par tentative (sous-champ,
// ancienne et nouvelle valeur, résultat). Ni le jeton, ni aucune autre donnée du dossier.
async function logAnnotations(entry: Record<string, unknown>) {
  await mkdir(LOG_DIR, { recursive: true });
  await appendFile(new URL("annotations.log", LOG_DIR), JSON.stringify({ date: new Date().toISOString(), ...entry }) + "\n");
}

// Seule écriture d'annotations : le bloc de décision, si l'interrupteur général et le réglage
// `annotations` de la démarche l'autorisent tous les deux.
app.post("/demarches/:numero{[0-9]+}/dossiers/:number{[0-9]+}/decision", declared, async (c) => {
  const config = c.get("config");
  if (!MUTATIONS_ENABLED) return c.json({ error: "Écritures désactivées sur ce serveur (DN_ENABLE_MUTATIONS)" }, 403);
  if (!config.annotations) return c.json({ error: "Saisie du bloc de décision non autorisée pour cette démarche (voir ses paramètres)" }, 403);
  const notJson = requireJson(c);
  if (notJson) return notJson;
  const number = Number(c.req.param("number"));
  const body = await c.req.json();
  const base = { demarche: config.numero, dossier: number };
  try {
    const revision = (await fetchDemarche(config.numero)).activeRevision;
    const r = await appliquerDecision(config, number, body, revision);
    await logAnnotations({
      ...base, etat: r.etat, resultat: "ok",
      modifications: r.modifications.map(({ rang, role, avant, apres }) => ({ ligne: rang, role, descripteur: config.finances.blocDecision![role]?.id, avant, apres })),
      nouvelleLigne: r.nouvelleLigne,
    });
    console.log(`Démarche ${config.numero}, dossier ${number} : bloc de décision modifié (${r.modifications.length} valeur(s)${r.nouvelleLigne ? ", une ligne ajoutée" : ""})`);
    return c.json(r);
  } catch (e) {
    // Valeurs demandées journalisées telles qu'envoyées (montants, options, références).
    const demande = (Array.isArray(body?.modifications) ? body.modifications : []).map((m: any) => ({ role: m?.role, avant: m?.avant ?? null, apres: m?.apres ?? null }));
    await logAnnotations({ ...base, resultat: "erreur", message: (e as Error).message, modifications: demande, nouvelleLigne: body?.nouvelleLigne ?? null });
    if (e instanceof DecisionError) return c.json({ error: e.message, details: e.details }, e.status);
    if (e instanceof AnnotationError) return c.json({ error: `Démarche Numérique a refusé la modification : ${e.message}` }, 422);
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
