import { test, expect } from '@playwright/test';
import { anmelden, nutzer } from './helfer';

test('@schritt-4 ohne Sitzung führt die Startseite zur Anmeldung', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/anmelden$/);
  await expect(page.getByRole('button', { name: 'Mit Microsoft anmelden' })).toBeVisible();
});

test('@schritt-4 ohne Sitzung ist /geraete nicht erreichbar', async ({ page }) => {
  await page.goto('/geraete');
  await expect(page).toHaveURL(/\/anmelden$/);
});

test('@schritt-4 Konto ohne Person sieht „Kein Zugang“', async ({ page }) => {
  await anmelden(page, await nutzer('mitarbeiter', { person: false }));
  await page.goto('/');
  await expect(page).toHaveURL(/\/kein-zugang$/);
  await expect(page.getByRole('heading', { name: 'Kein Zugang' })).toBeVisible();
});

test('@schritt-4 gesperrte Person sieht „Kein Zugang“', async ({ page }) => {
  await anmelden(page, await nutzer('mitarbeiter', { gesperrt: true }));
  await page.goto('/geraete');
  await expect(page).toHaveURL(/\/kein-zugang$/);
});

test('@schritt-4 Verwaltung landet auf der Geräteübersicht', async ({ page }) => {
  await anmelden(page, await nutzer('verwaltung'));
  await page.goto('/');
  await expect(page).toHaveURL(/\/geraete$/);
  await expect(page.getByRole('heading', { name: 'Geräte' })).toBeVisible();
});

test('@schritt-4 Mitarbeiter landet bei „meine Geräte“ und darf /geraete und /personen nicht öffnen', async ({ page }) => {
  await anmelden(page, await nutzer('mitarbeiter'));
  await page.goto('/');
  await expect(page).toHaveURL(/\/meine-geraete$/);
  for (const pfad of ['/geraete', '/personen']) {
    await page.goto(pfad);
    await expect(page).not.toHaveURL(new RegExp(`${pfad}$`));
  }
});

test('@schritt-4 /health meldet die Revision', async ({ request }) => {
  const r = await request.get('/health');
  expect(r.status()).toBe(200);
  expect((await r.json()).revision).toBeTruthy();
});
