// Umschlag jeder Server Action (docs/ARCHITEKTUR.md, Abschnitt 5): Sitzung → Recht → Zod → Fachlogik.
// Rückgabe `{ ok: true, … }` oder `{ ok: false, code, referenz }`; kein Stacktrace nach außen, die Referenz steht im Log.
import { randomUUID } from "node:crypto";
import type { z } from "zod";
import { ladeKontext, type Kontext, type Zugang } from "./kontext";
import { lesenderClient } from "./supabase";

export type Ergebnis<T extends object> =
  ({ ok: true } & T) | { ok: false; code: string; referenz: string };

/** Fachlicher Fehler mit festem Code aus der Fehlertabelle (`nicht_im_lager`, …). */
export class AktionFehler extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

export type Recht = "angemeldet" | "verwaltung";

async function standardZugang(): Promise<Zugang> {
  return ladeKontext(await lesenderClient());
}

export function aktion<S extends z.ZodType, T extends object>(
  opt: { recht: Recht; eingabe: S },
  fachlogik: (eingabe: z.infer<S>, kontext: Kontext) => Promise<T>,
  zugang: () => Promise<Zugang> = standardZugang,
): (roh: unknown) => Promise<Ergebnis<T>> {
  return async (roh) => {
    const referenz = randomUUID().slice(0, 8);
    const fehler = (code: string) => ({ ok: false as const, code, referenz });
    try {
      const z = await zugang();
      if (!z.ok) return fehler(z.grund);
      if (opt.recht === "verwaltung" && z.kontext.person.rolle !== "verwaltung")
        return fehler("nicht_erlaubt");
      const eingabe = opt.eingabe.safeParse(roh);
      if (!eingabe.success) return fehler("ungueltig");
      return { ok: true, ...(await fachlogik(eingabe.data, z.kontext)) };
    } catch (e) {
      if (e instanceof AktionFehler) return fehler(e.code);
      // Nur Referenz und Fehlerart ins Log: Meldungen können Mail-Adressen oder Namen enthalten.
      console.error(
        `aktion ${referenz} unerwartet: ${e instanceof Error ? e.name : "unbekannt"}`,
      );
      return fehler("unerwartet");
    }
  };
}
