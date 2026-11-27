import type { Db } from "@/lib/supabase";

export interface MeinGeraet {
  bezeichnung: string;
  kategorie: string;
  seriennummer: string;
  seit: string | null;
}

/** Eigene aktuelle Geräte über `meine_geraete()` (Mitarbeiter haben keine Leseregel auf die Tabelle). */
export async function meineGeraete(db: Db): Promise<MeinGeraet[]> {
  const { data, error } = await db.rpc("meine_geraete");
  if (error) throw new Error(`meine_geraete: ${error.message}`);
  return data as MeinGeraet[];
}
