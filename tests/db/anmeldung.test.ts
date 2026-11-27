// Schritt 4: Anmeldung und Rechte (E3, Q1) gegen die frische Test-DB (`make testdb`, DATABASE_URL).
// Jeder Test läuft in einer Transaktion, die zurückgerollt wird: Konten, Personen und die Start-Mail bleiben nicht
// stehen. Die Tabelle `person` ist dabei gesperrt (share row exclusive) und alle bestehenden Verwaltungen sind
// herabgestuft, damit „es gibt noch keine Verwaltung“ auch neben den anderen Testdateien gilt.
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// standardwert: lokale Test-DB und Schema der ersten Migration; die CI setzt beides ausdrücklich
const S = process.env.APP_SCHEMA ?? "inventar";
const kurz = () => randomUUID().slice(0, 8);
let db: Client;

beforeAll(async () => {
  // Der frische Postgres startet nach dem Einrichten einmal neu; bis dahin verweigert er Verbindungen.
  for (let versuch = 1; ; versuch++) {
    const c = new Client({ connectionString: process.env.DATABASE_URL });
    try {
      await c.connect();
      db = c;
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

interface Konto {
  id: string;
  email: string;
}
type Anbieter = "azure" | "email";

/** Konto mit Identitäten wie im Login-Dienst (je Anbieter eine Zeile in auth.identities). */
async function konto(
  anbieter: Anbieter[],
  email = `${kurz()}@test.example`,
  meta: Record<string, string> = {},
): Promise<Konto> {
  const id = randomUUID();
  await db.query(
    "insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)",
    [id, email, JSON.stringify(meta)],
  );
  for (const provider of anbieter) {
    await db.query(
      "insert into auth.identities (provider_id, user_id, identity_data, provider) values ($1, $2, $3, $4)",
      [id, id, JSON.stringify({ sub: id, email }), provider],
    );
  }
  return { id, email };
}

async function vorabPerson(
  email: string,
  rolle = "mitarbeiter",
  gesperrt = false,
) {
  const r = await db.query(
    `insert into ${S}.person (name, email, rolle, gesperrt) values ($1, $2, $3, $4) returning id`,
    [`Vorab ${kurz()}`, email, rolle, gesperrt],
  );
  return r.rows[0].id as string;
}

/** Ruft person_verknuepfen() als angemeldetes Konto auf (Rolle authenticated, Token-Subjekt). */
async function verknuepfen(k: Konto): Promise<boolean | string> {
  await db.query("savepoint v");
  try {
    await db.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: k.id, role: "authenticated" }),
    ]);
    await db.query("set local role authenticated");
    const r = await db.query(`select ${S}.person_verknuepfen() as r`);
    await db.query("reset role");
    return r.rows[0].r as boolean;
  } catch (e) {
    await db.query("rollback to savepoint v");
    await db.query("reset role");
    return (e as { message: string }).message;
  }
}

async function person(k: Konto) {
  const r = await db.query(
    `select rolle, gesperrt, email from ${S}.person where auth_user_id = $1`,
    [k.id],
  );
  return r.rows[0] as
    { rolle: string; gesperrt: boolean; email: string } | undefined;
}

/** Szenario in einer Transaktion ohne Verwaltung und mit Start-Mail (oder ohne), danach Rollback. */
async function szenario(startMail: string | null, lauf: () => Promise<void>) {
  await db.query("begin");
  try {
    await db.query(`lock table ${S}.person in share row exclusive mode`);
    await db.query(
      `update ${S}.person set rolle = 'mitarbeiter' where rolle = 'verwaltung'`,
    );
    if (startMail)
      await db.query(`insert into ${S}.verwaltung_start (email) values ($1)`, [
        startMail,
      ]);
    await lauf();
  } finally {
    await db.query("rollback");
  }
}

describe("person_verknuepfen: Microsoft-Konto zur vorab angelegten Person", () => {
  it("verknüpft ein Konto mit Identität azure und gleicher Adresse (Groß-/Kleinschreibung egal)", async () => {
    await szenario(null, async () => {
      const k = await konto(["azure"], `Anna.${kurz()}@Test.Example`);
      const id = await vorabPerson(k.email.toLowerCase());
      expect(await verknuepfen(k)).toBe(true);
      expect((await person(k))?.rolle).toBe("mitarbeiter");
      const r = await db.query(
        `select id from ${S}.person where auth_user_id = $1`,
        [k.id],
      );
      expect(r.rows[0].id).toBe(id);
      // zweiter Aufruf: schon verknüpft, nichts ändert sich
      expect(await verknuepfen(k)).toBe(false);
    });
  });

  it("Mail-Konto mit gleicher Adresse wird nicht verknüpft", async () => {
    await szenario(null, async () => {
      const k = await konto(["email"]);
      await vorabPerson(k.email);
      expect(await verknuepfen(k)).toContain("nicht_erlaubt");
      expect(await person(k)).toBeUndefined();
    });
  });

  it("vorab registriertes Mail-Konto wird nach dem Microsoft-Login nicht verknüpft", async () => {
    await szenario(null, async () => {
      // derselbe Nutzer hat beide Anmeldearten (Login-Dienst hat die Identitäten verbunden)
      const verbunden = await konto(["email", "azure"]);
      await vorabPerson(verbunden.email);
      expect(await verknuepfen(verbunden)).toContain("nicht_erlaubt");
      expect(await person(verbunden)).toBeUndefined();
    });
  });

  it("gesperrte Person und Person mit anderem Konto werden nicht verknüpft", async () => {
    await szenario(null, async () => {
      const gesperrt = await konto(["azure"]);
      await vorabPerson(gesperrt.email, "mitarbeiter", true);
      expect(await verknuepfen(gesperrt)).toContain("nicht_erlaubt");

      const besetzt = await konto(["azure"]);
      const fremd = await konto(["azure"]);
      const id = await vorabPerson(besetzt.email);
      await db.query(`update ${S}.person set auth_user_id = $1 where id = $2`, [
        fremd.id,
        id,
      ]);
      expect(await verknuepfen(besetzt)).toContain("nicht_erlaubt");
    });
  });

  it("verknüpfte, aber gesperrte Person wird bei jedem Aufruf abgewiesen", async () => {
    await szenario(null, async () => {
      const k = await konto(["azure"]);
      await vorabPerson(k.email);
      expect(await verknuepfen(k)).toBe(true);
      await db.query(
        `update ${S}.person set gesperrt = true where auth_user_id = $1`,
        [k.id],
      );
      expect(await verknuepfen(k)).toContain("nicht_erlaubt");
    });
  });

  it("Konto ohne Person und ohne Start-Mail bekommt nichts", async () => {
    await szenario(null, async () => {
      const k = await konto(["azure"]);
      expect(await verknuepfen(k)).toContain("nicht_erlaubt");
      expect(await person(k)).toBeUndefined();
    });
  });
});

describe("erste Verwaltung nur über VERWALTUNG_START_EMAIL (E3)", () => {
  it("Start-Mail mit Microsoft-Konto legt die Person an und macht sie zur Verwaltung", async () => {
    const start = `${kurz()}@test.example`;
    await szenario(start.toUpperCase(), async () => {
      const k = await konto(["azure"], start, {
        full_name: "Erika Einrichtung",
      });
      expect(await verknuepfen(k)).toBe(true);
      expect(await person(k)).toMatchObject({
        rolle: "verwaltung",
        gesperrt: false,
      });
      const n = await db.query(
        `select name from ${S}.person where auth_user_id = $1`,
        [k.id],
      );
      expect(n.rows[0].name).toBe("Erika Einrichtung");
    });
  });

  it("Start-Mail mit schon vorab angelegter Person: Person wird Verwaltung", async () => {
    const start = `${kurz()}@test.example`;
    await szenario(start, async () => {
      const k = await konto(["azure"], start);
      await vorabPerson(start);
      expect(await verknuepfen(k)).toBe(true);
      expect((await person(k))?.rolle).toBe("verwaltung");
    });
  });

  it("Start-Mail ohne Microsoft-Identität (nur Mail-Konto) wird nicht Verwaltung", async () => {
    const start = `${kurz()}@test.example`;
    await szenario(start, async () => {
      const k = await konto(["email"], start);
      expect(await verknuepfen(k)).toContain("nicht_erlaubt");
      expect(await person(k)).toBeUndefined();
    });
  });

  it("ohne Start-Mail wird niemand Verwaltung, auch nicht die erste Anmeldung", async () => {
    await szenario(null, async () => {
      const k = await konto(["azure"]);
      expect(await verknuepfen(k)).toContain("nicht_erlaubt");
      expect(await person(k)).toBeUndefined();
    });
  });

  it("Aufruf eines Mitarbeiters vor der Einrichtung macht ihn nicht zur Verwaltung", async () => {
    await szenario(`${kurz()}@test.example`, async () => {
      const k = await konto(["azure"]);
      await vorabPerson(k.email);
      expect(await verknuepfen(k)).toBe(true);
      expect((await person(k))?.rolle).toBe("mitarbeiter");
      // und ein Konto ohne Person mit fremder Mail wird auch nicht angelegt
      const fremd = await konto(["azure"]);
      expect(await verknuepfen(fremd)).toContain("nicht_erlaubt");
      expect(await person(fremd)).toBeUndefined();
    });
  });

  it("gibt es schon eine Verwaltung, bleibt die Start-Mail wirkungslos", async () => {
    const start = `${kurz()}@test.example`;
    await szenario(start, async () => {
      await vorabPerson(`${kurz()}@test.example`, "verwaltung");
      const k = await konto(["azure"], start);
      expect(await verknuepfen(k)).toContain("nicht_erlaubt");
      expect(await person(k)).toBeUndefined();
      // auch eine vorab angelegte Person mit der Start-Mail bleibt Mitarbeiter
      const k2 = await konto(["azure"]);
      await vorabPerson(k2.email);
      expect(await verknuepfen(k2)).toBe(true);
      expect((await person(k2))?.rolle).toBe("mitarbeiter");
    });
  });

  it("die Start-Mail liegt in einer Tabelle ohne Rechte, person_verknuepfen() hat keinen Parameter", async () => {
    const t = await db.query(
      `select r.rolname, has_table_privilege(r.rolname, '${S}.verwaltung_start', 'select,insert,update,delete') as darf
       from (values ('anon'), ('authenticated')) r(rolname)`,
    );
    expect(t.rows.every((z) => z.darf === false)).toBe(true);
    const rls = await db.query(
      "select relrowsecurity from pg_class where oid = $1::regclass",
      [`${S}.verwaltung_start`],
    );
    expect(rls.rows[0].relrowsecurity).toBe(true);
    const f = await db.query(
      `select pronargs from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = $1 and p.proname = 'person_verknuepfen'`,
      [S],
    );
    expect(f.rows).toEqual([{ pronargs: 0 }]);
  });

  it("anon darf person_verknuepfen nicht aufrufen, authenticated schon", async () => {
    const r = await db.query(
      `select has_function_privilege('anon', $1::regprocedure, 'EXECUTE') as anon,
              has_function_privilege('authenticated', $1::regprocedure, 'EXECUTE') as auth`,
      [`${S}.person_verknuepfen()`],
    );
    expect(r.rows[0]).toEqual({ anon: false, auth: true });
  });
});
