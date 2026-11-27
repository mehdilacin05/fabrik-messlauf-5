<!-- Betriebsanleitung der App. Nur Technik; keine Passwörter, nur sagen, wo sie liegen. Offene Stellen (offen: …) trägt der Dienstleister bei der Einrichtung ein. -->

# Betrieb: Geräte-Inventar

Stand: 2026-11-25 (Gerüst, Bauplan-Schritt 1).

## 1. Wo liegt was

| Was                          | Wo                                                                     | Wer hat Zugang |
| ---------------------------- | ---------------------------------------------------------------------- | -------------- |
| Code, Pipeline               | GitHub: mehdilacin05/fabrik-messlauf-5                                                   | offen            |
| Server (Hostinger-VPS)       | Portainer des Servers (Adresse: offen, Dienstleister) (hPanel nur für Server und Docker-Installation) | offen            |
| App live / Staging           | offen (`APP_HOST` je Stack, Dienstleister) / offen                                              | alle           |
| `.env`-Kopie, `JWT_SECRET`   | Passwortmanager des Dienstleisters (Eintrag: offen)                    | offen            |
| Domain, DNS                  | offen (Dienstleister)                                                             | offen            |
| Mail-Dienst (SPF/DKIM/DMARC) | offen                                                                    | offen            |

## 2. Wenn etwas ausfällt (erst Schaden stoppen, dann Ursache suchen)

1. App nicht erreichbar: Externer Check meldet es. Auf dem Server nur lesen: `docker compose ps`, `docker compose logs --since 1h app`, `df -h`, `free -h`.
2. Nach einer Auslieferung kaputt: **Rollback** = Workflow „promote“ mit dem SHA des letzten guten Stands (GitHub → Actions → promote → Run workflow). Letzter guter Stand: noch keiner (vor dem ersten Promote).
3. GitHub nicht erreichbar: auf dem Server `IMAGE_TAG=sha-<alter commit>` in die `.env`, dann `docker compose pull && docker compose up -d`.
4. Platte voll: `docker system df`, alte Images entfernen, Logs prüfen; danach Ursache (Rotation) beheben.
5. Server weg oder defekt: neuen VPS anlegen, `server/setup.sh` ausführen, Compose-Stack aus dem Repo anlegen, Datenbank und `auth`-Schema aus der Sicherung des Betreibers einspielen, DNS umstellen (TTL vorher auf 300 s).

## 3. Sicherung

- Sicherung vor jeder Migration: Volume `backup` (`scripts/migrate.sh`, die letzten 5).
- Tägliche Sicherung des Servers ist Betrieb, nicht Teil dieses Skills.

## 4. Gesundheitsprüfung `/health`
- Öffentlich, ohne Personendaten: `GET /health` → `200 {"ok":true,"revision":"<Commit-SHA>"}`; sonst `503 {"ok":false,"revision":…,"fehler":"…"}`.
- Geprüft wird, ob `APP_SCHEMA`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` und `VERWALTUNG_START_EMAIL` gesetzt sind (Letztere bleibt nach der Einrichtung gesetzt; ohne sie 503, damit eine fehlende erste Verwaltung auffällt) und ob PostgREST das Schema `APP_SCHEMA` beantwortet (`GET <SUPABASE_URL>/rest/v1/` mit `Accept-Profile`). PostgREST fragt dabei die Datenbank ab: Datenbank weg → 503, Schema nicht freigegeben → 503.
- Der externe Check (Uptime Kuma des Dienstleisters) ruft `/health` jede Minute auf und warnt vor Zertifikatsablauf.
- Lokaler Nachweis: `make health-test` (Wegwerf-Postgres, -PostgREST und -Gateway; 200, 503 ohne Datenbank, 503 bei falschem Schema).

## 5. Prüfliste der geteilten Supabase (einmal je Server und App)
1. `APP_SCHEMA` steht in `PGRST_DB_SCHEMAS` der Daten-API (sonst `/health` 503 mit „… antwortet 406“).
2. Einrichtungs-SQL aus dem Profil (Migrations-Nutzer `<APP_SCHEMA>_migrate`, Schema, Rechte) ist als `postgres` gelaufen.
3. Die Daten-API-Wurzel `<SUPABASE_URL>/rest/v1/` antwortet mit dem öffentlichen Schlüssel (200). Sperrt die Supabase den Wurzelaufruf für diesen Schlüssel (`/health` 503 mit „… antwortet 401“ oder „403“), muss das vor dem Livegang geklärt werden; Bauplan-Schritt 8 stellt `/health` dann auf eine Tabellenabfrage um.
4. Registrierung ist aus, Microsoft-Login (Tenant-URL) und Callback in der Redirect-Liste sind eingetragen (ab Bauplan-Schritt 4).

## 6. Einrichtung des Klons
- Einmal je Klon: `make hooks`. Danach läuft vor jedem `git push` gitleaks über die ganze Historie (`.githooks/pre-push`); ein Fund bricht den Push ab. Ein gefundenes Geheimnis wird widerrufen, nicht nur gelöscht.
- Workflow-Dateien liegen als Vorlagen unter `ci-vorschlag/`; der Betreiber legt sie nach `.github/` (`/workflows <pr>`).
- Für den CI-Job `app-e2e` braucht das Image `APP_SCHEMA` (und ab Bauplan-Schritt 4 `VERWALTUNG_START_EMAIL`) als Umgebungsvariable; die Vorlage `ci-vorschlag/ci.yml` setzt beide im `docker run` (`APP_SCHEMA` aus der Migration, `VERWALTUNG_START_EMAIL=start@test.example`); eine schon abgelegte `.github/workflows/ci.yml` braucht diese Zeile ebenfalls (ohne sie meldet `/health` 503 und `app-e2e` bricht mit „App wird nicht gesund“ ab). Das Schema `inventar` legt die erste Migration (`supabase/migrations/*_schema.sql`) an; ohne sie lädt PostgREST den Schema-Cache nicht und `/health` meldet 503.

## 7. Fristen (Kalender, 30 Tage Vorlauf)
- Client-Secret der Microsoft-App-Registrierung (läuft spätestens nach 24 Monaten ab; danach kein Login).
- Domain und Zertifikate (Traefik erneuert Let's-Encrypt-Zertifikate selbst; Ausfall zeigt der externe Check).
- Node 26: Support voraussichtlich bis Ende April 2029; vorher Major-Wechsel als eigener PR (`.nvmrc`, `ARG NODE_IMAGE`, `@types/node`).
- Image auf GHCR öffentlich (keine Geheimnisse im Image); wird das Repo privat, kommt ein Lese-Token mit Ablauf dazu.

## 8. Anmeldung und erste Verwaltung (ab Bauplan-Schritt 4)
- Login nur über Microsoft Entra ID (Anbieter `azure` in Supabase Auth, ein Mandant). Mail-Registrierung, Autoconfirm, anonyme und Telefon-Anmeldung im Login-Dienst ausschalten; `/auth/callback` der App steht in der Redirect-Liste.
- Erste Verwaltung: `VERWALTUNG_START_EMAIL` (Firmen-Mail der einrichtenden Person) in der `.env` des Stacks setzen. Der Container schreibt sie beim Start (`scripts/migrate.sh`) in die Tabelle `verwaltung_start`; wer sich danach mit dieser Mail über Microsoft anmeldet, wird Verwaltung, aber nur solange es keine Verwaltung gibt. Danach benennt die Verwaltung weitere Personen in der App. Tippfehler in der Mail: Variable korrigieren, Stack neu starten.
- Der Migrations-Nutzer `<APP_SCHEMA>_migrate` braucht Leserecht auf `auth.users` und `auth.identities`, weil `person_verknuepfen()` als dessen Eigentümer läuft und dort die Anmeldeart prüft (`grant select on auth.users, auth.identities to <APP_SCHEMA>_migrate;` einmal als `postgres`).
- Wer kein Microsoft-Konto hat, keine Person zur Mail, oder gesperrt ist, sieht „Kein Zugang“ und wird abgemeldet.
