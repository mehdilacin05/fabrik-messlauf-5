#!/bin/bash
# make health-test: das gebaute Image gegen Wegwerf-Postgres und -PostgREST. Erwartet /health 200 mit dem Commit-SHA,
# nach dem Stoppen der Datenbank 503. Alles im eigenen Docker-Netz, Aufrufe per `docker exec` (läuft auch mit entferntem Docker).
# Eingabe (Umgebung): IMAGE, GIT_SHA, TESTDB_IMAGE, REST_IMAGE.
set -euo pipefail
: "${IMAGE:?}" "${GIT_SHA:?}" "${TESTDB_IMAGE:?}" "${REST_IMAGE:?}"
n="health-test-$$"
schema="health_test"
aufraeumen() { docker rm -f "$n-app" "$n-rest" "$n-db" >/dev/null 2>&1 || true; docker network rm "$n" >/dev/null 2>&1 || true; }
trap aufraeumen EXIT
psql_db() { docker exec "$n-db" psql -q -U supabase_admin -d postgres -h 127.0.0.1 -v ON_ERROR_STOP=1 "$@"; }
abfrage() { # Statuscode und Antworttext von /health, aus dem App-Container
  docker exec "$n-app" node -e "fetch('http://127.0.0.1:3000/health').then(async r=>console.log(r.status,await r.text())).catch(e=>{console.log('FEHLER',e.message);process.exit(1)})"
}

docker network create "$n" >/dev/null
docker run -d --name "$n-db" --network "$n" -e POSTGRES_PASSWORD=postgres "$TESTDB_IMAGE" >/dev/null
for _ in $(seq 60); do psql_db -tA -c "select 1 from pg_roles where rolname = 'authenticator'" 2>/dev/null | grep -q 1 && break; sleep 2; done
psql_db -c "alter role authenticator password 'postgres'; create schema $schema; grant usage on schema $schema to anon;"
docker run -d --name "$n-rest" --network "$n" -e PGRST_DB_URI="postgres://authenticator:postgres@$n-db:5432/postgres" \
  -e PGRST_DB_SCHEMAS="$schema" -e PGRST_DB_ANON_ROLE=anon -e PGRST_JWT_SECRET=test-secret-at-least-32-characters-long "$REST_IMAGE" >/dev/null
docker run -d --name "$n-app" --network "$n" -e MIGRATE=aus -e APP_SCHEMA="$schema" -e SUPABASE_URL="http://$n-rest:3000" \
  -e SUPABASE_PUBLISHABLE_KEY=sb_publishable_test "$IMAGE" >/dev/null

antwort=""
for _ in $(seq 60); do antwort=$(abfrage 2>/dev/null || true); case "$antwort" in 200*) break ;; esac; sleep 2; done
echo "mit Datenbank:  $antwort"
case "$antwort" in "200 "*"\"revision\":\"$GIT_SHA\""*) ;; *) echo "health-test: erwartet 200 mit revision=$GIT_SHA" >&2; docker logs "$n-app" 2>&1 | tail -20 >&2; exit 1 ;; esac

docker stop "$n-db" >/dev/null
antwort=$(abfrage || true)
echo "ohne Datenbank: $antwort"
case "$antwort" in "503 "*"\"revision\":\"$GIT_SHA\""*) ;; *) echo "health-test: erwartet 503 ohne Datenbank" >&2; exit 1 ;; esac

# Schema, das PostgREST nicht freigibt (APP_SCHEMA falsch): ebenfalls 503
docker start "$n-db" >/dev/null
docker rm -f "$n-app" >/dev/null
docker run -d --name "$n-app" --network "$n" -e MIGRATE=aus -e APP_SCHEMA=nicht_freigegeben -e SUPABASE_URL="http://$n-rest:3000" \
  -e SUPABASE_PUBLISHABLE_KEY=sb_publishable_test "$IMAGE" >/dev/null
for _ in $(seq 60); do antwort=$(abfrage 2>/dev/null || true); case "$antwort" in 503*|200*) break ;; esac; sleep 2; done
echo "falsches Schema: $antwort"
case "$antwort" in "503 "*) ;; *) echo "health-test: erwartet 503 bei nicht freigegebenem Schema" >&2; exit 1 ;; esac
echo "health-test ok"
