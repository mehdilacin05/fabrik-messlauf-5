import { redirect } from "next/navigation";
import { startZiel } from "@/lib/zugang";

export const dynamic = "force-dynamic";

export default async function Start() {
  redirect(await startZiel());
}
