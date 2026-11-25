import { describe, expect, it } from "vitest";
import { pruefeGesundheit } from "./health";

const env = {
  APP_SCHEMA: "inventar",
  SUPABASE_URL: "http://rest.test/",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_x",
  GIT_SHA: "abc1234",
};
const antwortet = (status: number): typeof fetch =>
  (async () => new Response("{}", { status })) as typeof fetch;

describe("pruefeGesundheit", () => {
  it("200 mit Commit-SHA, wenn das Schema antwortet", async () => {
    expect(await pruefeGesundheit(env, antwortet(200))).toEqual({
      status: 200,
      body: { ok: true, revision: "abc1234" },
    });
  });

  it("fragt das Schema aus APP_SCHEMA ab, nicht ein festes", async () => {
    let gesehen: { url: string; headers: Record<string, string> } | undefined;
    const hole = (async (url: string, init: RequestInit) => {
      gesehen = { url, headers: init.headers as Record<string, string> };
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    await pruefeGesundheit({ ...env, APP_SCHEMA: "anderes" }, hole);
    expect(gesehen?.url).toBe("http://rest.test/rest/v1/");
    expect(gesehen?.headers["Accept-Profile"]).toBe("anderes");
    expect(gesehen?.headers.apikey).toBe("sb_publishable_x");
  });

  it("503, wenn PostgREST einen Fehler meldet (Datenbank weg, Schema unbekannt)", async () => {
    for (const s of [503, 406, 401]) {
      const r = await pruefeGesundheit(env, antwortet(s));
      expect(r.status).toBe(503);
      expect(r.body.ok).toBe(false);
      expect(r.body.revision).toBe("abc1234");
    }
  });

  it("503, wenn PostgREST nicht erreichbar ist", async () => {
    const hole = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    const r = await pruefeGesundheit(env, hole);
    expect(r.status).toBe(503);
    expect(r.body.fehler).toContain("nicht erreichbar");
  });

  it.each(["APP_SCHEMA", "SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY"])(
    "503 ohne %s",
    async (name) => {
      const r = await pruefeGesundheit(
        { ...env, [name]: undefined },
        antwortet(200),
      );
      expect(r.status).toBe(503);
      expect(r.body.fehler).toContain(name);
    },
  );
});
