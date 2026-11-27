export const dynamic = "force-dynamic";

export default async function Anmelden({
  searchParams,
}: {
  searchParams: Promise<{ fehler?: string }>;
}) {
  const { fehler } = await searchParams;
  return (
    <main>
      <h1>Anmelden</h1>
      {fehler ? (
        <p role="alert">
          Anmeldung fehlgeschlagen. Bitte noch einmal versuchen.
        </p>
      ) : null}
      <form method="post" action="/auth/anmelden">
        <button type="submit">Mit Microsoft anmelden</button>
      </form>
    </main>
  );
}
