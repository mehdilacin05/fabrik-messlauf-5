import { describe, expect, it, vi } from "vitest";
import { ladeKontext, nurAzure } from "./kontext";
import type { Db } from "./supabase";

const dbMit = (claims: unknown): Db =>
  ({
    auth: {
      getClaims: async () => ({
        data: claims ? { claims } : null,
        error: null,
      }),
    },
  }) as unknown as Db;
const azure = { provider: "azure", providers: ["azure"] };

describe("nurAzure", () => {
  it("nur reine Microsoft-Konten", () => {
    expect(nurAzure(azure)).toBe(true);
    expect(nurAzure({ provider: "azure" })).toBe(true);
  });
  it.each([
    ["Mail-Konto", { provider: "email", providers: ["email"] }],
    [
      "Mail zuerst, dann Microsoft verbunden",
      { provider: "email", providers: ["email", "azure"] },
    ],
    [
      "Microsoft plus Mail",
      { provider: "azure", providers: ["azure", "email"] },
    ],
    ["ohne Anbieter", {}],
    ["kein Objekt", "azure"],
    ["null", null],
    ["fehlt", undefined],
  ])("lehnt ab: %s", (_n, meta) => {
    expect(nurAzure(meta)).toBe(false);
  });
});

describe("ladeKontext", () => {
  const finde = vi.fn();
  it("ohne Sitzung → nicht_angemeldet, die Person wird nicht gelesen", async () => {
    expect(await ladeKontext(dbMit(null), finde)).toEqual({
      ok: false,
      grund: "nicht_angemeldet",
    });
    expect(await ladeKontext(dbMit({}), finde)).toEqual({
      ok: false,
      grund: "nicht_angemeldet",
    });
    expect(finde).not.toHaveBeenCalled();
  });
  it("Konto mit Mail-Anmeldung → nicht_erlaubt, die Person wird nicht gelesen", async () => {
    const db = dbMit({
      sub: "u1",
      app_metadata: { provider: "email", providers: ["email"] },
    });
    expect(await ladeKontext(db, finde)).toEqual({
      ok: false,
      grund: "nicht_erlaubt",
    });
    expect(finde).not.toHaveBeenCalled();
  });
  it("ohne Person oder gesperrt (RLS liefert nichts) → nicht_erlaubt", async () => {
    finde.mockResolvedValueOnce(null);
    expect(
      await ladeKontext(dbMit({ sub: "u1", app_metadata: azure }), finde),
    ).toEqual({
      ok: false,
      grund: "nicht_erlaubt",
    });
    expect(finde).toHaveBeenCalledWith(expect.anything(), "u1");
  });
  it("Rolle kommt aus der Person, nicht aus dem Token", async () => {
    finde.mockResolvedValueOnce({ id: "p1", rolle: "mitarbeiter" });
    const z = await ladeKontext(
      dbMit({
        sub: "u1",
        app_metadata: { ...azure, rolle: "verwaltung" },
        user_metadata: { rolle: "verwaltung" },
      }),
      finde,
    );
    expect(z.ok && z.kontext.person).toEqual({
      id: "p1",
      rolle: "mitarbeiter",
    });
  });
});
