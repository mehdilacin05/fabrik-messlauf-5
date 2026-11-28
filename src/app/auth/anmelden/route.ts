import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { eigeneAdresse } from "@/lib/adresse";
import { schreibenderClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/** Startet den Microsoft-Login (Code-Austausch mit PKCE; das Verifier-Cookie schreibt der Client). */
export async function POST() {
  const adresse = eigeneAdresse(await headers());
  const db = await schreibenderClient();
  const { data, error } = await db.auth.signInWithOAuth({
    provider: "azure",
    options: {
      redirectTo: `${adresse}/auth/callback`,
      scopes: "email",
      skipBrowserRedirect: true,
    },
  });
  if (error || !data.url)
    return NextResponse.redirect(new URL("/anmelden?fehler=1", adresse), 303);
  return NextResponse.redirect(data.url, 303);
}
