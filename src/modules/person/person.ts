import type { Db } from "@/lib/supabase";

export type Rolle = "verwaltung" | "mitarbeiter";
export interface Person {
  id: string;
  rolle: Rolle;
}

/**
 * Person zum Konto. RLS liefert nur die eigene, nicht gesperrte Zeile (Verwaltung sieht alle, der Filter wählt eine):
 * keine Zeile heißt keine Person oder gesperrt, beides ohne Zugang.
 */
export async function personZuKonto(
  db: Db,
  authUserId: string,
): Promise<Person | null> {
  const { data, error } = await db
    .from("person")
    .select("id, rolle")
    .eq("auth_user_id", authUserId)
    .maybeSingle();
  if (error) throw new Error(`person lesen: ${error.message}`);
  return data as Person | null;
}

/** Verknüpft das angemeldete Konto beim ersten Login mit seiner Person; `false` = Zugang verweigert. */
export async function personVerknuepfen(db: Db): Promise<boolean> {
  const { error } = await db.rpc("person_verknuepfen");
  if (!error) return true;
  if (error.message.includes("nicht_erlaubt")) return false;
  throw new Error(`person_verknuepfen: ${error.message}`);
}
