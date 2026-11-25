# 001 · Ausgabe, Rücknahme und Ausmustern laufen als DB-Funktion in einer Transaktion

Datum: 2026-11-25 · Status: vorgeschlagen · Kennung: E1
Treiber: Q2 (ein Gerät bei genau einer Person, jeder Wechsel mit Historie), Q1
Bestätigung: make test (Integrationstest mit echter DB: zwei parallele Ausgaben → genau eine gelingt; jeder Zustandswechsel hat genau ein Ereignis; Mitarbeiter-Aufruf → `nicht_erlaubt`)

## Lage
Ein Zustandswechsel ändert zwei Tabellen: `geraet` (Status, Inhaber) und `geraet_ereignis` (Historie). Beides muss gemeinsam gelingen oder gemeinsam scheitern, auch wenn zwei Personen der Verwaltung gleichzeitig klicken. Die Wahl prägt jede Migration und jede Action, darum jetzt.

## Optionen
| Option | Vorteile | Nachteile | Preis |
|---|---|---|---|
| A: je Wechsel eine Postgres-Funktion (`geraet_ausgeben` …), aufgerufen per `rpc` mit dem Token des Nutzers; prüft Rolle, macht bedingtes Update und Ereignis in einer Transaktion | atomar ohne eigene DB-Verbindung; Regel gilt auch, wenn jemand PostgREST direkt aufruft; Tabellen brauchen keine Schreibregeln | Logik teils in SQL (zwei Sprachen); Funktionen brauchen `security definer` mit festem `search_path` und eigener Rollenprüfung | ca. 4 kleine SQL-Funktionen mit Tests; Review-Aufwand für SQL |
| B: Server Action macht zwei PostgREST-Aufrufe (Update, dann Insert) | alles in TypeScript | keine gemeinsame Transaktion: bricht der zweite Aufruf ab, fehlt Historie; Schreibregeln auf beiden Tabellen nötig, also auch direkt über PostgREST nutzbar | Abgleich-Job oder Reparatur von Hand; Q2 nicht beweisbar |
| C: eigene DB-Verbindung (Drizzle/pg) mit Transaktion im App-Code | Transaktion in TypeScript | zweiter Datenzugang neben supabase-js, Abweichung von der Stack-Karte; RLS gilt nur mit gesetzter Rolle je Verbindung | zusätzliche Abhängigkeit, Verbindungs-Pool, eigenes Geheimnis |

## Entscheidung
A, weil Q2 nur mit einer Transaktion beweisbar ist und Q1 dann auch bei direktem PostgREST-Aufruf gilt. Verworfen: B, weil Historie verloren gehen kann; C, weil zweiter Datenzugang ohne Bedarf.

## Folgen
Leichter: Integrität in der DB, einfache Actions (prüfen, `rpc`, Fehlercode übersetzen). Schwerer: SQL-Funktionen brauchen eigene Tests (`make test` mit `set local role authenticated`), Änderungen nur per Migration. Neu entscheiden, wenn ein Wechsel mehr als die DB berührt (z. B. Mail beim Ausgeben): dann Outbox-Zeile in derselben Funktion.
