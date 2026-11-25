#!/usr/bin/env python3
"""Welche Akzeptanztests laufen? Ausgabe: Playwright-Argumente (leer = alle). Nur Standardbibliothek + `gh`.

Akzeptanztests tragen im Titel `@schritt-N` (N = Bauplan-Schritt). Vor dem Bau sind sie absichtlich rot; laufen
dürfen nur die Schritte, die gemergt sind oder in diesem PR gebaut werden:
  PR mit Titel „Schritt N: …“  → N muss = höchster gemergter Schritt + 1 sein (sonst Exit 1), K = N
  sonst (Design, Chore, main)  → K = höchster gemergter Schritt
Ausgabe: `--grep-invert @schritt-(<Schritte > K>)\\b` bzw. nichts, wenn es keine höheren gibt. Tests ohne Marke laufen immer.
Aufruf in der CI: `make e2e E2E_ARGS="$(python3 -I scripts/e2e_auswahl.py)"`; braucht GH_TOKEN, GITHUB_REPOSITORY,
optional PR_TITLE. Schritte im Plan: Tabelle in docs/BAUPLAN.md.
"""
import json, os, re, subprocess, sys
from pathlib import Path

SCHRITT = re.compile(r"^\s*Schritt\s+(\d+)\s*:", re.I)


def gemergt_max(repo: str) -> int:
    r = subprocess.run(["gh", "pr", "list", "-R", repo, "--state", "merged", "--limit", "200", "--json", "title"],
                       capture_output=True, text=True)
    if r.returncode != 0:
        sys.exit(f"gh pr list fehlgeschlagen: {r.stderr.strip()[:300]}")
    return max([int(m.group(1)) for p in json.loads(r.stdout or "[]") if (m := SCHRITT.match(p["title"]))] or [0])


def plan_schritte(pfad="docs/BAUPLAN.md") -> list[int]:
    if not Path(pfad).is_file():
        return []
    return sorted({int(t[0]) for z in Path(pfad).read_text("utf-8").splitlines()
                   if (t := [x.strip() for x in z.strip().strip("|").split("|")]) and t[0].isdigit()})


def auswahl(k: int, schritte: list[int]) -> str:
    hoeher = [str(n) for n in schritte if n > k]
    return f"--grep-invert '@schritt-({'|'.join(hoeher)})\\b'" if hoeher else ""


def main() -> int:
    repo = os.environ.get("GITHUB_REPOSITORY") or sys.exit("GITHUB_REPOSITORY fehlt")
    m, titel = gemergt_max(repo), os.environ.get("PR_TITLE", "")
    k = m
    if (t := SCHRITT.match(titel)):
        k = int(t.group(1))
        if k != m + 1:
            print(f"PR-Titel nennt Schritt {k}, gemergt ist bis {m}: erwartet Schritt {m + 1}.", file=sys.stderr)
            return 1
    print(auswahl(k, plan_schritte()))
    return 0


if __name__ == "__main__":
    sys.exit(main())
