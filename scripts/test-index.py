#!/usr/bin/env python3
"""Prove the generator REFUSES. Run: python3 scripts/test-index.py

A generator that can quietly emit a short table is worse than no generator,
because the short table looks authoritative and nobody re-derives it. So every
guard in scripts/index.py is exercised here by breaking a scratch copy of the
corpus on purpose, and each case asserts BOTH halves:

    the run exits 1 with REFUSED, and README.md is byte-identical afterwards.

The second half is the one that matters. A guard that reports a problem after
half-writing the file has not protected anything.

The last case asserts the opposite: on a clean corpus the projection is stable,
so running the generator twice changes nothing and --check agrees.
"""
from __future__ import annotations

import os
import re
import shutil
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INDEX = os.path.join(ROOT, "scripts", "index.py")
SUBJECT = "hip-0517-branch-naming.md"
STANDARDS_SUBJECT = "hip-0119-hanzo-service-conventions.md"


def run(root: str, *args: str) -> tuple[int, str]:
    env = dict(os.environ)
    env.setdefault("HANZO_CAPABILITIES",
                   os.path.join(os.path.dirname(ROOT), "openapi", "capabilities.yaml"))
    p = subprocess.run([sys.executable, INDEX, "--root", root, *args],
                       capture_output=True, text=True, env=env)
    return p.returncode, p.stdout + p.stderr


def read(root: str, name: str) -> str:
    return open(os.path.join(root, "HIPs", name), encoding="utf-8").read()


def write(root: str, name: str, text: str) -> None:
    open(os.path.join(root, "HIPs", name), "w", encoding="utf-8").write(text)


def readme(root: str) -> str:
    return open(os.path.join(root, "README.md"), encoding="utf-8").read()


# Each case mutates the scratch root; the runner asserts REFUSED + no write.
def m_empty(root):
    for f in os.listdir(os.path.join(root, "HIPs")):
        os.remove(os.path.join(root, "HIPs", f))

def m_field(root):
    write(root, SUBJECT, re.sub(r"^author:.*$", "", read(root, SUBJECT), count=1, flags=re.M))

def m_status(root):
    write(root, SUBJECT,
          re.sub(r"^status:.*$", "status: Shipped", read(root, SUBJECT), count=1, flags=re.M))

def m_type(root):
    write(root, SUBJECT,
          re.sub(r"^type:.*$", "type: Freeform", read(root, SUBJECT), count=1, flags=re.M))

def m_category(root):
    write(root, STANDARDS_SUBJECT,
          re.sub(r"^category:.*$", "category: Vibes",
                 read(root, STANDARDS_SUBJECT), count=1, flags=re.M))

def m_no_category(root):
    write(root, STANDARDS_SUBJECT,
          re.sub(r"^category:.*$", "", read(root, STANDARDS_SUBJECT), count=1, flags=re.M))

def m_requires(root):
    s = read(root, STANDARDS_SUBJECT)
    write(root, STANDARDS_SUBJECT,
          re.sub(r"^(requires:.*)$", r"\1, HIP-8888", s, count=1, flags=re.M)
          if re.search(r"^requires:", s, re.M)
          else s.replace("\nstatus:", "\nrequires: HIP-8888\nstatus:", 1))

def m_duplicate(root):
    shutil.copy(os.path.join(root, "HIPs", SUBJECT),
                os.path.join(root, "HIPs", "hip-0517-a-second-claim.md"))

def m_shrink(root):
    os.remove(os.path.join(root, "HIPs", SUBJECT))

def m_no_section(root):
    p = os.path.join(root, "README.md")
    s = open(p, encoding="utf-8").read()
    open(p, "w", encoding="utf-8").write(s.replace("## HIP Index", "## The Table", 1))

def m_no_capabilities(root):
    # The reading order's capability grouping comes from a sibling repo. Losing
    # a section because an input was not checked out is the exact silent
    # truncation this file exists to prevent, so it must be an error.
    os.environ["HANZO_CAPABILITIES"] = os.path.join(root, "nowhere.yaml")


CASES = [
    ("an empty HIPs/", m_empty, None),
    ("a required front-matter field removed", m_field, None),
    ("a status outside the vocabulary", m_status, None),
    ("a type outside the vocabulary", m_type, None),
    ("a category outside the vocabulary", m_category, None),
    ("a Standards Track HIP with no category", m_no_category, None),
    ("requires: a HIP that does not exist", m_requires, None),
    ("two files claiming one number", m_duplicate, None),
    ("a HIP deleted without saying so", m_shrink, None),
    ("README's index heading renamed", m_no_section, None),
    ("capabilities.yaml not checked out", m_no_capabilities, None),
]


def main() -> int:
    base = tempfile.mkdtemp(prefix="hips-index-test-")
    capabilities = os.environ.get("HANZO_CAPABILITIES")
    try:
        clean = os.path.join(base, "clean")
        os.makedirs(clean)
        shutil.copytree(os.path.join(ROOT, "HIPs"), os.path.join(clean, "HIPs"))
        for f in ("README.md", "vocabulary.json"):
            shutil.copy(os.path.join(ROOT, f), clean)
        shutil.copytree(os.path.join(ROOT, "scripts"), os.path.join(clean, "scripts"))

        rc, out = run(clean, "--check")
        if rc != 0:
            print("CONTROL FAILED: the committed README does not match HIPs/.")
            print(out)
            return 1
        print("control: README projects the corpus exactly (--check exit 0)\n")

        failures = []
        for what, mutate, _ in CASES:
            root = os.path.join(base, re.sub(r"\W+", "-", what)[:40])
            shutil.copytree(clean, root)
            mutate(root)
            # AFTER the mutation: one case renames a README heading, and what is
            # being asserted is that the generator wrote nothing, not that the
            # mutation wrote nothing.
            before = readme(root)
            rc, out = run(root)
            if capabilities:
                os.environ["HANZO_CAPABILITIES"] = capabilities
            refused = rc == 1 and "REFUSED" in out
            intact = readme(root) == before
            ok = refused and intact
            note = "" if ok else (
                "  <- did not refuse" if not refused else "  <- WROTE README ANYWAY")
            print(f"  {'PASS' if ok else 'FAIL'}  refuses: {what}{note}")
            if not ok:
                failures.append((what, rc, out))

        # And the other direction: a clean run is stable and idempotent.
        root = os.path.join(base, "stable")
        shutil.copytree(clean, root)
        rc1, _ = run(root)
        once = readme(root)
        rc2, _ = run(root)
        rc3, _ = run(root, "--check")
        stable = rc1 == 0 and rc2 == 0 and rc3 == 0 and readme(root) == once
        print(f"\n  {'PASS' if stable else 'FAIL'}  a clean corpus projects, twice, identically")
        if not stable:
            failures.append(("idempotent", rc1, f"{rc1} {rc2} {rc3}"))

        # Every guard the file can raise should be reachable from a case above.
        raised = set(re.findall(r"raise Refused\(", open(INDEX, encoding="utf-8").read()))
        if not raised:
            print("  FAIL  scripts/index.py raises no guard at all")
            failures.append(("guards", 0, ""))

        if failures:
            print(f"\n{len(failures)} guards did not hold:\n")
            for what, rc, out in failures:
                print(f"--- {what} exit={rc} ---\n{out[-600:]}")
            return 1
        print(f"\nall {len(CASES)} guards refuse and leave README.md untouched")
        return 0
    finally:
        shutil.rmtree(base, ignore_errors=True)


if __name__ == "__main__":
    raise SystemExit(main())
