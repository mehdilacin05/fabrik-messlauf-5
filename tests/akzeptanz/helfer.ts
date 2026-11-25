// Hilfen für die Akzeptanztests (Planer-Datei, für den Bauer gesperrt).
// Umgebung (Wegwerf-Stack von `make e2e`): BASE_URL, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY,
// SUPABASE_SECRET_KEY, APP_SCHEMA. Nutzer entstehen per auth.admin.createUser; Anmeldung per Passwort
// (nur im Wegwerf-Stack an), Rechte kommen wie im Betrieb aus `person` und `app_metadata`.
// Vorbereitung schreibt mit der Servicerolle direkt in die Tabellen; geprüft wird nur über die Oberfläche.
//
// UI-Vertrag (der Bauer baut genau das; Texte deutsch):
//   /anmelden        Knopf „Mit Microsoft anmelden“
//   /kein-zugang     Überschrift „Kein Zugang“
//   /geraete         Verwaltung: Überschrift „Geräte“, Tabelle, Feld „Suche“, Auswahl „Kategorie“ und „Status“
//                    (je mit Option „Alle“), Knopf „Filtern“, Link „Gerät anlegen“ → /geraete/neu
//   /geraete/neu     Felder „Seriennummer“, „Bezeichnung“, „Kategorie“, Knopf „Gerät anlegen“ → /geraete/<id>
//   /geraete/<id>    Überschrift = Bezeichnung; data-testid="status" (Lager | Ausgegeben | Ausgemustert);
//                    Auswahl „Person“ + Knopf „Ausgeben“; Knopf „Zurücknehmen“; Feld „Notiz“ + Knopf „Ausmustern“;
//                    data-testid="historie": je Ereignis eine Zeile mit Art, Person, <time>
//   /kategorien      Feld „Name“, Knopf „Kategorie anlegen“, Liste der Kategorien
//   /personen        Felder „Name“, „Firmen-Mail“, Knopf „Person anlegen“; je Person eine Tabellenzeile mit
//                    Knöpfen „Sperren“, „Entsperren“, „Anonymisieren“
//   /meine-geraete   Mitarbeiter: eigene aktuelle Geräte (Bezeichnung, Seriennummer); leer: „Keine Geräte“
//   Fehler           role="alert" mit Klartext: nicht_im_lager → „nicht im Lager“, seriennummer_vergeben →
//                    „Seriennummer ist schon vergeben“, email_vergeben → „Mail ist schon vergeben“,
//                    hat_geraete → „hat noch Geräte“, ist_ausgegeben → „noch ausgegeben“,
//                    person_gesperrt → „Person ist gesperrt“, letzte_verwaltung → „letzte Verwaltung“
//   Start (/)        Verwaltung → /geraete, Mitarbeiter → /meine-geraete, ohne Sitzung → /anmelden,
//                    Konto ohne Person oder gesperrt → /kein-zugang; Mitarbeiter auf Verwaltungsseiten → weg davon
import { createClient } from '@supabase/supabase-js';
import type { Page } from '@playwright/test';

const env = (n: string): string => {
  const v = process.env[n];
  if (!v) throw new Error(`${n} fehlt`);
  return v;
};

export const admin = () =>
  createClient(env('SUPABASE_URL'), env('SUPABASE_SECRET_KEY'), {
    db: { schema: env('APP_SCHEMA') },
    auth: { persistSession: false },
  });

export const eindeutig = (p: string) => `${p}-${Math.random().toString(36).slice(2, 8)}`;

export type Rolle = 'verwaltung' | 'mitarbeiter';
export interface Nutzer { email: string; passwort: string; authId: string; personId?: string; name?: string }

/** Legt ein Konto (Anbieter azure) und, außer bei `person: false`, die verknüpfte Person an. */
export async function nutzer(
  rolle: Rolle,
  opt: { person?: boolean; gesperrt?: boolean; name?: string } = {},
): Promise<Nutzer> {
  const db = admin();
  const email = `${eindeutig(rolle)}@test.example`;
  const passwort = eindeutig('pw') + 'Aa1!';
  const { data, error } = await db.auth.admin.createUser({
    email, password: passwort, email_confirm: true,
    app_metadata: { provider: 'azure', providers: ['azure'] },
  });
  if (error || !data.user) throw error ?? new Error('Konto nicht angelegt');
  const n: Nutzer = { email, passwort, authId: data.user.id };
  if (opt.person !== false) {
    const name = opt.name ?? eindeutig('Name');
    const r = await db.from('person')
      .insert({ auth_user_id: n.authId, name, email, rolle, gesperrt: !!opt.gesperrt })
      .select('id').single();
    if (r.error) throw r.error;
    n.personId = r.data.id;
    n.name = name;
  }
  return n;
}

/** Person ohne Konto (von der Verwaltung vorab angelegt). */
export async function personOhneKonto(name = eindeutig('Vorab')) {
  const r = await admin().from('person')
    .insert({ name, email: `${eindeutig('vorab')}@test.example`, rolle: 'mitarbeiter', gesperrt: false })
    .select('id,name,email').single();
  if (r.error) throw r.error;
  return r.data as { id: string; name: string; email: string };
}

export async function kategorie(name = eindeutig('Kat')) {
  const r = await admin().from('kategorie').insert({ name }).select('id,name').single();
  if (r.error) throw r.error;
  return r.data as { id: string; name: string };
}

/** Gerät im Lager samt Ereignis „angelegt“. */
export async function geraet(kat: { id: string }, opt: { seriennummer?: string; bezeichnung?: string } = {}) {
  const db = admin();
  const r = await db.from('geraet')
    .insert({
      seriennummer: opt.seriennummer ?? eindeutig('SN'),
      bezeichnung: opt.bezeichnung ?? eindeutig('Gerät'),
      kategorie_id: kat.id, status: 'lager',
    })
    .select('id,seriennummer,bezeichnung').single();
  if (r.error) throw r.error;
  const e = await db.from('geraet_ereignis').insert({ geraet_id: r.data.id, art: 'angelegt' });
  if (e.error) throw e.error;
  return r.data as { id: string; seriennummer: string; bezeichnung: string };
}

/** Gerät direkt an eine Person ausgeben (Vorbereitung, mit Ereignis). */
export async function ausgeben(geraetId: string, personId: string) {
  const db = admin();
  const u = await db.from('geraet').update({ status: 'ausgegeben', inhaber_id: personId }).eq('id', geraetId);
  if (u.error) throw u.error;
  const e = await db.from('geraet_ereignis').insert({ geraet_id: geraetId, art: 'ausgegeben', person_id: personId });
  if (e.error) throw e.error;
}

/** Gerät direkt zurücknehmen (Vorbereitung, mit Ereignis). */
export async function zuruecknehmen(geraetId: string, personId: string) {
  const db = admin();
  const u = await db.from('geraet').update({ status: 'lager', inhaber_id: null }).eq('id', geraetId);
  if (u.error) throw u.error;
  const e = await db.from('geraet_ereignis').insert({ geraet_id: geraetId, art: 'zurueckgenommen', person_id: personId });
  if (e.error) throw e.error;
}

/** Meldet den Browser als Nutzer an (Cookie im Format von @supabase/ssr). */
export async function anmelden(page: Page, n: Nutzer) {
  const url = env('SUPABASE_URL');
  const c = createClient(url, env('SUPABASE_PUBLISHABLE_KEY'), { auth: { persistSession: false } });
  const { data, error } = await c.auth.signInWithPassword({ email: n.email, password: n.passwort });
  if (error || !data.session) throw error ?? new Error('Anmeldung fehlgeschlagen');
  const wert = 'base64-' + Buffer.from(JSON.stringify(data.session)).toString('base64url');
  const name = `sb-${new URL(url).hostname.split('.')[0]}-auth-token`;
  const teile = wert.match(/.{1,3180}/g) ?? [wert];
  const host = new URL(env('BASE_URL')).hostname;
  await page.context().addCookies(
    teile.map((v, i) => ({ name: teile.length === 1 ? name : `${name}.${i}`, value: v, domain: host, path: '/' })),
  );
}
