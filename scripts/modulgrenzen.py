#!/usr/bin/env python3
"""Fitness-Test Q5: Ein Modul nutzt ein anderes nur über dessen index.ts.

Aufruf: modulgrenzen.py [<repo>]  -> Exit 0 ok, 1 bei Verstoß (je Verstoß eine Zeile Datei:Zeile), 2 bei Fehler.
Prüft jede .ts/.tsx-Datei unter src/ (ohne Tests). Ein Import (`from`, `import()`, `export … from`) in
src/modules/<m>/<weiter> von außerhalb des Moduls <m> ist ein Verstoß, außer <weiter> ist leer oder `index`.
Auflösung: `@/…` = src/…, `./` und `../` relativ zur Datei. Nur Standardbibliothek.
"""
import os
import re
import sys

IMPORT = re.compile(r"""(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)(['"])([^'"\n]+)\1""")
TEST = re.compile(r"\.(test|spec)\.tsx?$")


def ziel_in_modul(spezifizierer, datei, src):
    """Gibt (modul, rest) zurück, wenn der Import in src/modules/<modul>/<rest> landet, sonst None."""
    if spezifizierer.startswith("@/"):
        pfad = os.path.join(src, spezifizierer[2:])
    elif spezifizierer.startswith("."):
        pfad = os.path.join(os.path.dirname(datei), spezifizierer)
    else:
        return None
    rel = os.path.relpath(os.path.normpath(pfad), os.path.join(src, "modules"))
    teile = rel.split(os.sep)
    if teile[0] in ("..", ".") or len(teile) == 0:
        return None
    return teile[0], teile[1:]


def pruefe(repo):
    src = os.path.join(repo, "src")
    if not os.path.isdir(src):
        raise SystemExit(f"modulgrenzen: {src} fehlt")
    verstoesse = []
    for wurzel, _, dateien in os.walk(src):
        for name in dateien:
            if not name.endswith((".ts", ".tsx")) or TEST.search(name):
                continue
            datei = os.path.join(wurzel, name)
            eigenes = os.path.relpath(datei, os.path.join(src, "modules")).split(os.sep)
            eigenes_modul = eigenes[0] if eigenes[0] != ".." else None
            with open(datei, encoding="utf-8") as f:
                for nr, zeile in enumerate(f, 1):
                    for m in IMPORT.finditer(zeile):
                        ziel = ziel_in_modul(m.group(2), datei, src)
                        if ziel is None:
                            continue
                        modul, rest = ziel
                        if modul == eigenes_modul or rest in ([], ["index"]):
                            continue
                        verstoesse.append(
                            f"{os.path.relpath(datei, repo)}:{nr}: Import von {m.group(2)} an src/modules/{modul}/index.ts vorbei"
                        )
    return verstoesse


if __name__ == "__main__":
    repo = sys.argv[1] if len(sys.argv) > 1 else "."
    v = pruefe(repo)
    for z in v:
        print(z, file=sys.stderr)
    if v:
        print(f"modulgrenzen: {len(v)} Verstoß/Verstöße", file=sys.stderr)
        sys.exit(1)
    print("modulgrenzen ok: kein Import an index.ts vorbei")
