import type { Db } from "@/lib/supabase";

export interface Kategorie {
  id: string;
  name: string;
}

export async function listeKategorien(db: Db): Promise<Kategorie[]> {
  const { data, error } = await db
    .from("kategorie")
    .select("id, name")
    .order("name");
  if (error) throw new Error(`kategorie lesen: ${error.message}`);
  return data as Kategorie[];
}
