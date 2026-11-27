// Öffentliche Adresse der App hinter Traefik (x-forwarded-*), für den Rückweg vom Microsoft-Login.
// Der Login-Dienst lässt nur Adressen seiner Redirect-Liste zu; ein gefälschter Host-Header führt also nirgends hin.
export function eigeneAdresse(kopf: Pick<Headers, "get">): string {
  const host = kopf.get("x-forwarded-host") ?? kopf.get("host");
  if (!host) throw new Error("Host-Header fehlt");
  const proto = kopf.get("x-forwarded-proto") ?? "http"; // standardwert: ohne Proxy läuft die App lokal über http
  if (!/^[a-z0-9.-]+(:\d+)?$/i.test(host) || !/^https?$/.test(proto))
    throw new Error("Host oder Protokoll ungültig");
  return `${proto}://${host}`;
}
