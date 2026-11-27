import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { AktionFehler, aktion } from "./aktion";
import type { Kontext, Zugang } from "./kontext";

const kontext = (rolle: "verwaltung" | "mitarbeiter"): Zugang => ({
  ok: true,
  kontext: {
    db: {},
    userId: "u1",
    person: { id: "p1", rolle },
  } as unknown as Kontext,
});
const ohneLogin: Zugang = { ok: false, grund: "nicht_angemeldet" };
const ohnePerson: Zugang = { ok: false, grund: "nicht_erlaubt" };
const eingabe = z.object({ name: z.string().min(1) });

function bauen(
  zugang: Zugang,
  recht: "angemeldet" | "verwaltung" = "verwaltung",
) {
  const fachlogik = vi.fn(async (e: { name: string }) => ({ name: e.name }));
  const lauf = aktion({ recht, eingabe }, fachlogik, async () => zugang);
  return { lauf, fachlogik };
}

describe("Action-Umschlag", () => {
  it("ohne Login → nicht_angemeldet, die Fachlogik läuft nicht (auch bei ungültiger Eingabe)", async () => {
    for (const recht of ["angemeldet", "verwaltung"] as const) {
      const { lauf, fachlogik } = bauen(ohneLogin, recht);
      for (const roh of [{ name: "x" }, {}, null, undefined]) {
        const r = await lauf(roh);
        expect(r).toMatchObject({ ok: false, code: "nicht_angemeldet" });
        expect(r.ok === false && r.referenz).toMatch(/^[0-9a-f]{8}$/);
      }
      expect(fachlogik).not.toHaveBeenCalled();
    }
  });

  it("Konto ohne Person oder gesperrt → nicht_erlaubt", async () => {
    const { lauf, fachlogik } = bauen(ohnePerson, "angemeldet");
    expect(await lauf({ name: "x" })).toMatchObject({
      ok: false,
      code: "nicht_erlaubt",
    });
    expect(fachlogik).not.toHaveBeenCalled();
  });

  it("Mitarbeiter ruft eine Verwaltungs-Action → nicht_erlaubt, Rolle vor Eingabeprüfung", async () => {
    const { lauf, fachlogik } = bauen(kontext("mitarbeiter"));
    expect(await lauf({ name: "x" })).toMatchObject({
      ok: false,
      code: "nicht_erlaubt",
    });
    expect(await lauf({})).toMatchObject({ ok: false, code: "nicht_erlaubt" });
    expect(fachlogik).not.toHaveBeenCalled();
  });

  it("Mitarbeiter darf eine Action für Angemeldete", async () => {
    const { lauf } = bauen(kontext("mitarbeiter"), "angemeldet");
    expect(await lauf({ name: "x" })).toEqual({ ok: true, name: "x" });
  });

  it("falsche Eingabe → ungueltig, Fachlogik läuft nicht; Zod entfernt fremde Felder", async () => {
    const { lauf, fachlogik } = bauen(kontext("verwaltung"));
    for (const roh of [{}, { name: "" }, { name: 5 }, null, "text"])
      expect(await lauf(roh)).toMatchObject({ ok: false, code: "ungueltig" });
    expect(fachlogik).not.toHaveBeenCalled();
    await lauf({ name: "x", rolle: "verwaltung" });
    expect(fachlogik.mock.calls[0][0]).toEqual({ name: "x" });
  });

  it("Verwaltung mit gültiger Eingabe → ok mit dem Ergebnis der Fachlogik", async () => {
    const { lauf, fachlogik } = bauen(kontext("verwaltung"));
    expect(await lauf({ name: "Laptop" })).toEqual({
      ok: true,
      name: "Laptop",
    });
    expect(fachlogik).toHaveBeenCalledOnce();
  });

  it("fachlicher Fehler → fester Code mit Referenz", async () => {
    const lauf = aktion(
      { recht: "verwaltung", eingabe },
      async () => {
        throw new AktionFehler("nicht_im_lager");
      },
      async () => kontext("verwaltung"),
    );
    expect(await lauf({ name: "x" })).toMatchObject({
      ok: false,
      code: "nicht_im_lager",
    });
  });

  it("unerwarteter Fehler → unerwartet, im Log nur Referenz und Fehlerart, kein Text", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const lauf = aktion(
      { recht: "verwaltung", eingabe },
      async () => {
        throw new Error("Key (email)=(anna@firma.example) existiert");
      },
      async () => kontext("verwaltung"),
    );
    const r = await lauf({ name: "x" });
    expect(r).toMatchObject({ ok: false, code: "unerwartet" });
    const zeile = String(log.mock.calls[0][0]);
    expect(zeile).toContain(r.ok === false ? r.referenz : "");
    expect(zeile).not.toContain("anna@");
    expect(JSON.stringify(r)).not.toContain("anna@");
    log.mockRestore();
  });

  it("Fehler beim Prüfen der Sitzung → unerwartet, nie ok", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const lauf = aktion(
      { recht: "angemeldet", eingabe },
      async () => ({}),
      async () => {
        throw new Error("Auth-Dienst weg");
      },
    );
    expect(await lauf({ name: "x" })).toMatchObject({
      ok: false,
      code: "unerwartet",
    });
    log.mockRestore();
  });
});
