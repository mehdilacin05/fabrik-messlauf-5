# 002 · Live nutzt die vorhandene Supabase des Servers mit eigenem Schema

Datum: 2026-11-25 · Status: vorgeschlagen · Kennung: E2
Treiber: Frage 8 (vorhandener Server, Supabase läuft dort), Q4 (Wiederherstellung), Q3
Bestätigung: make e2e (App läuft im Wegwerf-Stack gegen eine Supabase mit beliebigem `APP_SCHEMA`; `/health` 200 nur, wenn das Schema stimmt)

## Lage
Im Interview offen: die vorhandene Supabase mitnutzen oder eine eigene Instanz daneben betreiben. Die Wahl bestimmt RAM, Sicherung, Login-Konfiguration und ist nach dem Livegang nur mit Datenumzug umkehrbar.

## Optionen
| Option | Vorteile | Nachteile | Preis |
|---|---|---|---|
| A: vorhandene Supabase, eigenes Schema `APP_SCHEMA`, eigener Migrations-Nutzer | kein zusätzlicher Dienst; Sicherung des Servers deckt sie mit ab; Standard des Ziels vps | Login-Dienst geteilt mit anderen Apps des Servers; Schema und Rechte richtet der Mensch einmal ein | 0 MB zusätzlich, einmalig ca. 0,5 h Einrichtung |
| B: eigene Supabase-Instanz nur für das Inventar | Login und Daten völlig getrennt | ca. 1 GB RAM mehr, eigene Sicherung, eigene Updates, mehr Angriffsfläche | ca. 1 GB RAM, ca. 1 h Pflege/Monat |

## Entscheidung
A, weil der Server und seine Supabase vorhanden sind (Frage 8) und die Sicherung des Dienstleisters sie bereits erfasst (Q4). Verworfen: B, weil Mehraufwand ohne Auslöser. Staging bekommt trotzdem eine eigene kleine Supabase (Testkonten nie im Live-Login).

## Folgen
Leichter: Betrieb, Sicherung, RAM. Schwerer: Die Login-Einstellungen (Anbieter Azure, Tenant-URL) gelten für alle Apps dieser Supabase. Neu entscheiden, wenn auf dem Server Apps eines anderen Microsoft-Mandanten oder mit Mail-Registrierung laufen sollen (dann B oder eigene Auth-Instanz).
