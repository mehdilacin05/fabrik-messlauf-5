# Architektur: Geräte-Inventar fürs Büro

Auftraggeber: Büro (ca. 25 Personen), Issue #1 · Stand: 2026-11-25 · Klasse: M · Heikel: nein · Risiko: keins
Profil: profile/nextjs-supabase · Ziel: ziele/vps
Status: Interview

Prüfen: `python3 {SKILL_DIR}/scripts/pruefe_architektur.py .` · Rechnen: `python3 {SKILL_DIR}/scripts/rechnen.py . --schreiben`

## 1. Kurzfassung
- **App-Typ:** Interne Web-Verwaltung (CRUD mit Historie)
- **In einem Satz:** Das Büro (ca. 25 Leute) verwaltet Laptops, Monitore, Handys und Headsets: wer hat was, mit Historie.
- **Architektur in 5 Zeilen:** noch offen, folgt in Stufe 02.

## 2. Anforderungen (aus dem Interview)
| # | Frage | Antwort |
|---|---|---|
| 1 | Was tut die App, für wen? Eine Funktion für Tag 1? | Geräte erfassen, an Mitarbeiter ausgeben und zurücknehmen, ausmustern; Übersicht mit Filter und Suche; Historie je Gerät. Kern: Ausgabe und Rücknahme, ein Gerät ist immer im Lager oder bei genau einer Person (Issue). |
| 2 | Rollen, wer ruft die Schnittstelle auf? | Zwei Rollen: Verwaltung (2–3 Personen, benennt die Verwaltung selbst in der App; erste Verwaltungsperson ist, wer die App einrichtet), Mitarbeiter (sehen nur ihre eigenen aktuellen Geräte, keine früheren). Nur eigene App, kein Partnerzugriff (Annahme). Anmeldung nur mit dem Microsoft-Firmenkonto (Issue). |
| 3 | Nutzer, Aktionen, Stunden, Spitzen, Antwortzeit? | Bestätigt: 25 Nutzer, 10 Aktionen/Tag, 8 h, Spitze × 5, DACH; p95 < 500 ms als Messpunkt, nicht zugesagt. |
| 4 | Daten, Menge, Aufbewahrung? | Personenbezogen: Name und Firmen-Mail der Mitarbeiter, Zuordnung Gerät zu Person. Nicht heikel. Menge: wenige hundert Geräte, einige tausend Historienzeilen/Jahr. Aufbewahrung: bestätigt, Historie unbegrenzt (Issue: nicht löschen); Seriennummer bleibt für immer reserviert, keine Wiederaufnahme in V1. Ausgeschiedene Mitarbeiter: Konto gesperrt, Name bleibt in der Historie, Löschung personenbezogener Angaben nur auf Anfrage. Daten nur auf einem Server in Deutschland (Issue). |
| 5 | Mandanten? | Nein (ein Büro). |
| 6 | Web, Handy, offline? | Web, mobil nutzbar; keine Handy-App, kein Offline (Issue: nicht nötig). |
| 7 | Anbindungen? | Microsoft-Firmenkonto-Login (Entra ID); Tenant-ID trägt die IT des Büros bei der Einrichtung ein, die App-Registrierung legt das Büro selbst an. Sonst keine. Nicht nötig: Bestellungen, Rechnungen, Barcode-Scanner. |
| 8 | Hosting, Ausfall, RTO, RPO? | Bestätigt: vorhandener Server beim deutschen Dienstleister des Büros (ARM, Docker mit Portainer und Traefik, Supabase läuft dort bereits); Betrieb dort, Testversion (Staging) und Live. 99,5 % per externem Check auf `/health`; RTO 4 h, RPO 24 h; keine Bereitschaft, keine SLA. |

### Annahmen
- Nur eigene App ruft die Schnittstelle auf → betrifft Abschnitt 4
- Kategorien (Start: Laptop, Monitor, Handy, Headset) pflegt die Verwaltung selbst (bestätigt) → betrifft Abschnitt 5
- Seriennummer ist je Gerät eindeutig, auch über ausgemusterte Geräte hinweg (bestätigt) → betrifft Abschnitt 5
- Bestehendes Supabase auf dem Server wird mitgenutzt oder eine eigene Instanz daneben; Entscheidung in Stufe 02 → betrifft Abschnitt 7, 11

### Umfang
- **Version 1:** Geräte anlegen und ausmustern, Ausgabe und Rücknahme, Übersicht mit Filter (Kategorie, Status) und Suche nach Seriennummer, Historie je Gerät, Mitarbeiter-Sicht, Kategorien pflegen (Verwaltung).
- **Nicht in Version 1:** Bestellungen, Rechnungen, Barcode, Handy-App, Export.

## 3. Qualitätsziele
Rang 1 gewinnt im Konflikt.

| Kennung | Rang | Merkmal | Szenario | Zielwert | Nachweis |
|---|---|---|---|---|---|
| Q1 | 1 | Zugriffsschutz | Wenn ein Mitarbeiter die Geräteliste lädt oder fremde Gerät-IDs abruft, dann sieht er nur seine eigenen Geräte | 0 fremde Zeilen | make test |
| Q2 | 2 | Datenintegrität | Wenn ein Gerät ausgegeben wird, dann ist es danach bei genau einer Person; Doppelausgabe wird abgewiesen | 0 Geräte mit 2 Besitzern, 0 doppelte Seriennummern | make test |
| Q3 | 3 | Datenschutz und Herkunft | Wenn Daten gespeichert werden, dann nur auf dem Server in Deutschland | 0 Dienste außerhalb DE/EU mit Personendaten | make check |
| Q4 | 4 | Wiederherstellbarkeit | Wenn der Server ausfällt, dann ist die App wieder da | RTO 4 h, RPO 24 h | make restore |
