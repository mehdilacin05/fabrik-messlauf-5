# Vorlage Stack-Profil Next.js (output: "standalone"): node:26-alpine mit Shell, npm entfernt (Entscheidung 19.11.2026:
# distroless spart nur ~7 MB, Shell im Container hilft im Betrieb). Wörtlich übernehmen; Änderungen nur mit Grund im PR.
# Drei Stufen: abhängigkeiten → bauen → laufzeit. Nur die letzte landet auf dem Server.
# Basis-Image-Updates kommen über Dependabot (package-ecosystem: docker).
# Node-Version vor jedem Projekt prüfen (profile/nextjs-supabase/STACK-KARTE.md): .nvmrc, diese Zeile und @types/node gleich setzen.
# Messlauf 4 prüft Node 26 (Active LTS seit 28.10.2026).
ARG NODE_IMAGE=node:26-alpine

FROM ${NODE_IMAGE} AS abhaengigkeiten
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

FROM ${NODE_IMAGE} AS bauen
WORKDIR /app
COPY --from=abhaengigkeiten /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npx next build

FROM ${NODE_IMAGE} AS laufzeit
WORKDIR /app
ARG GIT_SHA=unbekannt
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 GIT_SHA=${GIT_SHA}
# npm, npx und corepack gehören nicht ins Laufzeit-Image: der Image-Scan meldet sonst Lücken in deren Paketen.
# Die Zeile prüft sich selbst: Bleibt npm übrig, bricht der Build ab.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
      /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /opt/yarn* /usr/local/bin/yarn* \
 && ! command -v npm && ! command -v npx && ! command -v corepack \
 && apk add --no-cache postgresql17-client \
 && install -d -o node -g node /backup  # psql/pg_dump für scripts/migrate.sh; /backup gehört node: ein neues Volume
#    übernimmt Besitzer und Rechte dieses Ordners, sonst darf die Sicherung vor der Migration nicht schreiben.
COPY --from=bauen --chown=node:node /app/.next/standalone ./
COPY --from=bauen --chown=node:node /app/.next/static ./.next/static
# public/ muss existieren (Gerüst legt public/.gitkeep an), sonst bricht COPY ab.
COPY --from=bauen --chown=node:node /app/public ./public
COPY --chown=node:node supabase/migrations ./migrations
COPY --chown=node:node scripts/migrate.sh ./migrate.sh
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=5s --retries=12 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Erst Migrationen mit eigenem Nutzer (Sicherung vorher), dann die App ohne diesen Zugang.
CMD ["sh", "-c", "sh /app/migrate.sh && unset MIGRATE_DATABASE_URL && exec node server.js"]
