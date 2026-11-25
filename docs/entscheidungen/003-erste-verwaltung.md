# 003 · Die erste Verwaltungsperson wird über `VERWALTUNG_START_EMAIL` bestimmt

Datum: 2026-11-25 · Status: vorgeschlagen · Kennung: E3
Treiber: Q1 (Zugriffsschutz), Frage 2 (erste Verwaltungsperson ist, wer die App einrichtet)
Bestätigung: make test (ohne Variable und ohne Verwaltung → `/health` 503 und kein Login wird Verwaltung; mit Variable → nur genau diese Mail mit Microsoft-Identität wird Verwaltung, nur solange es keine gibt)

## Lage
Beim ersten Start gibt es niemanden mit Verwaltungsrecht, der andere benennen könnte. Wer zuerst Verwaltung wird, entscheidet über alle Rechte danach.

## Optionen
| Option | Vorteile | Nachteile | Preis |
|---|---|---|---|
| A: Variable `VERWALTUNG_START_EMAIL` beim Einrichten; diese Mail wird beim ersten Login Verwaltung, solange keine Verwaltung existiert | eindeutig, vom Einrichtenden gesteuert; kein Wettlauf | eine Variable mehr; Tippfehler = niemand wird Verwaltung (laut sichtbar über `/health`) | eine Zeile in `.env`, ein Test |
| B: Wer sich als Erster anmeldet, wird Verwaltung | nichts einzurichten | Wettlauf: ein beliebiger Mitarbeiter kann sich vor der IT anmelden und alle Rechte bekommen | Risiko für Q1 |
| C: Verwaltung per SQL von Hand setzen | keine App-Logik | Handgriff in der Live-DB, nicht nachvollziehbar, widerspricht „nichts von Hand“ | Einrichtungsschritt mit DB-Zugang |

## Entscheidung
A, weil Q1 keinen Wettlauf um Rechte erlaubt und Frage 2 die einrichtende Person nennt. Verworfen: B wegen Wettlauf, C wegen Handgriff in Produktion.

## Folgen
Leichter: Einrichtung in einem Schritt, Verhalten testbar. Schwerer: die Variable ist nach der Einrichtung wirkungslos und kann bleiben; Wechsel der Verwaltung danach nur in der App. Neu entscheiden, wenn Rollen aus Microsoft-Gruppen kommen sollen.
