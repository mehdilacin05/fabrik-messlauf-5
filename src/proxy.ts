// Erneuert die Sitzung (Token ablaufen, Cookies neu schreiben), bevor Seiten sie lesen. Seiten selbst schreiben keine Cookies.
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { pflicht } from "@/lib/umgebung";

export async function proxy(request: NextRequest) {
  let antwort = NextResponse.next({ request });
  const db = createServerClient(
    pflicht("SUPABASE_URL"),
    pflicht("SUPABASE_PUBLISHABLE_KEY"),
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (liste) => {
          for (const { name, value } of liste) request.cookies.set(name, value);
          antwort = NextResponse.next({ request });
          for (const { name, value, options } of liste)
            antwort.cookies.set(name, value, options);
        },
      },
    },
  );
  await db.auth.getClaims();
  return antwort;
}

export const config = {
  matcher: ["/((?!health|_next/static|_next/image|favicon.ico).*)"],
};
