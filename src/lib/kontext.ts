// Sitzung und Recht eines Aufrufs. Alles kommt vom Server: Sitzung aus dem geprüften Token (getClaims), Rolle aus
// `person` (RLS), nie vom Client. Fehlt etwas, ist der Zugang verweigert (fail closed, kein Ersatzwert).
import { personZuKonto, type Person } from "../modules/person";
import type { Db } from "./supabase";

export interface Kontext {
  db: Db;
  userId: string;
  person: Person;
}
export type Zugang =
  | { ok: true; kontext: Kontext }
  | { ok: false; grund: "nicht_angemeldet" | "nicht_erlaubt" };

/** Nur Konten, die ausschließlich über Microsoft (`azure`) angelegt wurden; ein Mail-Konto zählt nie. */
export function nurAzure(meta: unknown): boolean {
  if (typeof meta !== "object" || meta === null) return false;
  const { provider, providers } = meta as Record<string, unknown>;
  if (provider !== "azure") return false;
  return (
    providers === undefined ||
    (Array.isArray(providers) && providers.every((p) => p === "azure"))
  );
}

export async function ladeKontext(
  db: Db,
  finde: typeof personZuKonto = personZuKonto,
): Promise<Zugang> {
  const { data } = await db.auth.getClaims();
  const claims = data?.claims;
  if (!claims?.sub) return { ok: false, grund: "nicht_angemeldet" };
  if (!nurAzure(claims.app_metadata))
    return { ok: false, grund: "nicht_erlaubt" };
  const person = await finde(db, claims.sub);
  if (!person) return { ok: false, grund: "nicht_erlaubt" };
  return { ok: true, kontext: { db, userId: claims.sub, person } };
}
