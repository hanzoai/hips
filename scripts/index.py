#!/usr/bin/env python3
"""Project HIPs/ onto README.md. The files are the source; README is derived.

    python3 scripts/index.py             # write the projection
    python3 scripts/index.py --check     # fail if README has drifted (CI)
    python3 scripts/index.py --delete N  # write a projection that is N rows smaller
    python3 scripts/index.py --root DIR  # project a scratch copy (the self-test)

TWO PROJECTIONS OF ONE CORPUS, neither hand-maintained.

The index is every HIP by number, which is what you want when you already know
the number. The reading order is what you want when you do not: 259 specs in
numeric order teach nothing, because number records when a spec was written and
not what has to be understood first.

The order is DERIVED, never curated. A HIP's `requires:` names what a reader must
already hold, so counting how many HIPs require a given one measures how
foundational the corpus itself treats it. Capability HIPs then group by the
domain `capabilities.yaml` files them under, which is the grouping the doc site
uses. A HIP that becomes foundational rises without anyone noticing it should.

WHY THIS FILE REFUSES MORE OFTEN THAN IT WRITES

A generator that can quietly emit a short table is worse than no generator, because
the short table looks authoritative. The predecessor could emit one four ways: an
unreadable HIPs/ produced an empty table, a `capabilities.yaml` that failed to load
dropped an entire section through a bare `except: return []`, a `replace_section`
that matched nothing appended a second copy, and a crash between the two writes
left README half-projected. So:

  * NOTHING IS WRITTEN UNTIL EVERYTHING VALIDATES. Both sections are built and
    checked in memory; the file is written once, at the end, or not at all.
  * ROWS == FILES, exactly. Not "about right" -- every file on disk appears in
    the table exactly once and the table names no file that is not on disk.
  * A SHRINKING TABLE MUST SAY SO. Fewer rows than the README being replaced is
    refused unless --delete names exactly how many went. This is the check that
    catches an empty corpus, which rows==files cannot: zero files project to zero
    rows and agree with themselves perfectly.
  * A SECTION NEVER VANISHES QUIETLY. If the README being replaced has a section
    this run cannot rebuild -- the usual cause is capabilities.yaml not being
    checked out beside this repo -- that is an error, not a silent omission.
  * LINKS RESOLVE. Every `requires:` and every relative link into HIPs/ must name
    a file that exists, or nothing is written.

`--check` regenerates in memory and compares. It writes nothing and exits 1 on any
difference, so CI can hold README to the files without a second implementation of
what the projection is.
"""
from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path

try:
    import yaml
except ImportError:
    yaml = None

# --root lets the self-test point this at a mutated copy of the corpus. A guard
# nobody can aim at a broken tree is a guard nobody can prove.
_argv = sys.argv[1:]
ROOT = Path(_argv[_argv.index("--root") + 1] if "--root" in _argv
            else Path(__file__).resolve().parent.parent).resolve()
HIP_DIR = ROOT / "HIPs"
README = ROOT / "README.md"
VOCABULARY = ROOT / "vocabulary.json"
SPENT = ROOT / "spent.json"

# The domain grouping is hanzoai/openapi's editorial decision and this script
# reads it rather than restating it -- a second copy of a taxonomy is a second
# answer the day one of them moves. HANZO_CAPABILITIES overrides the path, which
# is how CI points at its own checkout; scripts/coverage.py reads the same var.
CAPABILITIES = Path(
    os.environ.get("HANZO_CAPABILITIES", ROOT.parent / "openapi" / "capabilities.yaml")
)

# How many HIPs must require one for it to lead the reading order. Set from the
# measured distribution, which has a wide gap in it: 104, 102, 102, then 23. Any
# threshold between 24 and 102 selects the same three, so this is not a knob
# anybody has to tune.
FOUNDATION = 40

INDEX_HEADING = "## HIP Index"
ORDER_HEADING = "## Reading order"

REQUIRED = ("hip", "title", "author", "type", "status", "created")
TITLE_WIDTH = 55


class Refused(Exception):
    """The projection is not safe to write. Nothing has been written."""


# --------------------------------------------------------------------------- read


def vocabulary() -> dict:
    return json.loads(VOCABULARY.read_text(encoding="utf-8"))


def spent() -> dict[int, str]:
    """Numbers that were published and then retired, and what each one was.

    Deleting a proposal is right -- a document nobody should follow does not
    earn a place in the index by being renamed Superseded. But deletion frees
    the NUMBER, and a number is the one part of a proposal that outlives it:
    it is cited in code, linked from outside, and quoted in commits. HIP-0138
    was deleted and reissued as a different specification within hours, so
    every existing reference to it now resolves to something it never said.
    The document goes; the address is kept, here, where it costs one line.
    """
    if not SPENT.exists():
        return {}
    return {int(k): v for k, v in
            json.loads(SPENT.read_text(encoding="utf-8")).items()}


def front_matter(text: str) -> tuple[dict[str, str], str]:
    if not text.startswith("---"):
        return {}, text
    end = text.find("\n---", 3)
    if end == -1:
        return {}, text
    out: dict[str, str] = {}
    for line in text[3:end].strip().splitlines():
        m = re.match(r"^([A-Za-z_-]+):(.*)$", line)
        if m:
            out[m.group(1).strip()] = m.group(2).strip().strip("\"'")
    return out, text[end + 4:]


def corpus() -> list[dict]:
    """Every HIP, with its front matter, body and number."""
    if not HIP_DIR.is_dir():
        raise Refused(f"{HIP_DIR} is not a directory")
    hips = []
    for path in sorted(HIP_DIR.glob("hip-*.md")):
        m = re.match(r"hip-(\d{4})", path.name)
        if not m:
            raise Refused(f"{path.name} is not hip-NNNN-*.md")
        fm, body = front_matter(path.read_text(encoding="utf-8"))
        if not fm:
            raise Refused(f"{path.name} has no front matter")
        hips.append({**fm, "number": int(m.group(1)), "file": path.name, "body": body})
    return sorted(hips, key=lambda h: h["number"])


def numbers_in(value: str) -> list[int]:
    """Every HIP number a `requires:` value names.

    The field is written several ways across the corpus -- 'HIP-0026', '[26, 27]',
    'HIP-0005 (Post-Quantum Security)', bare '26, 27', and 'LP-0010' for a Lux
    proposal. Only Hanzo numbers resolve here, so LP-* is dropped rather than
    reported as dangling.
    """
    return [int(n) for n in re.findall(r"\d+", re.sub(r"\bLP-\d+", "", value or ""))]


# ------------------------------------------------------------------------ refuse


def validate(hips: list[dict]) -> None:
    """Every reason to write nothing at all."""
    if not hips:
        raise Refused("HIPs/ holds no proposals")

    vocab = vocabulary()
    known = {h["number"] for h in hips}
    if len(known) != len(hips):
        seen: dict[int, str] = {}
        for h in hips:
            if h["number"] in seen:
                raise Refused(
                    f"HIP-{h['number']:04d} is claimed by both "
                    f"{seen[h['number']]} and {h['file']}"
                )
            seen[h["number"]] = h["file"]

    for number, was in spent().items():
        claim = next((h for h in hips if h["number"] == number), None)
        if claim and claim["title"] != was:
            raise Refused(
                f"HIP-{number:04d} was published as {was!r} and retired. "
                f"{claim['file']} claims it for {claim['title']!r}, so every "
                f"reference to HIP-{number:04d} now resolves to a different "
                f"specification. Give it an unused number."
            )

    files = {h["file"] for h in hips}
    for h in hips:
        where = h["file"]
        for field in REQUIRED:
            if not h.get(field):
                raise Refused(f"{where} has no {field}:")
        if h["status"] not in vocab["status"]:
            raise Refused(
                f"{where} has status {h['status']!r}; the vocabulary is "
                f"{sorted(vocab['status'])}"
            )
        if h["type"] not in vocab["type"]:
            raise Refused(
                f"{where} has type {h['type']!r}; the vocabulary is "
                f"{sorted(vocab['type'])}"
            )
        category = h.get("category", "")
        if category and category not in vocab["category"]:
            raise Refused(f"{where} has category {category!r}, which is not in the vocabulary")
        if h["type"] == "Standards Track" and not category:
            raise Refused(f"{where} is Standards Track and has no category:")

        for target in numbers_in(h.get("requires", "")):
            if target not in known:
                raise Refused(f"{where} requires HIP-{target:04d}, which does not exist")

        # A relative link into the corpus that names a deleted file renders as a
        # 404 on hips.hanzo.ai. This is the check that makes deleting a HIP safe:
        # the deletion is refused until every document that pointed at it is
        # repointed at whatever replaced it.
        for link in re.findall(r"\]\(\.{1,2}/(?:HIPs/)?(hip-[0-9a-z-]+\.md)[^)]*\)", h["body"]):
            if link not in files:
                raise Refused(f"{where} links {link}, which does not exist")


# ------------------------------------------------------------------------- write


def index(hips: list[dict]) -> str:
    lines = [
        INDEX_HEADING + "\n",
        "| Number | Title | Type | Category | Status |",
        "|:-------|:------|:-----|:---------|:-------|",
    ]
    for h in hips:
        title = h["title"]
        if len(title) > TITLE_WIDTH:
            title = title[: TITLE_WIDTH - 3] + "..."
        lines.append(
            f"| [HIP-{h['number']:04d}](./HIPs/{h['file']}) | {title} | "
            f"{h['type']} | {h.get('category') or '-'} | {h['status']} |"
        )
    return "\n".join(lines)


def required_by(hips: list[dict]) -> dict[int, int]:
    counts: dict[int, int] = {}
    for h in hips:
        for n in numbers_in(h.get("requires", "")):
            counts[n] = counts.get(n, 0) + 1
    return counts


def domains() -> list:
    """The domain grouping, from capabilities.yaml. Raises rather than degrading."""
    if yaml is None:
        raise Refused("PyYAML is not installed, so the capability grouping cannot be read")
    if not CAPABILITIES.exists():
        raise Refused(
            f"{CAPABILITIES} is not there. It lives in hanzoai/openapi, which this "
            "repo expects beside it; set HANZO_CAPABILITIES to point elsewhere."
        )
    loaded = yaml.safe_load(CAPABILITIES.read_text(encoding="utf-8"))
    got = (loaded or {}).get("domains") or []
    if not got:
        raise Refused(f"{CAPABILITIES} declares no domains")
    return got


def order(hips: list[dict], want_capabilities: bool) -> str:
    counts = required_by(hips)
    by_number = {h["number"]: h for h in hips}
    link = lambda h: f"[HIP-{h['number']:04d}](./HIPs/{h['file']})"

    lines = [
        ORDER_HEADING + "\n",
        "Every HIP by number is indexed below. This is the order it is learnable in, "
        "derived from the corpus rather than curated: a HIP's `requires:` names what a "
        "reader must already hold, so what the most HIPs require is what to read first. "
        "Regenerated by `scripts/index.py`.\n",
        "### Start here\n",
        "| | Required by | |",
        "|:--|--:|:--|",
    ]
    if 0 in by_number:
        lines.append(f"| {link(by_number[0])} | — | {by_number[0]['title']} — the map |")
    for n in sorted((n for n, c in counts.items() if c >= FOUNDATION and n in by_number),
                    key=lambda n: -counts[n]):
        lines.append(f"| {link(by_number[n])} | {counts[n]} | {by_number[n]['title']} |")
    lines.append("")

    # The next tier: required by enough HIPs to be worth holding before the
    # capabilities, but not by nearly all of them.
    second = sorted((n for n, c in counts.items() if 5 <= c < FOUNDATION and n in by_number),
                    key=lambda n: -counts[n])
    if second:
        lines += ["### Then the invariants\n", "| | Required by | |", "|:--|--:|:--|"]
        for n in second:
            lines.append(f"| {link(by_number[n])} | {counts[n]} | {by_number[n]['title']} |")
        lines.append("")

    named: dict[str, dict] = {}
    for h in hips:
        cap = (h.get("capability") or "").strip().strip("[]")
        if cap and "," not in cap:
            named.setdefault(cap, h)
    if named and want_capabilities:
        lines += [
            "### The capabilities\n",
            f"One capability, one HIP (HIP-0139). {len(named)} of them, grouped as "
            "`capabilities.yaml` groups them.\n",
        ]
        filed = set()
        for d in domains():
            rows = [named[t] for t in (d.get("tags") or []) if t in named]
            if not rows:
                continue
            filed.update(r["number"] for r in rows)
            lines.append(f"**{d.get('title', d.get('id', ''))}** — {d.get('role', '')}\n")
            lines.append(" · ".join(
                f"{link(h)} `{h['capability'].strip()}`"
                for h in sorted(rows, key=lambda x: x["number"])))
            lines.append("")
        rest = [h for h in named.values() if h["number"] not in filed]
        if rest:
            lines.append("**Not yet grouped**\n")
            lines.append(" · ".join(
                f"{link(h)} `{h['capability'].strip()}`"
                for h in sorted(rest, key=lambda x: x["number"])))
            lines.append("")

    return "\n".join(lines)


def swap(text: str, heading: str, new: str) -> str:
    """Replace one `## Section` with new text. The section must be there."""
    start = text.find(heading)
    if start == -1:
        raise Refused(f"README has no {heading!r} section to replace")
    after = text[start + len(heading):]
    nxt = re.search(r"\n## [^#]", after)
    if not nxt:
        return text[:start] + new
    return text[:start] + new + "\n\n" + after[nxt.start() + 1:]


def rows_in(text: str) -> list[str]:
    """The index rows of a README, as filenames."""
    start = text.find(INDEX_HEADING)
    if start == -1:
        return []
    after = text[start + len(INDEX_HEADING):]
    nxt = re.search(r"\n## [^#]", after)
    return re.findall(r"^\|\s*\[HIP-\d{4}\]\(\./HIPs/([^)]+)\)",
                      after[: nxt.start()] if nxt else after, re.M)


def project(hips: list[dict], before: str, deleting: int) -> str:
    """The whole README, or an exception. Writes nothing."""
    validate(hips)

    was = rows_in(before)
    # capabilities.yaml lives in a sibling repo. It is optional ONLY when the
    # README being replaced does not already carry the section it feeds -- losing
    # a section because an input was not checked out is the silent truncation
    # this file exists to prevent.
    want_capabilities = True
    if "### The capabilities" not in before and not CAPABILITIES.exists():
        want_capabilities = False

    text = swap(before, ORDER_HEADING, order(hips, want_capabilities))
    text = swap(text, INDEX_HEADING, index(hips))

    now = rows_in(text)
    if len(now) != len(hips):
        raise Refused(f"projected {len(now)} rows for {len(hips)} files; they must be equal")
    if set(now) != {h["file"] for h in hips}:
        missing = sorted({h["file"] for h in hips} - set(now))
        raise Refused(f"the table does not reach {len(missing)} files, e.g. {missing[:3]}")
    if len(now) < len(was) and len(was) - len(now) != deleting:
        raise Refused(
            f"the index would fall from {len(was)} rows to {len(now)}. If that is "
            f"deliberate, say so: --delete {len(was) - len(now)}"
        )
    for heading in (INDEX_HEADING, ORDER_HEADING):
        if text.count(heading) != 1:
            raise Refused(f"{heading!r} appears {text.count(heading)} times after projecting")
    return text


def main() -> int:
    argv = sys.argv[1:]
    check = "--check" in argv
    deleting = int(argv[argv.index("--delete") + 1]) if "--delete" in argv else 0

    before = README.read_text(encoding="utf-8")
    try:
        hips = corpus()
        text = project(hips, before, deleting)
    except Refused as why:
        print(f"REFUSED: {why}", file=sys.stderr)
        print("README.md is unchanged.", file=sys.stderr)
        return 1

    if check:
        if text != before:
            print("README.md has drifted from HIPs/. Run: python3 scripts/index.py",
                  file=sys.stderr)
            return 1
        print(f"README.md projects {len(hips)} HIPs, and matches them")
        return 0

    README.write_text(text, encoding="utf-8")
    caps = sum(1 for h in hips if (h.get("capability") or "").strip())
    print(f"README.md: {len(hips)} HIPs indexed, {caps} capabilities in the reading order")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
