import { test, expect } from '@playwright/test';
import { admin, anmelden, eindeutig, geraet, kategorie, nutzer } from './helfer';

test('@schritt-5 Verwaltung legt ein Gerät an; dieselbe Seriennummer wird abgelehnt', async ({ page }) => {
  await anmelden(page, await nutzer('verwaltung'));
  const kat = await kategorie();
  const sn = eindeutig('SN'), bez = eindeutig('Laptop');
  await page.goto('/geraete/neu');
  await page.getByLabel('Seriennummer').fill(sn);
  await page.getByLabel('Bezeichnung').fill(bez);
  await page.getByLabel('Kategorie').selectOption({ label: kat.name });
  await page.getByRole('button', { name: 'Gerät anlegen' }).click();
  await expect(page.getByRole('heading', { name: bez })).toBeVisible();
  await expect(page.getByTestId('status')).toHaveText('Lager');
  await expect(page.getByTestId('historie')).toContainText('angelegt');

  await page.goto('/geraete/neu');
  await page.getByLabel('Seriennummer').fill(sn.toUpperCase());
  await page.getByLabel('Bezeichnung').fill('Zweitgerät');
  await page.getByLabel('Kategorie').selectOption({ label: kat.name });
  await page.getByRole('button', { name: 'Gerät anlegen' }).click();
  await expect(page.getByRole('alert')).toContainText('Seriennummer ist schon vergeben');
});

test('@schritt-5 Ausgabe, Rücknahme und Ausmustern mit Historie', async ({ page }) => {
  await anmelden(page, await nutzer('verwaltung'));
  const empfaenger = await nutzer('mitarbeiter', { name: eindeutig('Empfaenger') });
  const g = await geraet(await kategorie());
  await page.goto(`/geraete/${g.id}`);
  await page.getByLabel('Person').selectOption({ label: empfaenger.name! });
  await page.getByRole('button', { name: 'Ausgeben' }).click();
  await expect(page.getByTestId('status')).toHaveText('Ausgegeben');
  await expect(page.getByTestId('historie')).toContainText('ausgegeben');

  await page.getByLabel('Notiz').fill('zu früh');
  await page.getByRole('button', { name: 'Ausmustern' }).click();
  await expect(page.getByRole('alert')).toContainText('noch ausgegeben');

  await page.getByRole('button', { name: 'Zurücknehmen' }).click();
  await expect(page.getByTestId('status')).toHaveText('Lager');
  await page.getByLabel('Notiz').fill('Display defekt');
  await page.getByRole('button', { name: 'Ausmustern' }).click();
  await expect(page.getByTestId('status')).toHaveText('Ausgemustert');
  await expect(page.getByTestId('historie')).toContainText('ausgemustert');
});

test('@schritt-5 zwei gleichzeitige Ausgaben: genau eine gewinnt', async ({ browser }) => {
  const v = await nutzer('verwaltung');
  const a = await (await browser.newContext()).newPage();
  const b = await (await browser.newContext()).newPage();
  await anmelden(a, v);
  await anmelden(b, v);
  const p1 = await nutzer('mitarbeiter', { name: eindeutig('PersonA') });
  const p2 = await nutzer('mitarbeiter', { name: eindeutig('PersonB') });
  const g = await geraet(await kategorie());
  for (const [seite, p] of [[a, p1], [b, p2]] as const) {
    await seite.goto(`/geraete/${g.id}`);
    await seite.getByLabel('Person').selectOption({ label: p.name! });
  }
  await Promise.all([
    a.getByRole('button', { name: 'Ausgeben' }).click(),
    b.getByRole('button', { name: 'Ausgeben' }).click(),
  ]);
  await expect(async () => {
    const fehler = (await a.getByRole('alert').count()) + (await b.getByRole('alert').count());
    expect(fehler).toBe(1);
  }).toPass();
  const { data } = await admin().from('geraet_ereignis').select('art').eq('geraet_id', g.id).eq('art', 'ausgegeben');
  expect(data).toHaveLength(1);
});

test('@schritt-5 Verwaltung legt eine Kategorie an', async ({ page }) => {
  await anmelden(page, await nutzer('verwaltung'));
  const name = eindeutig('Dock');
  await page.goto('/kategorien');
  await page.getByLabel('Name').fill(name);
  await page.getByRole('button', { name: 'Kategorie anlegen' }).click();
  await expect(page.getByText(name)).toBeVisible();
});
