import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { eigeneAdresse } from "@/lib/adresse";
import { schreibenderClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function POST() {
  const adresse = eigeneAdresse(await headers());
  await (await schreibenderClient()).auth.signOut();
  return NextResponse.redirect(new URL("/anmelden", adresse), 303);
}
