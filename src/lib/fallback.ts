// Vorlage → src/lib/fallback.ts. Der EINZIGE Weg für einen Fallback im Code.
// Standard ist laut scheitern (Fehler werfen). Ein Fallback braucht einen benannten Fall aus docs/ARCHITEKTUR.md
// oder dem Kartentext und einen Test mit erlaubeFallback('<grund>'). Nie bei Sicherheit/Rechten (fail closed).
// Der Grund ist ein Textliteral aus a-z, 0-9 und "-", direkt im Aufruf: mitFallback('mail-aus', …). Das Prüfskript liest ihn.

const nutzungen = new Map<string, number>();

/** Führt fn aus. Wirft fn, wird der Fall geloggt, gezählt und `ersatz` geliefert (Wert oder Funktion). */
export async function mitFallback<T>(
  grund: string,
  fn: () => Promise<T> | T,
  ersatz: T | ((fehler: unknown) => T | Promise<T>),
): Promise<T> {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(grund)) {
    throw new Error(
      `mitFallback: ungültiger Grund "${grund}" (erlaubt: a-z, 0-9, "-")`,
    );
  }
  try {
    return await fn();
  } catch (fehler) {
    nutzungen.set(grund, (nutzungen.get(grund) ?? 0) + 1);
    const text = fehler instanceof Error ? fehler.message : String(fehler);
    // Eine Zeile, immer gleicher Anfang: `FALLBACK <grund> {json}`. Tests, CI und Log-Suche greifen darauf.
    console.warn(
      `FALLBACK ${grund} ${JSON.stringify({ fehler: text.slice(0, 300) })}`,
    );
    return typeof ersatz === "function"
      ? (ersatz as (f: unknown) => T | Promise<T>)(fehler)
      : ersatz;
  }
}

/** Zähler seit Prozessstart (oder letztem Zurücksetzen): Grund → Anzahl. Für Tests und /health. */
export function fallbackNutzungen(): Record<string, number> {
  return Object.fromEntries(nutzungen);
}

/** Nur für Tests (tests/fallback-setup.ts). */
export function fallbackZuruecksetzen(): void {
  nutzungen.clear();
}
