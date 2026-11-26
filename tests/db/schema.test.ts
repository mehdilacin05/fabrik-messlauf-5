// Schritt 2: Regeln und Rechte der Tabellen, geprüft gegen die frische Test-DB (`make testdb`, DATABASE_URL).
// Der Katalogtest wächst mit: er nimmt jede Funktion, die ein späterer Schritt im Schema anlegt, von selbst auf.
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// standardwert: lokale Test-DB und Schema der ersten Migration; die CI setzt beides ausdrücklich
const S = process.env.APP_SCHEMA ?? "inventar";
let db: Client;

type Rolle = "anon" | "authenticated" | "postgres";
interface Ich {
  rolle: Rolle;
  sub?: string;
}
const ANON: Ich = { rolle: "anon" };
const als = (sub: string): Ich => ({ rolle: "authenticated", sub });

/** Führt `sql` als anon/authenticated mit Token-Subjekt aus; immer in einer Transaktion, die zurückgerollt wird. */
async function lauf(ich: Ich, sql: string, params: unknown[] = []) {
  await db.query("begin");
  try {
    if (ich.rolle !== "postgres") {
      const claims = JSON.stringify(
        ich.sub ? { sub: ich.sub, role: ich.rolle } : { role: ich.rolle },
      );
      await db.query("select set_config('request.jwt.claims', $1, true)", [
        claims,
      ]);
      await db.query("select set_config('request.jwt.claim.sub', $1, true)", [
        ich.sub ?? "",
      ]);
      await db.query(`set local role ${ich.rolle}`);
    }
    return await db.query(sql, params);
  } finally {
    await db.query("rollback");
  }
}
const fehlerVon = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e as { code?: string; message: string };
  }
  throw new Error("Aufruf hätte scheitern müssen");
};
const kurz = () => randomUUID().slice(0, 8);

async function konto(): Promise<string> {
  const id = randomUUID();
  await db.query("insert into auth.users (id, email) values ($1, $2)", [
    id,
    `${id}@test.example`,
  ]);
  return id;
}
async function person(
  rolle: string,
  opt: { gesperrt?: boolean; mitKonto?: boolean } = {},
) {
  const auth = opt.mitKonto === false ? null : await konto();
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
  return { id: rows[0].id as string, auth: auth as string };
}
async function kategorieId(): Promise<string> {
  return (await db.query(`select id from ${S}.kategorie where name = 'Laptop'`))
    .rows[0].id;
}
async function geraet(opt: { inhaber?: string; seriennummer?: string } = {}) {
  const { rows } = await db.query(
    `insert into ${S}.geraet (seriennummer, bezeichnung, kategorie_id, status, inhaber_id)
     values ($1, 'Testgerät', $2, $3, $4) returning id`,
    [
      opt.seriennummer ?? `SN-${kurz()}`,
      await kategorieId(),
      opt.inhaber ? "ausgegeben" : "lager",
      opt.inhaber ?? null,
    ],
  );
  return rows[0].id as string;
}
async function ereignis(geraetId: string) {
  const { rows } = await db.query(
    `insert into ${S}.geraet_ereignis (geraet_id, art) values ($1, 'angelegt') returning id`,
    [geraetId],
  );
  return rows[0].id as string;
}

beforeAll(async () => {
  // Der frische Postgres startet nach dem Einrichten einmal neu; bis dahin verweigert er Verbindungen.
  for (let versuch = 1; ; versuch++) {
    db = new Client({ connectionString: process.env.DATABASE_URL });
    try {
      await db.connect();
      return;
    } catch (e) {
      if (versuch >= 30) throw e;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}, 60_000);
afterAll(async () => {
  await db.end();
});

describe("Lesen (Q1)", () => {
  it("Mitarbeiter A liest Gerät oder Person von B: leer", async () => {
    const a = await person("mitarbeiter");
    const b = await person("mitarbeiter");
    const gb = await geraet({ inhaber: b.id });
    await ereignis(gb);

    const sicht = als(a.auth);
    expect(
      (await lauf(sicht, `select 1 from ${S}.geraet where id = $1`, [gb])).rows,
    ).toEqual([]);
    expect(
      (
        await lauf(sicht, `select 1 from ${S}.geraet where inhaber_id = $1`, [
          b.id,
        ])
      ).rows,
    ).toEqual([]);
    expect(
      (await lauf(sicht, `select 1 from ${S}.person where id = $1`, [b.id]))
        .rows,
    ).toEqual([]);
    expect(
      (
        await lauf(
          sicht,
          `select 1 from ${S}.geraet_ereignis where geraet_id = $1`,
          [gb],
        )
      ).rows,
    ).toEqual([]);
    // Mitarbeiter haben keine Leseregel auf geraet, auch nicht für das eigene Gerät
    const ga = await geraet({ inhaber: a.id });
    expect(
      (await lauf(sicht, `select 1 from ${S}.geraet where id = $1`, [ga])).rows,
    ).toEqual([]);
    // die eigene Person-Zeile sehen sie
    expect((await lauf(sicht, `select id from ${S}.person`)).rows).toEqual([
      { id: a.id },
    ]);
  });

  it("Verwaltung liest alles (Gegenprobe)", async () => {
    const v = await person("verwaltung");
    const b = await person("mitarbeiter");
    const gb = await geraet({ inhaber: b.id });
    const e = await ereignis(gb);
    const sicht = als(v.auth);
    expect(
      (await lauf(sicht, `select 1 from ${S}.person where id = $1`, [b.id]))
        .rowCount,
    ).toBe(1);
    expect(
      (await lauf(sicht, `select 1 from ${S}.geraet where id = $1`, [gb]))
        .rowCount,
    ).toBe(1);
    expect(
      (
        await lauf(sicht, `select 1 from ${S}.geraet_ereignis where id = $1`, [
          e,
        ])
      ).rowCount,
    ).toBe(1);
  });

  it("Gesperrte und Konto ohne Person sehen nichts, anon scheitert an den Rechten", async () => {
    const gesperrt = await person("verwaltung", { gesperrt: true });
    const ohnePerson = await konto();
    const b = await person("mitarbeiter");
    const gb = await geraet({ inhaber: b.id });
    await ereignis(gb);
    for (const sicht of [als(gesperrt.auth), als(ohnePerson)]) {
      for (const t of ["person", "kategorie", "geraet", "geraet_ereignis"]) {
        expect((await lauf(sicht, `select 1 from ${S}.${t}`)).rows, t).toEqual(
          [],
        );
      }
    }
    for (const t of ["person", "kategorie", "geraet", "geraet_ereignis"]) {
      expect(
        (await fehlerVon(lauf(ANON, `select 1 from ${S}.${t}`))).code,
        t,
      ).toBe("42501");
    }
  });

  it("Mitarbeiter lesen die Kategorien", async () => {
    const a = await person("mitarbeiter");
    const namen = (
      await lauf(als(a.auth), `select name from ${S}.kategorie order by name`)
    ).rows.map((r) => r.name);
    expect(namen).toEqual(["Handy", "Headset", "Laptop", "Monitor"]);
  });
});

describe("Historie nur anhängend (Q2)", () => {
  it("Update, Delete und Truncate auf geraet_ereignis scheitern, auch für den Eigentümer", async () => {
    const e = await ereignis(await geraet());
    const upd = await fehlerVon(
      db.query(`update ${S}.geraet_ereignis set notiz = 'x' where id = $1`, [
        e,
      ]),
    );
    expect(upd.message).toContain("historie_nur_anhaengend");
    const del = await fehlerVon(
      db.query(`delete from ${S}.geraet_ereignis where id = $1`, [e]),
    );
    expect(del.message).toContain("historie_nur_anhaengend");
    const trunc = await fehlerVon(db.query(`truncate ${S}.geraet_ereignis`));
    expect(trunc.message).toContain("historie_nur_anhaengend");
    // auch über die Fremdschlüssel-Kaskade
    const kask = await fehlerVon(db.query(`truncate ${S}.geraet cascade`));
    expect(kask.message).toContain("historie_nur_anhaengend");
    expect(
      (await db.query(`select 1 from ${S}.geraet_ereignis where id = $1`, [e]))
        .rowCount,
    ).toBe(1);
  });

  it("Geräte und Personen lassen sich nicht löschen", async () => {
    const p = await person("mitarbeiter");
    const g = await geraet();
    expect(
      (await fehlerVon(db.query(`delete from ${S}.geraet where id = $1`, [g])))
        .message,
    ).toContain("loeschen_verboten");
    expect(
      (
        await fehlerVon(
          db.query(`delete from ${S}.person where id = $1`, [p.id]),
        )
      ).message,
    ).toContain("loeschen_verboten");
  });
});

describe("Datenregeln (Q2)", () => {
  it("zweite Seriennummer in anderer Schreibweise scheitert, auch bei ausgemustertem Gerät", async () => {
    const sn = `AbC-${kurz()}`;
    const g = await geraet({ seriennummer: sn });
    const err = await fehlerVon(geraet({ seriennummer: sn.toLowerCase() }));
    expect(err.code).toBe("23505");
    await db.query(
      `update ${S}.geraet set status = 'ausgemustert' where id = $1`,
      [g],
    );
    expect(
      (await fehlerVon(geraet({ seriennummer: sn.toUpperCase() }))).code,
    ).toBe("23505");
    // Leerraum am Rand würde den Index umgehen
    expect((await fehlerVon(geraet({ seriennummer: ` ${sn}` }))).code).toBe(
      "23514",
    );
  });

  it("Seriennummer ist unveränderlich, andere Felder nicht", async () => {
    const g = await geraet();
    const err = await fehlerVon(
      db.query(
        `update ${S}.geraet set seriennummer = 'NEU-${kurz()}' where id = $1`,
        [g],
      ),
    );
    expect(err.message).toContain("seriennummer_unveraenderlich");
    await db.query(
      `update ${S}.geraet set bezeichnung = 'Neu', seriennummer = seriennummer where id = $1`,
      [g],
    );
  });

  it("Check-Regel Status/Inhaber: zwei Besitzer, Besitzer im Lager oder ohne Besitzer scheitern", async () => {
    const p1 = await person("mitarbeiter");
    const p2 = await person("mitarbeiter");
    const g = await geraet({ inhaber: p1.id });
    // ein zweiter Besitzer ersetzt den ersten nur, der Status bleibt gültig; "beide" gibt es nicht (eine Spalte)
    await db.query(`update ${S}.geraet set inhaber_id = $2 where id = $1`, [
      g,
      p2.id,
    ]);
    expect(
      (await db.query(`select inhaber_id from ${S}.geraet where id = $1`, [g]))
        .rows[0].inhaber_id,
    ).toBe(p2.id);
    // zurück ins Lager, ohne den Inhaber zu löschen: verboten
    const lager = await fehlerVon(
      db.query(`update ${S}.geraet set status = 'lager' where id = $1`, [g]),
    );
    expect(lager.code).toBe("23514");
    // ausgegeben ohne Inhaber: verboten
    const leer = await fehlerVon(
      db.query(`update ${S}.geraet set inhaber_id = null where id = $1`, [g]),
    );
    expect(leer.code).toBe("23514");
    // ausgemustert mit Inhaber: verboten
    const aus = await fehlerVon(
      db.query(`update ${S}.geraet set status = 'ausgemustert' where id = $1`, [
        g,
      ]),
    );
    expect(aus.code).toBe("23514");
  });

  it("E-Mail ist ohne Rücksicht auf Groß-/Kleinschreibung eindeutig, mehrere ohne Mail sind erlaubt", async () => {
    const mail = `${kurz()}@Test.example`;
    await db.query(
      `insert into ${S}.person (name, email, rolle) values ('A', $1, 'mitarbeiter')`,
      [mail],
    );
    const err = await fehlerVon(
      db.query(
        `insert into ${S}.person (name, email, rolle) values ('B', $1, 'mitarbeiter')`,
        [mail.toLowerCase()],
      ),
    );
    expect(err.code).toBe("23505");
    await db.query(
      `insert into ${S}.person (name, rolle) values ('C', 'mitarbeiter'), ('D', 'mitarbeiter')`,
    );
  });

  it("Kategorienamen sind ohne Rücksicht auf Schreibweise eindeutig; die vier Startkategorien sind da", async () => {
    expect(
      (
        await fehlerVon(
          db.query(`insert into ${S}.kategorie (name) values ('laptop')`),
        )
      ).code,
    ).toBe("23505");
    const namen = (
      await db.query(
        `select name from ${S}.kategorie where name in ('Laptop','Monitor','Handy','Headset')`,
      )
    ).rowCount;
    expect(namen).toBe(4);
  });

  it("die Indizes aus der Architektur sind da", async () => {
    const { rows } = await db.query(
      "select indexdef from pg_indexes where schemaname = $1",
      [S],
    );
    const defs = rows.map((r) => r.indexdef as string).join("\n");
    for (const muster of [
      /ON \S+\.geraet USING btree \(inhaber_id\)/,
      /ON \S+\.geraet USING btree \(kategorie_id\)/,
      /ON \S+\.geraet USING btree \(status\)/,
      /ON \S+\.geraet_ereignis USING btree \(geraet_id, zeitpunkt\)/,
      /ON \S+\.geraet_ereignis USING btree \(person_id\)/,
      /ON \S+\.geraet_ereignis USING btree \(ausgefuehrt_von\)/,
      /UNIQUE INDEX \S+ ON \S+\.person USING btree \(auth_user_id\)/,
      /UNIQUE INDEX \S+ ON \S+\.person USING btree \(lower\(email\)\)/,
      /UNIQUE INDEX \S+ ON \S+\.geraet USING btree \(lower\(seriennummer\)\)/,
    ]) {
      expect(defs).toMatch(muster);
    }
  });
});

describe("Katalogtest (wächst mit): Rechte im ganzen Schema (Q1)", () => {
  it("jede Tabelle hat RLS", async () => {
    const { rows } = await db.query(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = $1 and c.relkind in ('r', 'p') and not c.relrowsecurity`,
      [S],
    );
    expect(rows).toEqual([]);
  });

  it("authenticated und anon haben keine Schreibrechte auf Tabellen", async () => {
    const { rows } = await db.query(
      `select r.rolname, c.relname, p.privileg
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       cross join (values ('anon'), ('authenticated')) r(rolname)
       cross join (values ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) p(privileg)
       where n.nspname = $1 and c.relkind in ('r', 'p', 'v', 'm')
         and (has_table_privilege(r.rolname, c.oid, p.privileg)
              or (p.privileg in ('INSERT', 'UPDATE', 'REFERENCES') and has_any_column_privilege(r.rolname, c.oid, p.privileg)))`,
      [S],
    );
    expect(rows).toEqual([]);
  });

  it("anon hat gar keine Rechte auf Tabellen", async () => {
    const { rows } = await db.query(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = $1 and c.relkind in ('r', 'p', 'v', 'm') and has_any_column_privilege('anon', c.oid, 'SELECT')`,
      [S],
    );
    expect(rows).toEqual([]);
  });

  it("Triggerfunktionen kann niemand außer dem Eigentümer aufrufen", async () => {
    const { rows } = await db.query(
      `select p.proname, r.rolname from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       cross join (values ('anon'), ('authenticated')) r(rolname)
       where n.nspname = $1 and p.prorettype = 'trigger'::regtype and has_function_privilege(r.rolname, p.oid, 'EXECUTE')`,
      [S],
    );
    expect(rows).toEqual([]);
  });

  it("anon hat kein Ausführungsrecht auf irgendeine Funktion", async () => {
    const { rows } = await db.query(
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = $1 and has_function_privilege('anon', p.oid, 'EXECUTE')`,
      [S],
    );
    expect(rows).toEqual([]);
  });

  it("jede Funktion als anon, Konto ohne Person, Mitarbeiter und Gesperrte: nicht_erlaubt oder leer", async () => {
    const funktionen = (
      await db.query(
        `select p.proname,
                coalesce(string_agg(format('null::%s', format_type(t.oid, null)), ', ' order by a.ord) filter (where t.oid is not null), '') as args
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
         left join lateral unnest(p.proargtypes::oid[]) with ordinality as a(typ, ord) on true
         left join pg_type t on t.oid = a.typ
         where n.nspname = $1 and p.prorettype <> 'trigger'::regtype and p.prokind = 'f'
         group by p.oid, p.proname order by p.proname`,
        [S],
      )
    ).rows as { proname: string; args: string }[];
    expect(funktionen.length).toBeGreaterThan(0);

    const ohnePerson = await konto();
    const mitarbeiter = await person("mitarbeiter");
    const gesperrte = await person("verwaltung", { gesperrt: true });
    const sichten: [string, Ich][] = [
      ["anon", ANON],
      ["Konto ohne Person", als(ohnePerson)],
      ["Mitarbeiter", als(mitarbeiter.auth)],
      ["Gesperrte", als(gesperrte.auth)],
    ];
    const verstoesse: string[] = [];
    for (const f of funktionen) {
      for (const [name, ich] of sichten) {
        const aufruf = `select * from ${S}.${f.proname}(${f.args})`;
        let r;
        try {
          r = await lauf(ich, aufruf);
        } catch (e) {
          const err = e as { code?: string; message: string };
          // nicht_erlaubt aus der Funktion oder kein Ausführungsrecht (42501)
          if (err.message.includes("nicht_erlaubt") || err.code === "42501")
            continue;
          verstoesse.push(`${f.proname} als ${name}: Fehler ${err.message}`);
          continue;
        }
        // leer: keine Zeilen, oder ein einziger Wert null/false (Rechteprüfung wie ist_verwaltung())
        const leer =
          r.rowCount === 0 ||
          (r.rowCount === 1 &&
            Object.values(r.rows[0]).every((v) => v === null || v === false));
        if (!leer)
          verstoesse.push(
            `${f.proname} als ${name}: lieferte ${JSON.stringify(r.rows)}`,
          );
      }
    }
    expect(verstoesse).toEqual([]);
  });
});
