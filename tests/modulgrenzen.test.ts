// Q5: `make modulgrenzen` (scripts/modulgrenzen.py) findet Importe an index.ts vorbei und scheitert an einem eingebauten.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const wurzeln: string[] = [];
afterEach(() => {
  for (const w of wurzeln.splice(0))
    rmSync(w, { recursive: true, force: true });
});

function repo(dateien: Record<string, string>): string {
  const w = mkdtempSync(join(tmpdir(), "modulgrenzen-"));
  wurzeln.push(w);
  for (const [pfad, inhalt] of Object.entries(dateien)) {
    mkdirSync(dirname(join(w, "src", pfad)), { recursive: true });
    writeFileSync(join(w, "src", pfad), inhalt);
  }
  return w;
}
const lauf = (w: string) =>
  spawnSync("python3", ["-I", "scripts/modulgrenzen.py", w], {
    encoding: "utf-8",
  });

const modul = {
  "modules/person/index.ts": 'export { x } from "./person";\n',
  "modules/person/person.ts": "export const x = 1;\n",
};

describe("modulgrenzen", () => {
  it("das Repo selbst hält die Grenzen ein", () => {
    const r = spawnSync("python3", ["-I", "scripts/modulgrenzen.py", "."], {
      encoding: "utf-8",
    });
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
  });

  it("erlaubt Importe über index.ts (Alias, relativ, mit /index) und Importe innerhalb des Moduls", () => {
    const r = lauf(
      repo({
        ...modul,
        "app/a.ts":
          'import { x } from "@/modules/person";\nimport { y } from "../modules/person/index";\n',
        "lib/b.ts": 'export { x } from "../modules/person";\n',
        "modules/geraet/geraet.ts":
          'import { x } from "@/modules/person";\nimport { z } from "./index";\n',
        "modules/geraet/index.ts": "export const z = 1;\n",
      }),
    );
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
  });

  it.each([
    ["Alias", 'import { x } from "@/modules/person/person";'],
    ["relativ", 'import { x } from "../modules/person/person";'],
    ["dynamisch", 'const m = await import("@/modules/person/person");'],
    ["Re-Export", 'export { x } from "@/modules/person/person";'],
    ["tiefer Pfad", 'import { x } from "@/modules/person/intern/geheim";'],
  ])(
    "scheitert an einem absichtlich eingebauten Import an index.ts vorbei (%s)",
    (_n, zeile) => {
      const r = lauf(repo({ ...modul, "app/a.ts": `${zeile}\n` }));
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("app/a.ts:1");
      expect(r.stderr).toContain("an src/modules/person/index.ts vorbei");
    },
  );

  it("ein anderes Modul darf nicht in die Innereien greifen, Tests schon", () => {
    const r = lauf(
      repo({
        ...modul,
        "modules/geraet/geraet.ts": 'import { x } from "../person/person";\n',
        "modules/geraet/index.ts": "export {};\n",
        "modules/person/person.test.ts": 'import { x } from "./person";\n',
      }),
    );
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("modules/geraet/geraet.ts:1");
    expect(r.stderr).not.toContain("person.test.ts");
  });
});
