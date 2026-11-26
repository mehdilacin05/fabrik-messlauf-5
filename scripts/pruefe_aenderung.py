#!/usr/bin/env python3
"""Prüft eine Änderung (Basis...HEAD) ohne Modell: Scheintests, gesperrte Akzeptanztests, Migrationen.

Aufruf: pruefe_aenderung.py <repo> [--basis origin/main] [--typ bauen] [--zweig <PR-Branch>] -> Exit 0 ok, sonst 1 und je Befund eine Zeile.
Läuft im Gate (Hook) und in der CI (Job `check`). Nur Standardbibliothek.
  Tests:      gelöschte Testdateien, weniger Prüfungen (expect/assert), neue .skip/.only/fixme/todo/@quarantine,
              höhere timeout/retries (auch in playwright/vitest/jest-Konfig).
  Akzeptanz:  Dateien unter tests/akzeptanz/ ändert nur der Planer (Branch design/… bzw. Typ planen).
  Leitplanken: .github/, CODEOWNERS, scripts/pruefe_aenderung.py nur Typ geruest; Makefile im Bau nur anhängen.
  Migration:  keine Objekte in `public`;
              vorhandene Migrationen sind unveränderlich; Einbahnstraßen (DROP, RENAME, TYPE, NOT NULL, TRUNCATE)
              nur mit Kommentar `-- einbahnstrasse: <Grund>` in derselben Datei.
  Fallbacks:  nur hinzugefügte Zeilen in Quellcode (.ts/.tsx/.js/.jsx/.mjs/.cjs/.py, keine Tests) -- versteckte Ersatzwerte:
              `?? <Literal>` / `|| <Literal>`, `.catch(() => <Literal>)`, leerer catch, catch der nur ein Literal zurückgibt,
              Python `except …: pass` / `return None|[]|{}|0|''|False`. Literal = 0 '' "" `` [] {} null false.
              Heuristik: gemeint ist der FEHLERFALL (catch, .catch) immer als Befund; bei `??`/`||` ist es meist eine
              optionale Eingabe. Dann Kommentar `// standardwert: <Grund>` (Python `# standardwert: …`) auf derselben oder
              der Zeile davor. Echter Fallback: über `mitFallback('<grund>', fn, ersatz)` (src/lib/fallback.ts).
              Dazu: jeder neue mitFallback-Grund (Textliteral) steht in mindestens einem `erlaubeFallback('<grund>')` der Tests.
"""
import re, subprocess, sys

TEST = re.compile(r"(^|/)(tests?|__tests__|e2e)/|\.(test|spec)\.[cm]?[jt]sx?$|(^|/)test_[^/]+\.py$|_test\.(py|go)$")
TESTKONFIG = re.compile(r"(^|/)(playwright|vitest|jest)\.config\.[cm]?[jt]s$|(^|/)(pytest\.ini|conftest\.py)$")
AKZEPTANZ = "tests/akzeptanz/"
LEITPLANKEN = re.compile(r"^(\.github/|CODEOWNERS$|scripts/pruefe_aenderung\.py$)")
MIGRATION = re.compile(r"(^|/)(supabase/)?migrations/[^/]+\.sql$")
PRUEFUNG = re.compile(r"\bexpect\s*\(|\bassert\w*\s*[\(.]|\bself\.assert\w+\(|\bt\.(Error|Fatal|Fail)\w*\(")
SCHWAECHE = re.compile(r"\.(skip|only|fixme|todo)\s*\(|\b(xit|xdescribe|xtest)\s*\(|@quarantine|pytest\.mark\.skip|t\.Skip\(")
FRIST = re.compile(r"\b(timeout|retries|testTimeout)\s*[:=]\s*(\d+)", re.I)
PUBLIC = re.compile(r"\b(create|alter)\s+(table|view|function|type|sequence)\s+(if\s+not\s+exists\s+)?(\"?public\"?\.)", re.I)
EINBAHN = re.compile(r"\bdrop\s+(table|column|schema|type|view|function)\b|\brename\s+(to|column)\b|\balter\s+column\s+\S+\s+"
                     r"(type|set\s+not\s+null)\b|\btruncate\b|\bdelete\s+from\s+\S+\s*;", re.I)
FESTES_SCHEMA = re.compile(r"""(?:\b(?:Accept|Content)-Profile["']?\s*[:=,]\s*|\.schema\(\s*)(["'])[\w-]+\1""", re.I)
QUELL = re.compile(r"\.(tsx?|[cm]?jsx?|py)$")
OHNE_FALLBACKPRUEFUNG = re.compile(r"\.d\.ts$|(^|/)lib/fallback\.ts$|(^|/)vitest\.setup\.[cm]?[jt]s$|(^|/)(scripts|templates)/")
LIT = r"(?:0|''|\"\"|``|\[\s*\]|\{\s*\}|null|false)(?![\w$.])"
RETLIT = r"(?:0|''|\"\"|``|\[\s*\]|\{\s*\}|null|false|undefined)(?![\w$.])"
LIT_OP = re.compile(r"(\?\?|\|\|)\s*" + LIT)
LIT_CATCH = re.compile(r"\.catch\(\s*(?:\(\s*\w*\s*\)|\w+)?\s*=>\s*(?:" + RETLIT + r")\s*\)")
JS_CATCH = re.compile(r"\bcatch\s*(?:\([^)]*\))?\s*\{\s*(?:(?://[^\n]*|/\*.*?\*/)\s*)*(?:return\s*(?:" + RETLIT + r")?\s*;?\s*)?"
                      r"(?:(?://[^\n]*|/\*.*?\*/)\s*)*\}", re.S)
PY_EXCEPT = re.compile(r"^(\s*)except\b[^\n]*?:\s*(.*)$")
PY_LEER = re.compile(r"(pass|\.\.\.|return(\s+(None|\[\]|\{\}|0|''|\"\"|False))?)\s*(#.*)?$")
MARKE = re.compile(r"(//|#)\s*standardwert:\s*\S", re.I)
MITFALLBACK_GRUND = re.compile(r"\bmitFallback\s*(?:<[^>(]*>)?\(\s*(['\"`])([^'\"`]+)\1")
MITFALLBACK_AUF = re.compile(r"\bmitFallback\s*(?:<[^>(]*>)?\(")
ERLAUBE = re.compile(r"\berlaubeFallback\(\s*['\"`]([^'\"`]+)['\"`]")


def git(repo, *a):
    r = subprocess.run(["git", "-c", "safe.directory=*", *a], cwd=repo, capture_output=True, text=True,
                       encoding="utf-8", errors="replace")  # Binärdateien (Bilder, Schriften) dürfen nicht abbrechen
    return r.stdout if r.returncode == 0 else None


def anzahl(text, muster):
    return len(muster.findall(text or ""))


def fristen(text):
    return {m.group(1).lower(): int(m.group(2)) for m in FRIST.finditer(text or "")}


def hinzugefuegt(repo, mb, alt_pfad, pfad):
    """Nummern der Zeilen, die der Diff in `pfad` hinzufügt."""
    d = git(repo, "diff", "-U0", "-M", mb, "HEAD", "--", alt_pfad, pfad) or ""
    nummern = set()
    for m in re.finditer(r"^@@ -\S+ \+(\d+)(?:,(\d+))? @@", d, re.M):
        start, n = int(m.group(1)), int(m.group(2) or 1)
        nummern.update(range(start, start + n))
    return nummern


def fallback_funde(pfad, text, neu_zeilen):
    """(Zeile, Meldung) für versteckte Fallbacks in hinzugefügten Zeilen. Marker `standardwert:` auf der Zeile oder davor erlaubt."""
    zeilen = text.splitlines()
    def erlaubt(nr):
        return any(MARKE.search(zeilen[i]) for i in (nr - 1, nr - 2) if 0 <= i < len(zeilen))
    funde = []
    py = pfad.endswith(".py")
    for nr in sorted(neu_zeilen):
        if nr > len(zeilen):
            continue
        z = zeilen[nr - 1]
        if z.strip().startswith(("//", "#", "*", "/*")) or MITFALLBACK_AUF.search(z):
            continue
        if not py and (LIT_CATCH.search(z) or LIT_OP.search(z)):
            art = "`.catch(() => <Literal>)` verschluckt den Fehler" if LIT_CATCH.search(z) else \
                "`?? / || <Literal>` ersetzt einen fehlenden Wert"
            funde.append((nr, art))
        if py:
            m = PY_EXCEPT.match(z)
            if m:
                rest = m.group(2).strip()
                if not rest or rest.startswith("#"):
                    rest = ""
                    for folge in zeilen[nr:]:
                        if folge.strip() and not folge.strip().startswith("#"):
                            rest = folge.strip(); break
                if PY_LEER.match(rest):
                    funde.append((nr, "`except` ohne Folge: Fehler wird verschluckt oder durch Standardwert ersetzt"))
    if not py:
        for m in JS_CATCH.finditer(text):
            nr = text.count("\n", 0, m.start()) + 1
            if nr in neu_zeilen:
                funde.append((nr, "`catch` leer oder gibt nur einen Standardwert zurück"))
    return [(nr, msg) for nr, msg in funde if not erlaubt(nr)]


def fallback_gruende_ohne_test(repo, gruende):
    """Gründe aus mitFallback(...), die in keinem erlaubeFallback(...) der Tests (HEAD) vorkommen."""
    testgruende = set()
    dateien = (git(repo, "grep", "-I", "-l", "-E", r"erlaubeFallback\(", "HEAD", "--", ".") or "").splitlines()
    for f in dateien:
        f = f.split(":", 1)[-1]
        if TEST.search(f):
            testgruende.update(ERLAUBE.findall(git(repo, "show", f"HEAD:{f}") or ""))
    return [(p, n, g) for p, n, g in gruende if g not in testgruende]


def pruefe(repo, basis="origin/main", typ="bauen", zweig=""):
    mb = (git(repo, "merge-base", "HEAD", basis) or "").strip()
    if not mb:
        return [f"Basis {basis} nicht gefunden: git fetch"]
    zeilen = (git(repo, "diff", "--name-status", "-M", mb, "HEAD") or "").splitlines()
    zweig = zweig or (git(repo, "rev-parse", "--abbrev-ref", "HEAD") or "").strip()
    planer = typ == "planen" or zweig.startswith("design/")
    if git(repo, "cat-file", "-e", f"{mb}:Makefile") is None:
        typ = "geruest"  # Basis ohne Makefile: das ist der Gerüst-Schritt
    if not zweig.startswith(("ae-", "ae/", "design/")) and zweig != "HEAD":
        typ, planer = "geruest", True  # Branch eines Menschen: nur Tests und Migrationen prüfen
    befunde, gruende = [], []
    for z in zeilen:
        teile = z.split("\t")
        art, pfad = teile[0][:1], teile[-1]
        alt_pfad = teile[1] if art == "R" else pfad
        relevant = any(m.search(x) for m in (TEST, TESTKONFIG, MIGRATION) for x in (pfad, alt_pfad))
        alt = git(repo, "show", f"{mb}:{alt_pfad}") if relevant and art in "MRD" else ""
        neu = git(repo, "show", f"HEAD:{pfad}") if relevant and art != "D" else ""
        if pfad.startswith(AKZEPTANZ) or alt_pfad.startswith(AKZEPTANZ):
            if not planer:
                befunde.append(f"Akzeptanztest geändert: {pfad}. Gesperrt für den Bau. Ist er falsch: kanban_block "
                               f"kind needs_input, Grund „Akzeptanztest falsch: {pfad}: <warum>“.")
            continue
        if typ != "geruest" and (LEITPLANKEN.search(pfad) or LEITPLANKEN.search(alt_pfad)):
            befunde.append(f"Leitplanken-Datei geändert: {pfad}. Ändert nur der Mensch (bzw. die Karte geruest).")
            continue
        if pfad == "Makefile" and typ != "geruest" and art == "M":
            weg = [z for z in (git(repo, "diff", mb, "HEAD", "--", "Makefile") or "").splitlines()
                   if z.startswith("-") and not z.startswith("---") and z[1:].strip()]
            if weg:
                befunde.append(f"Makefile: {len(weg)} Zeile(n) geändert oder entfernt. Im Bau nur neue Ziele "
                               "anhängen; bestehende Prüfungen ändert der Mensch.")
            continue
        if TESTKONFIG.search(pfad) and art != "D":
            hoeher = [k for k, v in fristen(neu).items() if k in fristen(alt) and v > fristen(alt)[k]]
            if hoeher:
                befunde.append(f"{'/'.join(hoeher)} erhöht in {pfad}: Ursache beheben, nicht länger warten")
            continue
        if TEST.search(alt_pfad) or TEST.search(pfad):
            if art == "D":
                befunde.append(f"Testdatei gelöscht: {pfad}")
                continue
            if anzahl(neu, PRUEFUNG) < anzahl(alt, PRUEFUNG):
                befunde.append(f"Weniger Prüfungen in {pfad}: {anzahl(alt, PRUEFUNG)} → {anzahl(neu, PRUEFUNG)}")
            if anzahl(neu, SCHWAECHE) > anzahl(alt, SCHWAECHE):
                befunde.append(f"Test ausgeschaltet (.skip/.only/fixme/todo/@quarantine) in {pfad}")
            fa, fn = fristen(alt), fristen(neu)
            hoeher = [k for k, v in fn.items() if k in fa and v > fa[k]]
            if hoeher:
                befunde.append(f"{'/'.join(hoeher)} erhöht in {pfad}: Ursache beheben, nicht länger warten")
        if typ != "geruest" and art != "D" and QUELL.search(pfad) and not TEST.search(pfad) \
                and not OHNE_FALLBACKPRUEFUNG.search(pfad):
            neu_q = neu or git(repo, "show", f"HEAD:{pfad}") or ""
            neue_zeilen = hinzugefuegt(repo, mb, alt_pfad, pfad)
            for nr, was in fallback_funde(pfad, neu_q, neue_zeilen):
                befunde.append(f"Versteckter Fallback in {pfad}:{nr}: {was}. Standard ist laut scheitern (Fehler werfen). "
                               "Echter Fallback laut Architektur/Karte: mitFallback('<grund>', fn, ersatz) mit Test; "
                               "optionale Eingabe: Kommentar `// standardwert: <Grund>`.")
            zl = neu_q.splitlines()
            for nr in sorted(neue_zeilen):
                if nr <= len(zl) and FESTES_SCHEMA.search(zl[nr - 1]) and not zl[nr - 1].strip().startswith(("//", "*", "#")):
                    befunde.append(f"Schema fest im Code in {pfad}:{nr}. Die App liest es zur Laufzeit aus process.env.APP_SCHEMA "
                                   "(Profil: „Daten, Migrationen, Laufzeit“); sonst bricht /health, sobald der Server ein anderes Schema setzt.")
            for nr in sorted(neue_zeilen):
                if nr <= len(zl) and MITFALLBACK_AUF.search(zl[nr - 1]) and not zl[nr - 1].strip().startswith(("//", "*", "#")):
                    m = MITFALLBACK_GRUND.search(zl[nr - 1])
                    if m:
                        gruende.append((pfad, nr, m.group(2)))
                    elif not re.search(r"\bmitFallback\s*(?:<[^>(]*>)?\(\s*$", zl[nr - 1]):
                        befunde.append(f"mitFallback in {pfad}:{nr}: Grund muss ein Textliteral in derselben Zeile sein "
                                       "(sonst findet ihn die Prüfung „je Fallback ein Test“ nicht).")
        if MIGRATION.search(pfad):
            if art in "MRD":
                befunde.append(f"Migration nachträglich geändert: {pfad}. Vorhandene Migrationen sind unveränderlich: "
                               "neue Migration anlegen.")
            elif PUBLIC.search(re.sub(r"--.*", "", neu or "")):
                befunde.append(f"Migration legt Objekte in `public` an: {pfad}. Jede App hat ihr eigenes Schema "
                               "(Profil: „Eigenes Schema je App“); `<app>.tabelle` verwenden.")
            elif EINBAHN.search(re.sub(r"--.*", "", neu or "")) and "einbahnstrasse:" not in (neu or "").lower():
                befunde.append(f"Einbahnstraßen-Migration ohne Begründung: {pfad}. Erst erweitern, später aufräumen "
                               "(expand/contract); sonst Kommentar `-- einbahnstrasse: <Grund>` in die Datei.")
    for p, n, g in fallback_gruende_ohne_test(repo, gruende) if gruende else []:
        befunde.append(f"Fallback-Grund „{g}“ ({p}:{n}) hat keinen Test: ein Test mit erlaubeFallback('{g}') muss den "
                       "Fehler erzwingen und das Ersatzverhalten prüfen.")
    return befunde


def main(argv):
    if len(argv) < 2 or argv[1].startswith("-"):
        print(__doc__); return 2
    args = dict(zip(argv[2::2], argv[3::2]))
    befunde = pruefe(argv[1], args.get("--basis", "origin/main"), args.get("--typ", "bauen"), args.get("--zweig", ""))
    print("\n".join(befunde) or "Änderung ok")
    return 1 if befunde else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
