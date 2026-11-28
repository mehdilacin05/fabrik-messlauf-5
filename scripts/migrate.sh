#!/bin/sh
# Vorlage: scripts/migrate.sh. Läuft beim Start des Containers VOR der App (Dockerfile CMD), mit eigenem DB-Nutzer.
# 1. Sicherung des App-Schemas nach /backup (Volume), die letzten 5 bleiben.
# 2. Jede neue Datei aus /app/migrations in genau einer Transaktion; Stand in <schema>.schema_migrations.
# Scheitert eine Migration, bleibt die DB unverändert, der Container startet nicht (Health rot, Alarm).
# Rückweg: Promote mit altem SHA; der alte Code passt zur unveränderten DB.
# Migrationen nennen das Schema ausdrücklich (`create table <schema>.todos`), die erste legt es an: so landen
# sie lokal (Supabase CLI) und auf dem Server gleich. Getestet wird dieser Weg auf Staging bei jedem Merge.
# Die App selbst läuft danach ohne MIGRATE_DATABASE_URL (Nutzer ohne Tabellenrechte, DATABASE_URL).
set -eu
if [ "${MIGRATE:-an}" = "aus" ]; then echo "migrate: aus (CI: Supabase CLI hat die Migrationen schon eingespielt)"; exit 0; fi
: "${MIGRATE_DATABASE_URL:?MIGRATE_DATABASE_URL fehlt (Nutzer mit Rechten auf das App-Schema)}"
: "${APP_SCHEMA:?APP_SCHEMA fehlt (eigenes Schema dieser App)}"
DB="$MIGRATE_DATABASE_URL"
# E3: Start-Mail der ersten Verwaltung in die Tabelle ohne Rechte für anon und authenticated; nur person_verknuepfen() liest sie.
# Wert und Schema gehen als psql-Variablen (:'mail', :"schema"), nie als Text in die SQL-Zeile.
startmail() {
  [ -n "${VERWALTUNG_START_EMAIL:-}" ] || return 0
  psql "$DB" -qX -v ON_ERROR_STOP=1 -v schema="$APP_SCHEMA" -v mail="$VERWALTUNG_START_EMAIL" <<'SQL'
insert into :"schema".verwaltung_start (email) values (:'mail')
on conflict (id) do update set email = excluded.email, updated_at = now();
SQL
}
psql "$DB" -qtAX -v ON_ERROR_STOP=1 -c "create schema if not exists \"$APP_SCHEMA\";
  create table if not exists \"$APP_SCHEMA\".schema_migrations (datei text primary key, am timestamptz default now());"
neu=""
for f in /app/migrations/*.sql; do
  [ -e "$f" ] || continue
  n=$(basename "$f")
  da=$(psql "$DB" -qtAX -c "select 1 from \"$APP_SCHEMA\".schema_migrations where datei = '$n'")
  [ "$da" = "1" ] || neu="$neu $f"
done
if [ -z "$neu" ]; then startmail; echo "migrate: nichts zu tun"; exit 0; fi
mkdir -p /backup
stempel=$(date -u +%Y%m%dT%H%M%SZ)
pg_dump "$DB" -n "$APP_SCHEMA" -Fc -f "/backup/$APP_SCHEMA-$stempel.dump"
ls -1t /backup/"$APP_SCHEMA"-*.dump | tail -n +6 | xargs -r rm -f
for f in $neu; do
  n=$(basename "$f")
  echo "migrate: $n"
  { cat "$f";
    echo "insert into \"$APP_SCHEMA\".schema_migrations(datei) values ('$n');"; } \
    | psql "$DB" -qX -1 -v ON_ERROR_STOP=1
done
startmail
