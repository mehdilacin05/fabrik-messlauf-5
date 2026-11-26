import { test, expect } from '@playwright/test';

// @smoke läuft ab Schritt 1 in jedem PR (Wegwerf-Stack ohne TLS) und gegen Staging
// (`make e2e E2E_ARGS="--grep @smoke"`): nur, was das Gerüst schon hat. Keine Seite aus
// einem späteren Schritt (die Anmeldeseite prüft schritt-04-anmeldung.spec.ts).
test('@smoke /health antwortet mit Revision', async ({ request }) => {
  const r = await request.get('/health');
  expect(r.status()).toBe(200);
  expect((await r.json()).revision).toMatch(/\S/);
});

// HTTPS über die Server-Adresse, nicht über page.url(); nur gegen Staging (BASE_URL nicht lokal).
test('@smoke Staging erreichbar über HTTPS', async ({ baseURL }) => {
  const u = new URL(baseURL ?? 'http://localhost');
  test.skip(['localhost', '127.0.0.1', 'app'].includes(u.hostname), 'CI-Stack läuft ohne TLS');
  expect(u.protocol).toBe('https:');
});
