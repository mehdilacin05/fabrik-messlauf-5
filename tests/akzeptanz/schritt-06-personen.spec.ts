import { test, expect } from '@playwright/test';
import { admin, anmelden, ausgeben, eindeutig, geraet, kategorie, nutzer, personOhneKonto } from './helfer';

test('@schritt-6 Verwaltung legt eine Person vorab an; doppelte Mail wird abgelehnt', async ({ page }) => {
  await anmelden(page, await nutzer('verwaltung'));
  const name = eindeutig('Neu'), mail = `${eindeutig('neu')}@test.example`;
  await page.goto('/personen');
  await page.getByLabel('Name').fill(name);
  await page.getByLabel('Firmen-Mail').fill(mail);
  await page.getByRole('button', { name: 'Person anlegen' }).click();
  await expect(page.getByRole('row', { name: new RegExp(name) })).toBeVisible();
  await page.getByLabel('Name').fill('Doppelt');
  await page.getByLabel('Firmen-Mail').fill(mail.toUpperCase());
  await page.getByRole('button', { name: 'Person anlegen' }).click();
  await expect(page.getByRole('alert')).toContainText('Mail ist schon vergeben');
});

test('@schritt-6 Sperren geht erst ohne Geräte; Gesperrte bekommen kein Gerät', async ({ page }) => {
  await anmelden(page, await nutzer('verwaltung'));
  const p = await personOhneKonto();
  const g = await geraet(await kategorie());
  await ausgeben(g.id, p.id);
  const zeile = () => page.getByRole('row', { name: new RegExp(p.name) });

  await page.goto('/personen');
  await zeile().getByRole('button', { name: 'Sperren' }).click();
  await expect(page.getByRole('alert')).toContainText('hat noch Geräte');

  await page.goto(`/geraete/${g.id}`);
  await page.getByRole('button', { name: 'Zurücknehmen' }).click();
  await expect(page.getByTestId('status')).toHaveText('Lager');
  await page.goto('/personen');
  await zeile().getByRole('button', { name: 'Sperren' }).click();
  await expect(zeile().getByRole('button', { name: 'Entsperren' })).toBeVisible();

  await page.goto(`/geraete/${g.id}`);
  await page.getByLabel('Person').selectOption({ label: p.name });
  await page.getByRole('button', { name: 'Ausgeben' }).click();
  await expect(page.getByRole('alert')).toContainText('Person ist gesperrt');
});

test('@schritt-6 Anonymisieren ersetzt Name und Mail, die Historie bleibt', async ({ page }) => {
  await anmelden(page, await nutzer('verwaltung'));
  const p = await personOhneKonto();
  const g = await geraet(await kategorie());
  await ausgeben(g.id, p.id);
  await admin().from('geraet').update({ status: 'lager', inhaber_id: null }).eq('id', g.id);
  await admin().from('person').update({ gesperrt: true }).eq('id', p.id);
  await page.goto('/personen');
  await page.getByRole('row', { name: new RegExp(p.name) }).getByRole('button', { name: 'Anonymisieren' }).click();
  await expect(page.getByText(p.name)).toHaveCount(0);
  await expect(page.getByText(p.email)).toHaveCount(0);
  await page.goto(`/geraete/${g.id}`);
  await expect(page.getByTestId('historie')).toContainText('Gelöscht');
});

test('@schritt-6 Mitarbeiter kann keine Person anlegen', async ({ page }) => {
  await anmelden(page, await nutzer('mitarbeiter'));
  await page.goto('/personen');
  await expect(page).not.toHaveURL(/\/personen$/);
});
