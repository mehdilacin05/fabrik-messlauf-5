// Zugang für Seiten: ohne Sitzung zur Anmeldung, ohne Person oder gesperrt zu „Kein Zugang“, falsche Rolle zur Startseite.
import { redirect } from "next/navigation";
import { ladeKontext, type Kontext, type Zugang } from "./kontext";
import { lesenderClient } from "./supabase";
import type { Rolle } from "../modules/person";

export const startseite = (rolle: Rolle) =>
  rolle === "verwaltung" ? "/geraete" : "/meine-geraete";

type Abgewiesen = Extract<Zugang, { ok: false }>;
const abweisung = (z: Abgewiesen) =>
  z.grund === "nicht_angemeldet" ? "/anmelden" : "/kein-zugang";

/** Start (/): wohin diese Sitzung gehört. */
export async function startZiel(): Promise<string> {
  const z = await ladeKontext(await lesenderClient());
  return z.ok ? startseite(z.kontext.person.rolle) : abweisung(z);
}

/** Für Seiten, die nur bestimmte Rollen sehen dürfen. */
export async function seitenZugang(erlaubt: Rolle[]): Promise<Kontext> {
  const z = await ladeKontext(await lesenderClient());
  if (!z.ok) redirect(abweisung(z));
  if (!erlaubt.includes(z.kontext.person.rolle))
    redirect(startseite(z.kontext.person.rolle));
  return z.kontext;
}
