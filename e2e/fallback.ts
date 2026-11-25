// Vorlage → e2e/fallback.ts. In E2E-Tests statt '@playwright/test' importieren: import { test, expect } from './fallback';
// Der Browser-Log darf keine Zeile `FALLBACK <grund>` enthalten. Erlaubt ein Test einen Grund ausdrücklich:
//   test.use({ erlaubteFallbacks: ['mail-aus'] });
// Server-Log (Next.js im Container): `make e2e-ohne-fallback`, siehe Makefile.
import { test as basis, expect } from "@playwright/test";

export const test = basis.extend<{
  erlaubteFallbacks: string[];
  fallbackWaechter: void;
}>({
  erlaubteFallbacks: [[], { option: true }],
  fallbackWaechter: [
    async ({ page, erlaubteFallbacks }, use) => {
      const funde: string[] = [];
      page.on("console", (m) => {
        const t = m.text();
        if (
          t.startsWith("FALLBACK ") &&
          !erlaubteFallbacks.some((g) => t.startsWith(`FALLBACK ${g} `))
        )
          funde.push(t);
      });
      await use();
      expect(funde, "Fallback im Browser benutzt").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
