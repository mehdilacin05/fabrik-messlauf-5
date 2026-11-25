import { test, expect } from '@playwright/test';
import { admin, anmelden, ausgeben, eindeutig, geraet, kategorie, nutzer, zuruecknehmen } from './helfer';

test('@schritt-7 Übersicht filtert nach Kategorie und sucht nach Seriennummer', async ({ page }) => {
  await anmelden(page, await nutzer('verwaltung'));
  const k1 = await kategorie(), k2 = await kategorie();
  const g1 = await geraet(k1), g2 = await geraet(k2);
  await page.goto('/geraete');
  await page.getByLabel('Kategorie').selectOption({ label: k1.name });
  await page.getByRole('button', { name: 'Filtern' }).click();
  await expect(page.getByRole('row', { name: new RegExp(g1.seriennummer) })).toBeVisible();
  await expect(page.getByRole('row', { name: new RegExp(g2.seriennummer) })).toHaveCount(0);

  await page.getByLabel('Kategorie').selectOption({ label: 'Alle' });
  await page.getByLabel('Suche').fill(g2.seriennummer.slice(0, 6));
  await page.getByRole('button', { name: 'Filtern' }).click();
  await expect(page.getByRole('row', { name: new RegExp(g2.seriennummer) })).toBeVisible();
});

test('@schritt-7 Übersicht filtert nach Status', async ({ page }) => {
  await anmelden(page, await nutzer('verwaltung'));
  const k = await kategorie();
  const frei = await geraet(k), weg = await geraet(k);
  await admin().from('geraet').update({ status: 'ausgemustert' }).eq('id', weg.id);
  await page.goto('/geraete');
  await page.getByLabel('Kategorie').selectOption({ label: k.name });
  await page.getByLabel('Status').selectOption({ label: 'Ausgemustert' });
  await page.getByRole('button', { name: 'Filtern' }).click();
  await expect(page.getByRole('row', { name: new RegExp(weg.seriennummer) })).toBeVisible();
  await expect(page.getByRole('row', { name: new RegExp(frei.seriennummer) })).toHaveCount(0);
});

test('@schritt-7 Gerätseite zeigt die Historie mit Person und Zeitpunkt', async ({ page }) => {
  await anmelden(page, await nutzer('verwaltung'));
  const p = await nutzer('mitarbeiter', { name: eindeutig('Hist') });
  const g = await geraet(await kategorie());
  await page.goto(`/geraete/${g.id}`);
  await page.getByLabel('Person').selectOption({ label: p.name! });
  await page.getByRole('button', { name: 'Ausgeben' }).click();
  const h = page.getByTestId('historie');
  await expect(h).toContainText('ausgegeben');
  await expect(h).toContainText(p.name!);
  await expect(h.locator('time').first()).toBeVisible();
});

test('@schritt-7 Mitarbeiter sieht nur seine eigenen aktuellen Geräte', async ({ page }) => {
  const a = await nutzer('mitarbeiter'), b = await nutzer('mitarbeiter');
  const k = await kategorie();
  const meins = await geraet(k), fremd = await geraet(k), frueher = await geraet(k);
  await ausgeben(meins.id, a.personId!);
  await ausgeben(fremd.id, b.personId!);
  await ausgeben(frueher.id, a.personId!);
  await zuruecknehmen(frueher.id, a.personId!);
  await anmelden(page, a);
  await page.goto('/meine-geraete');
  await expect(page.getByText(meins.seriennummer)).toBeVisible();
  await expect(page.getByText(fremd.seriennummer)).toHaveCount(0);
  await expect(page.getByText(frueher.seriennummer)).toHaveCount(0);
});

test('@schritt-7 Mitarbeiter ohne Geräte sieht eine leere Liste', async ({ page }) => {
  await anmelden(page, await nutzer('mitarbeiter'));
  await page.goto('/meine-geraete');
  await expect(page.getByText('Keine Geräte')).toBeVisible();
});

test('@schritt-7 Mitarbeiter kann ein Gerät nicht über die ID öffnen', async ({ page }) => {
  await anmelden(page, await nutzer('mitarbeiter'));
  const g = await geraet(await kategorie());
  await page.goto(`/geraete/${g.id}`);
  await expect(page.getByText(g.seriennummer)).toHaveCount(0);
  await expect(page).not.toHaveURL(new RegExp(`/geraete/${g.id}$`));
});
