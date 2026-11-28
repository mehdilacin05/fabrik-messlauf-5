export default function KeinZugang() {
  return (
    <main>
      <h1>Kein Zugang</h1>
      <p>
        Für dieses Konto gibt es keinen Zugang. Bitte an die Verwaltung wenden.
      </p>
      <form method="post" action="/auth/abmelden">
        <button type="submit">Abmelden</button>
      </form>
    </main>
  );
}
