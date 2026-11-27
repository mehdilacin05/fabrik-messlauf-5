// Pflicht-Umgebung der App: fehlt etwas, scheitert der Aufruf laut (nie ein Ersatzwert).
export function pflicht(
  name: string,
  env: Record<string, string | undefined> = process.env,
): string {
  const wert = env[name];
  if (!wert) throw new Error(`${name} fehlt`);
  return wert;
}
