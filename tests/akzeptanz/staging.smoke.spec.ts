import { test, expect } from '@playwright/test';

// Läuft nur gegen Staging (`make e2e E2E_ARGS="--grep @smoke"`): was nur der echte Server zeigt.
test('@smoke Staging: /health antwortet mit Revision, Anmeldeseite lädt über HTTPS', async ({ page, request }) => {
  const r = await request.get('/health');
  expect(r.status()).toBe(200);
  expect((await r.json()).revision).toMatch(/\S/);
  await page.goto('/anmelden');
  await expect(page.getByRole('button', { name: 'Mit Microsoft anmelden' })).toBeVisible();
  expect(page.url()).toMatch(/^https:/);
});
