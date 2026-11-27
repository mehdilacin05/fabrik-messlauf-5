import { seitenZugang } from "@/lib/zugang";

export const dynamic = "force-dynamic";

export default async function Personen() {
  await seitenZugang(["verwaltung"]);
  return (
    <main>
      <h1>Personen</h1>
    </main>
  );
}
