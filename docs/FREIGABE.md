# Freigabe Design: Geräte-Inventar fürs Büro

Stand: 2026-11-25 · Klasse: M · Heikel: nein · Höchstens 1 Seite. Freigabe = Merge des Design-PR; Änderungen als Kommentar mit Nummer.

**App-Typ:** A Internes Werkzeug · **In einem Satz:** Das Büro (ca. 25 Leute) verwaltet Laptops, Monitore, Handys, Headsets: wer hat was, mit Historie.

**Architektur in 5 Zeilen**
1. Ein Next.js-Container (Module `geraet`, `person`, `kategorie`) hinter dem vorhandenen Traefik.
2. Daten und Login in der vorhandenen Supabase des Servers, eigenes Schema; Login nur Microsoft, ein Mandant.
3. Ausgabe, Rücknahme, Ausmustern: je eine DB-Funktion, Zustand und Historie in einer Transaktion.
4. RLS an jeder Tabelle; Mitarbeiter sehen nur ihre eigenen Geräte; Historie nur anhängend.
5. Staging als eigener Stack; der Server zieht selbst nach; Fehler an GlitchTip; externer Check auf `/health`.

**Bauplan** (Details: `docs/BAUPLAN.md`)
1. Gerüst – fertig, wenn `make check` und `/health` grün sind
2. Tabellen mit RLS – fertig, wenn A nichts von B liest
3. Ausgabe-Funktionen – fertig, wenn von zwei gleichzeitigen Ausgaben eine gewinnt
4. Anmeldung, Rechte, Module – fertig, wenn Login-Tests und Modulgrenzen grün sind
5. Geräte und Kategorien – fertig, wenn Ausgabe und Rücknahme im Browser laufen
6. Personen – fertig, wenn Sperren und Anonymisieren die Regeln einhalten
7. Übersicht, Historie, Mitarbeiter-Sicht – fertig, wenn Filter und „nur eigene“ stimmen
8. Betrieb – fertig, wenn `make restore` einen Dump wiederherstellt
9. Sicherheitstests – fertig, wenn `make security` besteht

**Laufende Kosten je Monat:** 0 € zusätzlich, rund 4 GB RAM (Budget: keins genannt)

**Annahmen, bitte bestätigen**
1. Die Verwaltung legt neue Mitarbeiter vorab mit Name und Firmen-Mail an; der erste Microsoft-Login verknüpft das Konto → Abschnitt 5, 10
2. Im Login-Dienst des Servers sind nur der Mandant des Büros eingetragen, Mail-Registrierung, Autoconfirm und anonyme Anmeldung aus → Abschnitt 10
3. Der Dienstleister sichert täglich konsistent (Dump oder Snapshot) und betreibt den Uptime-Check → Abschnitt 11
4. Mehrfaktor erzwingt das Büro in Microsoft → Abschnitt 10

**Fragen**
1. Soll die erste Verwaltungsperson über `VERWALTUNG_START_EMAIL` (Mail der Einrichtenden) bestimmt werden? Vorschlag: ja (E3).

**Prüfbefunde (Stufe 04)**
1. Blocker: DB-Funktionen direkt über die Supabase-API erreichbar → Rechte je Funktion, Katalogtest (Schritt 2) eingearbeitet
2. Blocker: Start-Mail von E3 gelangt nicht sicher in die DB → Tabelle ohne Rechte, ADR 003 eingearbeitet
3. Mail-Konto gleicher Adresse übernimmt Microsoft-Konto → Registrierung aus, Identitätsprüfung eingearbeitet
4. Geteilte Supabase nie geprüft → Prüfliste, Staging-Login eingearbeitet
5. Testhilfen, Anonymisieren, Sicherung (Q4) → eingearbeitet; Details `docs/PRUEFUNG.md`

**Freigabe:** Merge des PR „Design: Geräte-Inventar“ durch den Auftraggeber. Danach starten die Bau-Karten von selbst.
