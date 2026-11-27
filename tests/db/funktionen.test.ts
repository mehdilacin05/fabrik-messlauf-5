// Schritt 3: DB-Funktionen für Geräte (E1, Q2), geprüft gegen die frische Test-DB (`make testdb`, DATABASE_URL).
// Jede Verwaltungsfunktion läuft als `authenticated` mit Token-Subjekt in einer eigenen Verbindung und Transaktion.
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// standardwert: lokale Test-DB und Schema der ersten Migration; die CI setzt beides ausdrücklich
const S = process.env.APP_SCHEMA ?? "inventar";
const kurz = () => randomUUID().slice(0, 8);
let db: Client;

async function verbinden(): Promise<Client> {
  // Der frische Postgres startet nach dem Einrichten einmal neu; bis dahin verweigert er Verbindungen.
  for (let versuch = 1; ; versuch++) {
    const c = new Client({ connectionString: process.env.DATABASE_URL });
    try {
      await c.connect();
      return c;
    } catch (e) {
      if (versuch >= 30) throw e;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}
beforeAll(async () => {
  db = await verbinden();
}, 60_000);
afterAll(async () => {
  await db.end();
});

type Fehler = { code?: string; message: string };

/** Ruft `sql` als angemeldete Person in eigener Transaktion auf; commit bei Erfolg, rollback bei Fehler. */
async function als<T = Record<string, unknown>>(
  sub: string,
  sql: string,
  params: unknown[] = [],
  client?: Client,
): Promise<{ rows: T[] } | { fehler: Fehler }> {
  const c = client ?? db;
  await c.query("begin");
  try {
    await c.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub, role: "authenticated" }),
    ]);
    await c.query("select set_config('request.jwt.claim.sub', $1, true)", [
      sub,
    ]);
    await c.query("set local role authenticated");
    const r = await c.query(sql, params);
    await c.query("commit");
    return { rows: r.rows as T[] };
  } catch (e) {
    await c.query("rollback");
    return { fehler: e as Fehler };
  }
}
const ok = <T>(r: { rows: T[] } | { fehler: Fehler }) => {
  if ("fehler" in r) throw new Error(r.fehler.message);
  return r.rows;
};
const fehler = (r: { rows: unknown[] } | { fehler: Fehler }) => {
  if (!("fehler" in r)) throw new Error("Aufruf hätte scheitern müssen");
  return r.fehler.message;
};

async function person(
  rolle: string,
  opt: { gesperrt?: boolean } = {},
): Promise<{ id: string; auth: string }> {
  const auth = randomUUID();
  await db.query("insert into auth.users (id, email) values ($1, $2)", [
    auth,
    `${auth}@test.example`,
  ]);
  const { rows } = await db.query(
    `insert into ${S}.person (auth_user_id, name, email, rolle, gesperrt) values ($1, $2, $3, $4, $5) returning id`,
    [
      auth,
      `P ${kurz()}`,
      `${kurz()}@test.example`,
      rolle,
      opt.gesperrt ?? false,
    ],
  );
  return { id: rows[0].id, auth };
}
const kategorieId = async (): Promise<string> =>
  (await db.query(`select id from ${S}.kategorie where name = 'Laptop'`))
    .rows[0].id;

async function lagergeraet(sn = `SN-${kurz()}`): Promise<string> {
  const { rows } = await db.query(
    `insert into ${S}.geraet (seriennummer, bezeichnung, kategorie_id) values ($1, 'Testgerät', $2) returning id`,
    [sn, await kategorieId()],
  );
  return rows[0].id;
}
const zustand = async (id: string) =>
  (
    await db.query(`select status, inhaber_id from ${S}.geraet where id = $1`, [
      id,
    ])
  ).rows[0];
const ereignisse = async (id: string) =>
  (
    await db.query(
      `select art, person_id, ausgefuehrt_von from ${S}.geraet_ereignis where geraet_id = $1 order by zeitpunkt, created_at`,
      [id],
    )
  ).rows;

describe("geraet_anlegen", () => {
  it("legt ein Gerät im Lager an und schreibt genau ein Ereignis", async () => {
    const v = await person("verwaltung");
    const sn = `SN-${kurz()}`;
    const [{ id }] = ok(
      await als<{ id: string }>(
        v.auth,
        `select ${S}.geraet_anlegen($1, 'Laptop X', $2, 'neu') as id`,
        [sn, await kategorieId()],
      ),
    );
    expect(await zustand(id)).toEqual({ status: "lager", inhaber_id: null });
    expect(await ereignisse(id)).toEqual([
      { art: "angelegt", person_id: null, ausgefuehrt_von: v.id },
    ]);
  });

  it("doppelte Seriennummer, unbekannte Kategorie und leere Eingabe scheitern ohne Spur", async () => {
    const v = await person("verwaltung");
    const sn = `SN-${kurz()}`;
    const g = await lagergeraet(sn);
    const vorher = (await db.query(`select count(*)::int n from ${S}.geraet`))
      .rows[0].n;
    expect(
      fehler(
        await als(v.auth, `select ${S}.geraet_anlegen($1, 'x', $2, null)`, [
          sn.toLowerCase(),
          await kategorieId(),
        ]),
      ),
    ).toContain("seriennummer_vergeben");
    expect(
      fehler(
        await als(v.auth, `select ${S}.geraet_anlegen($1, 'x', $2, null)`, [
          `SN-${kurz()}`,
          randomUUID(),
        ]),
      ),
    ).toContain("kategorie_unbekannt");
    expect(
      fehler(
        await als(v.auth, `select ${S}.geraet_anlegen(' ', 'x', $1, null)`, [
          await kategorieId(),
        ]),
      ),
    ).toContain("ungueltig");
    expect(
      (await db.query(`select count(*)::int n from ${S}.geraet`)).rows[0].n,
    ).toBe(vorher);
    expect(await ereignisse(g)).toEqual([]);
  });
});

describe("ausgeben, zurücknehmen, ausmustern", () => {
  it("Lebenslauf: je Aufruf genau ein Ereignis mit Person und Ausführendem", async () => {
    const v = await person("verwaltung");
    const m = await person("mitarbeiter");
    const g = await lagergeraet();

    ok(await als(v.auth, `select ${S}.geraet_ausgeben($1, $2)`, [g, m.id]));
    expect(await zustand(g)).toEqual({
      status: "ausgegeben",
      inhaber_id: m.id,
    });

    ok(await als(v.auth, `select ${S}.geraet_zuruecknehmen($1)`, [g]));
    expect(await zustand(g)).toEqual({ status: "lager", inhaber_id: null });

    ok(await als(v.auth, `select ${S}.geraet_ausmustern($1)`, [g]));
    expect(await zustand(g)).toEqual({
      status: "ausgemustert",
      inhaber_id: null,
    });

    expect(await ereignisse(g)).toEqual([
      { art: "ausgegeben", person_id: m.id, ausgefuehrt_von: v.id },
      { art: "zurueckgenommen", person_id: m.id, ausgefuehrt_von: v.id },
      { art: "ausgemustert", person_id: null, ausgefuehrt_von: v.id },
    ]);
  });

  it("falscher Zustand: fachlicher Fehler, Zustand und Historie unverändert", async () => {
    const v = await person("verwaltung");
    const m = await person("mitarbeiter");
    const gesperrt = await person("mitarbeiter", { gesperrt: true });
    const lager = await lagergeraet();
    const aus = await lagergeraet();
    ok(await als(v.auth, `select ${S}.geraet_ausgeben($1, $2)`, [aus, m.id]));
    const weg = await lagergeraet();
    ok(await als(v.auth, `select ${S}.geraet_ausmustern($1)`, [weg]));
    const unbekannt = randomUUID();

    const faelle: [string, string, unknown[]][] = [
      ["nicht_im_lager", "geraet_ausgeben($1, $2)", [aus, m.id]],
      ["nicht_im_lager", "geraet_ausgeben($1, $2)", [weg, m.id]],
      ["nicht_gefunden", "geraet_ausgeben($1, $2)", [unbekannt, m.id]],
      ["nicht_gefunden", "geraet_ausgeben($1, $2)", [lager, unbekannt]],
      ["person_gesperrt", "geraet_ausgeben($1, $2)", [lager, gesperrt.id]],
      ["nicht_ausgegeben", "geraet_zuruecknehmen($1)", [lager]],
      ["nicht_ausgegeben", "geraet_zuruecknehmen($1)", [weg]],
      ["nicht_gefunden", "geraet_zuruecknehmen($1)", [unbekannt]],
      ["ist_ausgegeben", "geraet_ausmustern($1)", [aus]],
      ["bereits_ausgemustert", "geraet_ausmustern($1)", [weg]],
      ["nicht_gefunden", "geraet_ausmustern($1)", [unbekannt]],
    ];
    const vorher = [
      await ereignisse(lager),
      await ereignisse(aus),
      await ereignisse(weg),
    ];
    for (const [code, aufruf, params] of faelle) {
      expect(
        fehler(await als(v.auth, `select ${S}.${aufruf}`, params)),
        aufruf,
      ).toContain(code);
    }
    expect(await zustand(lager)).toEqual({ status: "lager", inhaber_id: null });
    expect(await zustand(aus)).toEqual({
      status: "ausgegeben",
      inhaber_id: m.id,
    });
    expect(await zustand(weg)).toEqual({
      status: "ausgemustert",
      inhaber_id: null,
    });
    expect([
      await ereignisse(lager),
      await ereignisse(aus),
      await ereignisse(weg),
    ]).toEqual(vorher);
  });

  it("parallel: genau ein Ausgeben gewinnt, das andere endet mit nicht_im_lager", async () => {
    const v1 = await person("verwaltung");
    const v2 = await person("verwaltung");
    const m1 = await person("mitarbeiter");
    const m2 = await person("mitarbeiter");
    const zweiter = await verbinden();
    try {
      for (let runde = 0; runde < 5; runde++) {
        const g = await lagergeraet();
        const [a, b] = await Promise.all([
          als(v1.auth, `select ${S}.geraet_ausgeben($1, $2)`, [g, m1.id]),
          als(
            v2.auth,
            `select ${S}.geraet_ausgeben($1, $2)`,
            [g, m2.id],
            zweiter,
          ),
        ]);
        const gewonnen = [a, b].filter((r) => !("fehler" in r));
        const verloren = [a, b].filter((r) => "fehler" in r);
        expect(gewonnen).toHaveLength(1);
        expect(verloren).toHaveLength(1);
        expect(fehler(verloren[0])).toContain("nicht_im_lager");
        const z = await zustand(g);
        expect(z.status).toBe("ausgegeben");
        expect([m1.id, m2.id]).toContain(z.inhaber_id);
        expect(await ereignisse(g)).toHaveLength(1);
      }
    } finally {
      await zweiter.end();
    }
  });
});

describe("Rechte", () => {
  it("Mitarbeiter, Gesperrte, Konto ohne Person: nicht_erlaubt, Zustand unverändert", async () => {
    const m = await person("mitarbeiter");
    const gesperrteVerwaltung = await person("verwaltung", { gesperrt: true });
    const ohnePerson = randomUUID();
    await db.query("insert into auth.users (id, email) values ($1, $2)", [
      ohnePerson,
      `${ohnePerson}@test.example`,
    ]);
    const lager = await lagergeraet();
    const aus = await lagergeraet();
    const inh = await person("mitarbeiter");
    const v = await person("verwaltung");
    ok(await als(v.auth, `select ${S}.geraet_ausgeben($1, $2)`, [aus, inh.id]));
    const vorher = [await ereignisse(lager), await ereignisse(aus)];
    const anzahl = (await db.query(`select count(*)::int n from ${S}.geraet`))
      .rows[0].n;

    for (const wer of [m.auth, gesperrteVerwaltung.auth, ohnePerson]) {
      const k = await kategorieId();
      for (const [aufruf, params] of [
        ["geraet_anlegen($1, 'x', $2, null)", [`SN-${kurz()}`, k]],
        ["geraet_ausgeben($1, $2)", [lager, m.id]],
        ["geraet_zuruecknehmen($1)", [aus]],
        ["geraet_ausmustern($1)", [lager]],
      ] as [string, unknown[]][]) {
        expect(
          fehler(await als(wer, `select ${S}.${aufruf}`, params)),
          aufruf,
        ).toContain("nicht_erlaubt");
      }
    }
    expect(await zustand(lager)).toEqual({ status: "lager", inhaber_id: null });
    expect(await zustand(aus)).toEqual({
      status: "ausgegeben",
      inhaber_id: inh.id,
    });
    expect([await ereignisse(lager), await ereignisse(aus)]).toEqual(vorher);
    expect(
      (await db.query(`select count(*)::int n from ${S}.geraet`)).rows[0].n,
    ).toBe(anzahl);
  });

  it("anon hat kein Ausführungsrecht auf die Verwaltungsfunktionen", async () => {
    await db.query("begin");
    try {
      await db.query("set local role anon");
      await expect(
        db.query(`select ${S}.geraet_ausmustern($1)`, [randomUUID()]),
      ).rejects.toMatchObject({ code: "42501" });
    } finally {
      await db.query("rollback");
    }
  });
});

describe("meine_geraete()", () => {
  it("liefert nur die eigenen Geräte mit den vier Feldern, nichts für Gesperrte oder Fremde", async () => {
    const v = await person("verwaltung");
    const a = await person("mitarbeiter");
    const b = await person("mitarbeiter");
    const gesperrt = await person("mitarbeiter");
    const ga = await lagergeraet();
    const gb = await lagergeraet();
    const gg = await lagergeraet();
    ok(await als(v.auth, `select ${S}.geraet_ausgeben($1, $2)`, [ga, a.id]));
    ok(await als(v.auth, `select ${S}.geraet_ausgeben($1, $2)`, [gb, b.id]));
    ok(
      await als(v.auth, `select ${S}.geraet_ausgeben($1, $2)`, [
        gg,
        gesperrt.id,
      ]),
    );
    await db.query(`update ${S}.person set gesperrt = true where id = $1`, [
      gesperrt.id,
    ]);

    const meine = ok(await als(a.auth, `select * from ${S}.meine_geraete()`));
    expect(meine).toHaveLength(1);
    expect(Object.keys(meine[0] as object).sort()).toEqual([
      "bezeichnung",
      "kategorie",
      "seit",
      "seriennummer",
    ]);
    expect(meine[0]).toMatchObject({
      bezeichnung: "Testgerät",
      kategorie: "Laptop",
    });
    expect(
      ok(await als(gesperrt.auth, `select * from ${S}.meine_geraete()`)),
    ).toEqual([]);
    // Rückgabe verschwindet aus der Liste
    ok(await als(v.auth, `select ${S}.geraet_zuruecknehmen($1)`, [ga]));
    expect(ok(await als(a.auth, `select * from ${S}.meine_geraete()`))).toEqual(
      [],
    );
  });
});
