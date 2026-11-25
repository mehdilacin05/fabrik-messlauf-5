// Vorlage → tests/fallback-setup.ts. In vitest.config.ts: test: { setupFiles: ['./tests/fallback-setup.ts'] }
// Regel 1: Jeder Test scheitert, wenn ein Fallback benutzt wurde, den er nicht ausdrücklich erlaubt.
// Regel 2: Wer einen Grund erlaubt, muss den Fallback auch auslösen. Sonst scheitert der Test ebenfalls:
//          erlaubeFallback ist kein Freifahrtschein, sondern die Zusage „dieser Test erzwingt den Fehler“.
// Je Fallback-Grund gehört mindestens ein solcher Test in die Suite (prüft scripts/pruefe_aenderung.py).
import { afterEach, beforeEach } from "vitest";
import { fallbackNutzungen, fallbackZuruecksetzen } from "../src/lib/fallback";

let erlaubt = new Set<string>();

/** Im Test aufrufen, der den Fehler erzwingt und das Ersatzverhalten prüft: erlaubeFallback('mail-aus'). */
export function erlaubeFallback(grund: string): void {
  erlaubt.add(grund);
}

beforeEach(() => {
  erlaubt = new Set();
  fallbackZuruecksetzen();
});

afterEach(() => {
  const benutzt = Object.keys(fallbackNutzungen());
  const unerwartet = benutzt.filter((g) => !erlaubt.has(g));
  const ungenutzt = [...erlaubt].filter((g) => !benutzt.includes(g));
  if (unerwartet.length > 0) {
    throw new Error(
      `Unerwarteter Fallback: ${unerwartet.join(", ")}. Ursache beheben oder Test mit erlaubeFallback('<grund>') schreiben.`,
    );
  }
  if (ungenutzt.length > 0) {
    throw new Error(
      `erlaubeFallback(${ungenutzt.join(", ")}): Fallback wurde nicht ausgelöst. Der Test muss den Fehler erzwingen.`,
    );
  }
});
