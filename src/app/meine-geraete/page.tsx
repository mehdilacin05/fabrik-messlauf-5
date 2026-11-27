import { meineGeraete } from "@/modules/geraet";
import { seitenZugang } from "@/lib/zugang";

export const dynamic = "force-dynamic";

export default async function MeineGeraete() {
  const { db } = await seitenZugang(["mitarbeiter", "verwaltung"]);
  const liste = await meineGeraete(db);
  return (
    <main>
      <h1>Meine Geräte</h1>
      {liste.length === 0 ? (
        <p>Keine Geräte</p>
      ) : (
        <ul>
          {liste.map((g) => (
            <li key={g.seriennummer}>
              {g.bezeichnung} ({g.seriennummer})
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
