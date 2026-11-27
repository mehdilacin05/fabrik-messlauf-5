// Supabase-Client je Anfrage aus den Cookies der Sitzung (Schema aus APP_SCHEMA, nie fest im Code).
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { pflicht } from "./umgebung";

export type Db = ReturnType<typeof dbClient>;

function dbClient(
  cookieStore: Awaited<ReturnType<typeof cookies>>,
  schreiben: boolean,
) {
  return createServerClient(
    pflicht("SUPABASE_URL"),
    pflicht("SUPABASE_PUBLISHABLE_KEY"),
    {
      db: { schema: pflicht("APP_SCHEMA") },
      cookies: {
        getAll: () => cookieStore.getAll(),
        // Seiten dürfen keine Cookies setzen; die Sitzung erneuert `src/proxy.ts`. Routen (Anmelden, Callback) schreiben.
        setAll: (liste) => {
          if (!schreiben) return;
          for (const { name, value, options } of liste)
            cookieStore.set(name, value, options);
        },
      },
    },
  );
}

/** Für Seiten und Actions: liest die Sitzung, schreibt keine Cookies. */
export async function lesenderClient(): Promise<Db> {
  return dbClient(await cookies(), false);
}

/** Für Routen, die die Sitzung anlegen oder beenden (`/auth/*`). */
export async function schreibenderClient(): Promise<Db> {
  return dbClient(await cookies(), true);
}
