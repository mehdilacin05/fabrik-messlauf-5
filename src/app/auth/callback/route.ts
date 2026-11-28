import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { eigeneAdresse } from "@/lib/adresse";
import { nurAzure } from "@/lib/kontext";
import { schreibenderClient } from "@/lib/supabase";
import { personVerknuepfen } from "@/modules/person";

export const dynamic = "force-dynamic";

/** Rückweg vom Microsoft-Login: Code tauschen, Konto mit der Person verknüpfen, sonst abmelden („Kein Zugang“). */
export async function GET(request: Request) {
  const adresse = eigeneAdresse(await headers());
  const weg = (pfad: string) =>
    NextResponse.redirect(new URL(pfad, adresse), 303);
  const code = new URL(request.url).searchParams.get("code");
  if (!code) return weg("/anmelden?fehler=1");

  const db = await schreibenderClient();
  const { error } = await db.auth.exchangeCodeForSession(code);
  if (error) return weg("/anmelden?fehler=1");

  const { data } = await db.auth.getClaims();
  if (!nurAzure(data?.claims.app_metadata) || !(await personVerknuepfen(db))) {
    await db.auth.signOut();
    return weg("/kein-zugang");
  }
  return weg("/");
}
