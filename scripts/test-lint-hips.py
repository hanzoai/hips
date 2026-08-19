#!/usr/bin/env python3
"""Prove the lint fails. Run: python3 scripts/test-lint-hips.py

A check that has only ever been seen to pass has not been shown to work -- it is
indistinguishable from a check that returns success unconditionally, and this
repository has already shipped one of those (the GitHub workflow that printed
every missing field and then exited 0, so a HIP with no status went green).

So: copy the corpus, break it on purpose one way at a time, and require the lint
to report the specific code for that break. Every check the lint declares must
appear here, and the last test asserts exactly that -- if someone adds a check
and no test, this file fails.
"""
from __future__ import annotations

import os
import re
import shutil
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LINT = os.path.join(ROOT, "scripts", "lint-hips.py")

# A file that is structurally clean and small enough to mutate predictably.
SUBJECT = "hip-0517-branch-naming.md"
STANDARDS_SUBJECT = "hip-0119-hanzo-service-conventions.md"


def run(root: str) -> tuple[int, str]:
    p = subprocess.run([sys.executable, LINT, "--root", root],
                       capture_output=True, text=True)
    return p.returncode, p.stdout + p.stderr


def read(root: str, name: str) -> str:
    return open(os.path.join(root, "HIPs", name), encoding="utf-8").read()


def write(root: str, name: str, text: str) -> None:
    open(os.path.join(root, "HIPs", name), "w", encoding="utf-8").write(text)


# Each case: code, description, and a mutation taking the scratch root.
def m_fm001(root):
    write(root, SUBJECT, read(root, SUBJECT).split("\n---\n", 1)[1])

def m_fm002(root):
    write(root, SUBJECT, re.sub(r"^created:.*$", "", read(root, SUBJECT), count=1, flags=re.M))

def m_fm003(root):
    write(root, SUBJECT, re.sub(r"^hip:.*$", "hip: 0999", read(root, SUBJECT), count=1, flags=re.M))

def m_fm004(root):
    write(root, SUBJECT, re.sub(r"^status:.*$", "status: Baked", read(root, SUBJECT), count=1, flags=re.M))

def m_fm005(root):
    write(root, SUBJECT, re.sub(r"^type:.*$", "type: Freeform", read(root, SUBJECT), count=1, flags=re.M))

def m_fm006(root):
    write(root, STANDARDS_SUBJECT,
          re.sub(r"^category:.*$", "category: Vibes", read(root, STANDARDS_SUBJECT), count=1, flags=re.M))

def m_fm007(root):
    s = read(root, STANDARDS_SUBJECT)
    write(root, STANDARDS_SUBJECT, re.sub(r"^(requires:.*)$", r"\1, HIP-8888", s, count=1, flags=re.M))

def m_fm008(root):
    write(root, SUBJECT,
          re.sub(r"^status:.*$", "status: Superseded", read(root, SUBJECT), count=1, flags=re.M))

def m_fm009(root):
    os.rename(os.path.join(root, "HIPs", SUBJECT),
              os.path.join(root, "HIPs", "hip-0517-Branch_Naming.md"))

def m_st001(root):
    write(root, SUBJECT, re.sub(r"^# HIP-.*$", "", read(root, SUBJECT), count=1, flags=re.M))

def m_st002(root):
    write(root, SUBJECT,
          re.sub(r"^# HIP-.*$", "# HIP-0517: Something Else Entirely",
                 read(root, SUBJECT), count=1, flags=re.M))

def m_st003(root):
    # Duplicate the heading every Standards Track HIP is REQUIRED to carry. This
    # used to rename '## Motivation', which is advisory -- so when a corpus edit
    # removed that heading from the subject, the replace matched nothing, the
    # lint had no duplicate to report, and the check stopped proving anything
    # while still being counted. Anchor a mutation on what the lint requires,
    # never on what a document happens to have.
    s = read(root, STANDARDS_SUBJECT)
    write(root, STANDARDS_SUBJECT, s + "\n## Abstract\n\nA second one, on purpose.\n")

def m_st004(root):
    s = read(root, STANDARDS_SUBJECT)
    write(root, STANDARDS_SUBJECT, s.replace("### §2 ", "### §1 ", 1))

def m_st005(root):
    s = read(root, STANDARDS_SUBJECT)
    write(root, STANDARDS_SUBJECT, s.replace("\n## Abstract\n", "\n## Preface\n", 1))

def m_st006(root):
    s = read(root, STANDARDS_SUBJECT)
    write(root, STANDARDS_SUBJECT, s + "\n\n```go\nfunc dangling() {}\n")

def m_st007(root):
    s = read(root, STANDARDS_SUBJECT)
    write(root, STANDARDS_SUBJECT,
          s.replace("### §2 The entry point", "### §2 The entry point\n\n#### §9.1 Misfiled", 1)
          if "### §2 The entry point" in s
          else s.replace("## Specification", "## Specification\n\n### 1 One\n\n#### 4.2 Misfiled", 1))

def m_ix001(root):
    p = os.path.join(root, "README.md")
    s = open(p, encoding="utf-8").read()
    open(p, "w", encoding="utf-8").write(
        s.replace("./HIPs/" + SUBJECT, "./HIPs/hip-0517-gone.md", 1))

def m_ix002(root):
    p = os.path.join(root, "README.md")
    s = open(p, encoding="utf-8").read()
    open(p, "w", encoding="utf-8").write(
        re.sub(r"^\|\s*\[HIP-0517\].*$", "", s, count=1, flags=re.M))

def m_ix003(root):
    shutil.copy(os.path.join(root, "HIPs", SUBJECT),
                os.path.join(root, "HIPs", "hip-0517-duplicate-claim.md"))

def m_ix004(root):
    p = os.path.join(root, "README.md")
    s = open(p, encoding="utf-8").read()
    row = re.search(r"^\|\s*\[HIP-0517\].*$", s, re.M).group(0)
    open(p, "w", encoding="utf-8").write(s.replace(row, row.replace("| Active |", "| Draft |"), 1))

def m_pl001(root):
    s = read(root, STANDARDS_SUBJECT)
    write(root, STANDARDS_SUBJECT,
          s.replace("## Abstract", "## Abstract\n\nThis is as good as Terraform.", 1))

def m_pl002(root):
    s = read(root, STANDARDS_SUBJECT)
    write(root, STANDARDS_SUBJECT,
          s.replace("## Abstract", "## Abstract\n\nSee `hanzo-inc/payments` for the rest.", 1))


CASES = [
    ("FM001", "front matter removed", m_fm001),
    ("FM002", "created: removed", m_fm002),
    ("FM003", "hip: renumbered away from the filename", m_fm003),
    ("FM004", "status: set to a word not in the vocabulary", m_fm004),
    ("FM005", "type: set to a word not in the vocabulary", m_fm005),
    ("FM006", "category: set to a word not in the vocabulary", m_fm006),
    ("FM007", "requires: a HIP that does not exist", m_fm007),
    ("FM008", "Superseded with no superseded-by", m_fm008),
    ("FM009", "filename given capitals and an underscore", m_fm009),
    ("ST001", "H1 deleted", m_st001),
    ("ST002", "H1 title made to disagree with front matter", m_st002),
    ("ST003", "a second '## Abstract' introduced", m_st003),
    ("ST004", "two sections numbered §1", m_st004),
    ("ST005", "'## Abstract' renamed to '## Preface'", m_st005),
    ("ST006", "a code fence left open", m_st006),
    ("ST007", "a subsection numbered outside its parent", m_st007),
    ("IX001", "README pointed at a file that does not exist", m_ix001),
    ("IX002", "a HIP's README row deleted", m_ix002),
    ("IX003", "a second file claiming HIP-0517", m_ix003),
    ("IX004", "README status made to disagree with the file", m_ix004),
    ("PL001", "'as good as Terraform' added", m_pl001),
    ("PL002", "a private-org repository cited", m_pl002),
]


def main() -> int:
    base = tempfile.mkdtemp(prefix="hips-lint-test-")
    try:
        clean_root = os.path.join(base, "clean")
        os.makedirs(clean_root)
        shutil.copytree(os.path.join(ROOT, "HIPs"), os.path.join(clean_root, "HIPs"))
        shutil.copy(os.path.join(ROOT, "README.md"), clean_root)

        rc, out = run(clean_root)
        if rc != 0:
            print("CONTROL FAILED: the unmutated corpus does not lint clean.")
            print(out)
            return 1
        print(f"control: clean corpus lints clean (exit 0)\n")

        failures = []
        for code, what, mutate in CASES:
            root = os.path.join(base, code)
            shutil.copytree(clean_root, root)
            mutate(root)
            rc, out = run(root)
            caught = rc == 1 and re.search(rf"^ERROR {code}\b", out, re.M) is not None
            print(f"  {'PASS' if caught else 'FAIL'}  {code}  {what}")
            if not caught:
                failures.append((code, what, rc, out))

        declared = set(re.findall(r'^\s*\("([A-Z]{2}\d{3})",',
                                  open(LINT, encoding="utf-8").read(), re.M))
        tested = {c for c, _, _ in CASES}
        untested = declared - tested
        print(f"\n  {'PASS' if not untested else 'FAIL'}  every declared check has a test"
              + (f" -- missing {sorted(untested)}" if untested else ""))
        if untested:
            failures.append(("COVERAGE", "declared but untested", 0, str(sorted(untested))))

        if failures:
            print(f"\n{len(failures)} of {len(CASES) + 1} checks did not fail as required:\n")
            for code, what, rc, out in failures:
                print(f"--- {code} ({what}) exit={rc} ---")
                print("\n".join(out.splitlines()[-12:]) if isinstance(out, str) else out)
            return 1
        print(f"\nall {len(CASES)} checks fail on a deliberate break, and the clean "
              f"corpus passes")
        return 0
    finally:
        shutil.rmtree(base, ignore_errors=True)


if __name__ == "__main__":
    raise SystemExit(main())
