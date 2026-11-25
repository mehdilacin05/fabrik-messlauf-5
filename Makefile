# make check = dasselbe Tor lokal und in der CI. Exit-Code 0 = grün, sonst ist nichts fertig.
# Werkzeuge direkt aufrufen, nicht über npm-Skripte: Makefile und Konfigs sind per CODEOWNERS geschützt.
SHELL := bash
.SHELLFLAGS := -eu -o pipefail -c
.DEFAULT_GOAL := check
.PHONY: check secrets aenderung format lint lint-dateien typecheck test test-rot testdb e2e audit image image-groesse

# Test-DB: dieselben Versionen wie auf dem Server. Eigener Port je paralleler Arbeitskopie (TESTDB_PORT=54330 make check).
TESTDB_IMAGE ?= supabase/postgres:17.6.1.136
AUTH_IMAGE   ?= supabase/gotrue:v2.197.0
TESTDB_PORT  ?= 54329
TESTDB       := testdb-$(TESTDB_PORT)
# Docker lokal: Port nur auf 127.0.0.1. Entfernter Docker (DOCKER_HOST=tcp://host:port): Host aus DOCKER_HOST.
# Nichts davon ist erzwungen: TESTDB_HOST und TESTDB_BIND lassen sich setzen.
DOCKER_REMOTE := $(filter tcp://% ssh://%,$(DOCKER_HOST))
DOCKER_TCP    := $(patsubst tcp://%,%,$(filter tcp://%,$(DOCKER_HOST)))
TESTDB_HOST  ?= $(if $(DOCKER_TCP),$(firstword $(subst :, ,$(DOCKER_TCP))),127.0.0.1)
TESTDB_BIND  ?= $(if $(DOCKER_TCP),0.0.0.0,127.0.0.1)
export DATABASE_URL ?= postgresql://postgres:postgres@$(TESTDB_HOST):$(TESTDB_PORT)/postgres
export BASE_URL ?= http://localhost:3000

GITLEAKS_IMAGE := ghcr.io/gitleaks/gitleaks:v8.30.1@sha256:c00b6bd0aeb3071cbcb79009cb16a60dd9e0a7c60e2be9ab65d25e6bc8abbb7f
GITLEAKS ?= $(shell command -v gitleaks 2>/dev/null)

check: secrets aenderung format lint typecheck test

BASIS ?= origin/$(or $(GITHUB_BASE_REF),main)
ZWEIG ?= $(GITHUB_HEAD_REF)
aenderung: ## Scheintests, gesperrte Akzeptanztests, Leitplanken, Einbahnstraßen-Migrationen (Skript aus der Fabrik)
	python3 -I scripts/pruefe_aenderung.py . --basis $(BASIS) $(if $(ZWEIG),--zweig $(ZWEIG))

secrets: ## Geheimnisse in der ganzen Git-Historie (Fund: Schlüssel widerrufen, nicht nur löschen)
	@if [ -n "$(GITLEAKS)" ]; then $(GITLEAKS) git --redact --no-banner .; \
	elif [ -z "$(DOCKER_REMOTE)" ]; then docker run --rm -v "$(CURDIR):/repo" -w /repo $(GITLEAKS_IMAGE) git --redact --no-banner .; \
	else echo "gitleaks fehlt. Entfernter Docker sieht dieses Verzeichnis nicht (kein Bind-Mount): Release-Binärdatei mit Prüfsumme installieren." >&2; exit 1; fi

format:
	npx prettier --check .

lint:
	npx eslint . --max-warnings 0 --report-unused-disable-directives

lint-dateien: ## schnell, nur geänderte Dateien (Hook pre_verify, zählt nicht): make lint-dateien DATEIEN="a.ts b.md"
	@js="$(filter %.ts %.tsx %.js %.jsx %.mjs %.cjs,$(DATEIEN))"; if [ -n "$$js" ]; then npx eslint --max-warnings 0 $$js; fi
	@alle="$(filter %.ts %.tsx %.js %.jsx %.mjs %.cjs %.json %.md %.yml %.yaml %.css,$(DATEIEN))"; if [ -n "$$alle" ]; then npx prettier --check $$alle; fi

typecheck: ## Next.js erzeugt Routen-Typen (LayoutProps …) erst mit typegen
	npx next typegen >/dev/null
	npx tsc --noEmit

test: testdb ## Unit + Integration gegen die frische Test-DB
	npx vitest run

# Auth-Migrationen (GoTrue) zuerst: sonst kennt auth.uid() nur das alte Claim-Format, RLS-Tests wären nicht echt.
testdb: ## frischer Postgres, Auth-Schema wie prod, alle Migrationen von null, dann Seed
	docker rm -f $(TESTDB) >/dev/null 2>&1 || true
	docker run -d --rm --name $(TESTDB) -e POSTGRES_PASSWORD=postgres \
	  -p $(TESTDB_BIND):$(TESTDB_PORT):5432 $(TESTDB_IMAGE) >/dev/null
	for _ in $$(seq 60); do docker exec $(TESTDB) pg_isready -q -U postgres -h 127.0.0.1 && break; sleep 2; done
	docker exec $(TESTDB) pg_isready -q -U postgres -h 127.0.0.1
	docker run --rm --network container:$(TESTDB) -e API_EXTERNAL_URL=http://localhost \
	  -e GOTRUE_DB_DRIVER=postgres -e GOTRUE_SITE_URL=http://localhost -e GOTRUE_JWT_SECRET=test-secret-at-least-32-characters \
	  -e DATABASE_URL=postgres://supabase_auth_admin:postgres@127.0.0.1:5432/postgres $(AUTH_IMAGE) auth migrate >/dev/null
	for f in supabase/migrations/*.sql supabase/seed.sql; do \
	  if [ -f "$$f" ]; then docker exec -i $(TESTDB) psql -q -U postgres -d postgres -v ON_ERROR_STOP=1 < "$$f"; fi; \
	done

test-rot: ## neue/geänderte Tests müssen gegen den alten Stand (BASIS) scheitern: Test zuerst
	@t=$$(git diff --name-only --diff-filter=AM $(BASIS)...HEAD | grep -E '\.(test|spec)\.[cm]?[jt]sx?$$' | grep -vE '^(e2e|tests/akzeptanz)/' || true); \
	if [ -z "$$t" ]; then echo "test-rot: keine neuen Unit-/Integrationstests"; exit 0; fi; \
	d=$$(mktemp -d); git worktree add -q --detach "$$d" $$(git merge-base HEAD $(BASIS)); ln -s "$(CURDIR)/node_modules" "$$d/node_modules"; \
	for f in $$t; do mkdir -p "$$d/$$(dirname $$f)"; cp "$$f" "$$d/$$f"; done; \
	gruen=""; for f in $$t; do (cd "$$d" && npx vitest run "$$f" >/dev/null 2>&1) && gruen="$$gruen $$f"; done; \
	if [ -n "$$gruen" ]; then r=1; echo "test-rot: schon gegen den alten Stand grün, prüft also nichts Neues:$$gruen" >&2; \
	else r=0; echo "test-rot ok: jede neue Testdatei scheitert gegen den alten Stand (Grund prüft der Prüfer)"; fi; \
	git worktree remove --force "$$d"; exit $$r

# Wackelnde Tests: In der CI (Variable CI gesetzt) bekommt jeder Test genau einen Wiederholversuch, und der JSON-Bericht
# landet in E2E_BERICHT. Ein Test, der erst bei der Wiederholung grün wird, hat dort den Status „flaky“; die CI meldet
# ihn (Warnung + Artefakt wackelnde-tests), die Steuerung legt ein Bug-Issue an. Die Wiederholung steht nur hier, im
# geschützten Makefile (im Bau nur anhängen), nicht in playwright.config.ts: --retries schlägt die Konfig.
KOMMA := ,
E2E_BERICHT ?= e2e-ergebnis.json
E2E_CI_ARGS := $(if $(CI),--retries=1 --reporter=list$(KOMMA)html$(KOMMA)json)
e2e: ## Playwright gegen BASE_URL; E2E_ARGS wählt aus (CI: scripts/e2e_auswahl.py, Staging: --grep @smoke)
	rm -f "$(E2E_BERICHT)"
	PLAYWRIGHT_JSON_OUTPUT_FILE="$(CURDIR)/$(E2E_BERICHT)" PLAYWRIGHT_JSON_OUTPUT_NAME="$(E2E_BERICHT)" PLAYWRIGHT_HTML_OPEN=never \
	  npx playwright test $(E2E_CI_ARGS) $(E2E_ARGS)

audit: ## bekannte Lücken in Laufzeit-Abhängigkeiten (in der CI Pflicht)
	npm audit --omit=dev --audit-level=high

image: ## Image bauen wie die CI, nur lokal prüfen (nie pushen)
	docker build --build-arg GIT_SHA=$$(git rev-parse HEAD) -t $(notdir $(CURDIR)):lokal .

IMAGE_MAX_MB ?= 250
image-groesse: image ## rot, wenn das fertige Image (entpackt) größer als IMAGE_MAX_MB ist
	@mb=$$(( $$(docker image inspect -f '{{.Size}}' $(notdir $(CURDIR)):lokal) / 1000000 )); \
	echo "Image $$mb MB (Grenze $(IMAGE_MAX_MB) MB)"; [ $$mb -le $(IMAGE_MAX_MB) ] || { echo "zu groß: schwere Abhängigkeit oder falsche Stufe im Laufzeit-Image" >&2; exit 1; }

# e2e wie oben, danach das Log der App auf `FALLBACK <grund>` prüfen (siehe src/lib/fallback.ts). Rot bei jedem Treffer,
# außer der Grund steht in E2E_FALLBACK_ERLAUBT (Leerzeichen-getrennt; nur für Tests, die ihn ausdrücklich auslösen).
# CI-Job app-e2e: statt `make e2e E2E_ARGS=…` dieses Ziel aufrufen (Vorschlag in PROFIL.md).
APP_CONTAINER ?= app
E2E_FALLBACK_ERLAUBT ?=
.PHONY: e2e-ohne-fallback
e2e-ohne-fallback:
	$(MAKE) e2e E2E_ARGS="$(E2E_ARGS)"
	@t=$$(docker logs $(APP_CONTAINER) 2>&1 | grep -E '(^|[^A-Za-z])FALLBACK [a-z0-9-]+' || true); \
	for g in $(E2E_FALLBACK_ERLAUBT); do t=$$(printf '%s\n' "$$t" | grep -vE "FALLBACK $$g( |$$)" || true); done; \
	t=$$(printf '%s\n' "$$t" | sed '/^$$/d'); \
	if [ -n "$$t" ]; then echo "e2e-ohne-fallback: App hat Fallbacks benutzt:" >&2; printf '%s\n' "$$t" | sort | uniq -c >&2; exit 1; fi; \
	echo "e2e-ohne-fallback ok: kein FALLBACK im App-Log"

# Gerüst: /health gegen Wegwerf-Postgres und -PostgREST (scripts/health-test.sh). Image wie `make image`.
REST_IMAGE ?= postgrest/postgrest:v16.5
.PHONY: health-test hooks
health-test: image ## 200 mit Commit-SHA mit Datenbank, 503 ohne Datenbank und bei nicht freigegebenem Schema
	IMAGE=$(notdir $(CURDIR)):lokal GIT_SHA=$$(git rev-parse HEAD) TESTDB_IMAGE=$(TESTDB_IMAGE) REST_IMAGE=$(REST_IMAGE) bash scripts/health-test.sh

hooks: ## einmal je Klon: gitleaks vor jedem Push (.githooks/pre-push)
	git config core.hooksPath .githooks
