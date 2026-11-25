# Nachweise

Ergebnisse von Prüfungen mit Datum und Commit. Sicherheitstests, Wiederherstellung und Lasttest trägt Bauplan-Schritt 9 ein; bis dahin nur das Gerüst.

| Datum | Prüfung | Ergebnis | Commit |
|---|---|---|---|
| 2026-11-25 | `make image-groesse` (Image 319 MB, Grenze 350 MB, Node 26 auf arm64) | bestanden | siehe PR „Schritt 1“ |
| 2026-11-25 | `make health-test`: 200 mit Commit-SHA; 503 ohne Datenbank; 503 bei nicht freigegebenem Schema | bestanden | siehe PR „Schritt 1“ |

## Offen bis Schritt 9
- Sicherheitstests vor dem Livegang nach `sicherheit-tests.md`.
- Wiederherstellung aus der echten Sicherung auf Staging (mit Dauer).
- Microsoft-Login mit einem Testkonto auf Staging.
