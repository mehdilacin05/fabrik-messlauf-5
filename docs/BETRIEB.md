<!-- Vorlage: docs/BETRIEB.md (Betriebsanleitung der App). Im Gerüst-Schritt ins Repo kopieren, <…> ausfüllen. Nur Technik; keine Passwörter, nur sagen, wo sie liegen. -->

# Betrieb: <App>

Stand: <Datum>.

## 1. Wo liegt was

| Was                          | Wo                                                                     | Wer hat Zugang |
| ---------------------------- | ---------------------------------------------------------------------- | -------------- |
| Code, Pipeline               | GitHub: <owner/repo>                                                   | <…>            |
| Server (Hostinger-VPS)       | Portainer, Adresse <…> (hPanel nur für Server und Docker-Installation) | <…>            |
| App live / Staging           | <https://…> / <https://…>                                              | alle           |
| `.env`-Kopie, `JWT_SECRET`   | <Passwortmanager, Eintrag … / Umschlag beim Kunden>                    | <…>            |
| Domain, DNS                  | <Anbieter>                                                             | <…>            |
| Mail-Dienst (SPF/DKIM/DMARC) | <…>                                                                    | <…>            |

## 2. Wenn etwas ausfällt (erst Schaden stoppen, dann Ursache suchen)

1. App nicht erreichbar: Externer Check meldet es. Auf dem Server nur lesen: `docker compose ps`, `docker compose logs --since 1h app`, `df -h`, `free -h`.
2. Nach einer Auslieferung kaputt: **Rollback** = Workflow „promote“ mit dem SHA des letzten guten Stands (GitHub → Actions → promote → Run workflow). Letzter guter Stand: `<sha>`.
3. GitHub nicht erreichbar: auf dem Server `IMAGE_TAG=sha-<alter commit>` in die `.env`, dann `docker compose pull && docker compose up -d`.
4. Platte voll: `docker system df`, alte Images entfernen, Logs prüfen; danach Ursache (Rotation) beheben.
5. Server weg oder defekt: neuen VPS anlegen, `server/setup.sh` ausführen, Compose-Stack aus dem Repo anlegen, Datenbank und `auth`-Schema aus der Sicherung des Betreibers einspielen, DNS umstellen (TTL vorher auf 300 s).

## 3. Sicherung

- Sicherung vor jeder Migration: Volume `backup` (`scripts/migrate.sh`, die letzten 5).
- Tägliche Sicherung des Servers ist Betrieb, nicht Teil dieses Skills.
