// /health: 200 nur, wenn die Konfiguration vollständig ist und PostgREST das Schema `APP_SCHEMA` beantwortet.
// Der Wurzelaufruf von PostgREST (OpenAPI) fragt die Datenbank wirklich ab: ohne Datenbank 503, unbekanntes Schema 406.
// shortcut: Prüfung gegen das Schema statt gegen eine Tabelle, weil es noch keine gibt; ab Bauplan-Schritt 8 (/health über PostgREST) um eine Tabellenabfrage erweitern.

export interface Gesundheit {
  status: 200 | 503;
  body: { ok: boolean; revision: string; fehler?: string };
}

type Umgebung = Record<string, string | undefined>;

const FRIST_MS = 3000;

export async function pruefeGesundheit(
  env: Umgebung,
  hole: typeof fetch = fetch,
): Promise<Gesundheit> {
  const revision = env.GIT_SHA ?? "unbekannt"; // standardwert: lokal ohne Image-Build gibt es keinen Commit
  const fehler = (text: string): Gesundheit => ({
    status: 503,
    body: { ok: false, revision, fehler: text },
  });

  const schema = env.APP_SCHEMA;
  const url = env.SUPABASE_URL;
  const schluessel = env.SUPABASE_PUBLISHABLE_KEY;
  if (!schema) return fehler("APP_SCHEMA fehlt");
  if (!url) return fehler("SUPABASE_URL fehlt");
  if (!schluessel) return fehler("SUPABASE_PUBLISHABLE_KEY fehlt");

  try {
    const antwort = await hole(`${url.replace(/\/+$/, "")}/rest/v1/`, {
      headers: { apikey: schluessel, "Accept-Profile": schema },
      signal: AbortSignal.timeout(FRIST_MS),
      cache: "no-store",
    });
    if (!antwort.ok)
      return fehler(`Datenbank-Schnittstelle antwortet ${antwort.status}`);
  } catch (e) {
    const grund = e instanceof Error ? e.name : "unbekannt";
    return fehler(`Datenbank-Schnittstelle nicht erreichbar (${grund})`);
  }
  return { status: 200, body: { ok: true, revision } };
}
