import { seitenZugang } from "@/lib/zugang";

export const dynamic = "force-dynamic";

export default async function Geraete() {
  await seitenZugang(["verwaltung"]);
  return (
    <main>
      <h1>Geräte</h1>
    </main>
  );
}
