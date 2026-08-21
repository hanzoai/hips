#!/usr/bin/env python3
"""Lint every HIP against the structure a HIP is required to have.

One implementation, run two ways:

    python3 scripts/lint-hips.py            # locally, before you push
    python3 scripts/lint-hips.py --list     # print the checks and exit

`.hanzo/workflows/ci.yml` calls this file. It used to carry its own copy of
these checks inline, which meant the gate could only ever run on the forge and
nobody could reproduce a failure without pushing. Two implementations of one
rule is the defect this repository exists to name, so there is now one.

Every check below fires on a defect that was actually present in `HIPs/` when
the check was written. None of them are hypothetical, and each is listed with
the count it found on the day it landed.

Exit status is 0 when clean, 1 when any ERROR is reported. WARNs never fail the
build; they are drift that is worth seeing and not worth blocking on.
"""
from __future__ import annotations

import os
import re
import sys
from collections import Counter, defaultdict

HIP_DIR = "HIPs"
README = "README.md"

# ---------------------------------------------------------------------------
# The closed vocabularies. README documents these in prose; this is the machine
# copy, and README's "Types of HIPs" / "HIP Process" sections must agree.
# ---------------------------------------------------------------------------

STATUS = {
    "Draft",       # written, not yet reviewed
    "Review",      # under review by HIP editors
    "Last Call",   # final review window before Final
    "Final",       # accepted as standard; changes need a new HIP
    "Active",      # accepted and continuously updated (living standards)
    "Superseded",  # replaced; MUST carry superseded-by
    "Withdrawn",   # abandoned by its author
}

TYPE = {
    "Standards Track",  # describes a thing we build and maintain
    "Process",          # how we work: numbering, branch names, what is public
    "Meta",             # governance and principles
    "Informational",    # guidance that normatively requires nothing
}

CATEGORY = {
    "Core", "Interface", "Infrastructure", "Security", "Cryptography",
    "Operator", "Bridge", "Governance", "Meta", "Application", "Platform",
}

REQUIRED_FIELDS = ("hip", "title", "author", "type", "status", "created")

# A Standards Track HIP describes something someone else must be able to build.
# Two sections are what make that possible at all -- what it is, and what is
# normatively required -- so their absence fails the build.
REQUIRED_SECTIONS = ("Abstract", "Specification")

# Motivation is what stops a spec being a pile of requirements nobody can weigh,
# and 99 of 138 HIPs carry one. It is not required, because its absence does not
# make a spec unimplementable, and a gate that fails 27 conforming CRD specs on
# a missing paragraph gets switched off rather than satisfied.
ADVISORY_SECTIONS = ("Motivation",)

# Naming another vendor's product as the measure of ours dates the document and
# frames our work as derivative. Stating that we speak someone's wire format is
# a fact about interoperation and stays.
#
# So the rule needs BOTH halves and fires on neither alone: a comparative phrase
# AND a named third-party product, close together. The first draft of this check
# fired on the phrase alone and reported 15 lines of which 12 were ordinary
# English -- "only as good as the source behind it", "a competitor cannot rebuild
# this", "golden-parity with the reference". A check that is wrong four times out
# of five trains its reader to skip it, which is worse than not having it.
# Only phrasings that measure OUR work against THEIRS. Weighing two candidate
# upstream dependencies against each other is ordinary engineering rationale and
# is not caught: "Vector vs Fluentbit" is us choosing a library, while "as good
# as" and "closest competitor" frame our product as a response to theirs.
# Dropping `vs`/`versus`/`compared to` from this set is what separates the two --
# they fired on six dependency-selection passages that are correct as written.
COMPARATIVE = re.compile(
    r"\b(?:"
    r"competitors?\b|competitive\s+(?:analysis|landscape)"
    r"|as\s+(?:good|capable|complete|powerful|fast|robust)\s+as"
    r"|parity\s+with|feature[- ]parity"
    r"|our\s+answer\s+to|a\s+clone\s+of"
    r"|modell?ed\s+(?:on|after)|inspired\s+by|in\s+the\s+style\s+of"
    r")",
    re.I,
)

# Named products. A mention alone is fine and usually correct; only a mention
# inside a comparison is a defect.
THIRD_PARTY = re.compile(
    r"\b(?:gcloud|Google\s+Cloud|GCP|AWS|Amazon\s+Web\s+Services|Azure"
    r"|Vercel|Netlify|Heroku|Fluentbit|Fluent\s*Bit|Vector|Coolify|Dokploy"
    r"|Flowise|Langflow|LangChain|Zapier|Airflow|Temporal"
    r"|HashiCorp|Terraform|Consul|Nomad|Auth0|Okta|Keycloak|Firebase|Supabase"
    r"|Datadog|New\s+Relic|Splunk|PagerDuty|Grafana|Snowflake|Databricks"
    r"|Mixpanel|Amplitude|Segment|Twilio|SendGrid|Stripe"
    r"|Kubernetes|Helm|Nginx|Caddy|Envoy|Istio|GitLab|Bitbucket|Jira)\b",
    re.I,
)

# How near the two halves must be to count as one statement.
COMPARISON_WINDOW = 80

# The private estate. A HIP specifies the public, forkable thing; if a reader
# needs one of these to implement it, the HIP is not a standard.
PRIVATE_ORG = re.compile(r"\bhanzo-inc/([A-Za-z0-9_.-]+)")

# HIP-0135 is the document that DRAWS the public/private line, so it is the one
# place the private org must be nameable. Nothing else gets an exemption.
PRIVATE_ORG_EXEMPT = {"hip-0135-what-is-public.md"}

FENCE = re.compile(r"^(?P<ind>\s{0,3})(?P<f>`{3,}|~{3,})\s*(?P<info>\S*)")
ATX = re.compile(r"^(#{1,6})\s+(.*?)\s*#*\s*$")
# A leading section number: "3", "3.1", "§3", "§1.2". The trailing guard stops
# "3a" being read as a re-use of "3" -- HIP-0127 labels a sub-point "3a — Schemas
# are co-located" directly after section 3, which is a distinct label and not a
# collision.
SECNUM = re.compile(r"^(?:§\s*)?(\d+(?:\.\d+)*)(?!\w)")

CHECKS = [
    ("FM001", "file has no YAML front matter"),
    ("FM002", "front matter is missing a required field"),
    ("FM003", "front-matter hip: disagrees with the filename"),
    ("FM004", "status: is outside the closed vocabulary"),
    ("FM005", "type: is outside the closed vocabulary"),
    ("FM006", "category: is outside the closed vocabulary, or missing on Standards Track"),
    ("FM007", "requires: names a HIP that does not exist"),
    ("FM008", "superseded-by is dangling, or Superseded carries no target"),
    ("FM009", "filename is not hip-NNNN-kebab-case.md"),
    ("ST001", "body has no H1, or more than one"),
    ("ST002", "H1 does not read 'HIP-NNNN: <title from front matter>'"),
    ("ST003", "two headings at the same level have identical text"),
    ("ST004", "two sections carry the same section number"),
    ("ST005", "a required section is missing"),
    ("ST006", "an unterminated code fence swallows the rest of the file"),
    ("ST007", "a subsection number does not extend its parent section number"),
    ("IX001", "README links a HIP file that does not exist"),
    ("IX002", "a HIP in HIPs/ is unreachable from the README index"),
    ("IX003", "two files claim one HIP number"),
    ("IX004", "a README index row disagrees with the file's front matter"),
    ("PL001", "normative comparison to a third-party product"),
    ("PL002", "the spec depends on a repository in the private org"),
]

# Where the projection lives. README holds more than one table of HIP links and
# only this section is the index; see index_check.
INDEX_HEADING = "## HIP Index"


class Report:
    def __init__(self) -> None:
        self.errors: list[tuple[str, str, str]] = []
        self.warns: list[tuple[str, str, str]] = []

    def error(self, code: str, where: str, msg: str) -> None:
        self.errors.append((code, where, msg))

    def warn(self, code: str, where: str, msg: str) -> None:
        self.warns.append((code, where, msg))


def split_front_matter(text: str) -> tuple[str | None, str]:
    """Return (front matter, body). Front matter is None when absent."""
    if not text.startswith("---"):
        return None, text
    end = text.find("\n---", 3)
    if end == -1:
        return None, text
    return text[3:end].strip(), text[end + 4:]


def parse_front_matter(raw: str) -> dict[str, str]:
    out: dict[str, str] = {}
    for line in raw.splitlines():
        m = re.match(r"^([A-Za-z_-]+):(.*)$", line)
        if m:
            out[m.group(1).strip()] = m.group(2).strip().strip("\"'")
    return out


def headings(body: str) -> tuple[list[tuple[int, int, str]], bool]:
    """ATX headings outside fenced code, and whether a fence was left open.

    Fence tracking is the whole reason this is a function. A naive scan counts
    every '# comment' inside a shell example as a heading; one file here holds
    22 of those, and a lint that reports them is a lint nobody runs twice.
    """
    out: list[tuple[int, int, str]] = []
    fence: tuple[str, int] | None = None
    for lineno, line in enumerate(body.splitlines(), 1):
        m = FENCE.match(line)
        if m:
            mark = m.group("f")
            if fence is None:
                fence = (mark[0], len(mark))
            elif mark[0] == fence[0] and len(mark) >= fence[1] and not m.group("info"):
                fence = None
            continue
        if fence is not None:
            continue
        h = ATX.match(line)
        if h:
            out.append((lineno, len(h.group(1)), h.group(2).strip()))
    return out, fence is not None


def hip_numbers_in(value: str) -> list[int]:
    """Every HIP number a `requires:` value names.

    The field is written five different ways across the corpus -- 'HIP-0026',
    '[26, 27]', 'HIP-0005 (Post-Quantum Security)', bare '26, 27', and 'LP-0010'
    for a Lux proposal. Only Hanzo numbers are resolvable here, so LP-* is
    skipped rather than reported as dangling.
    """
    stripped = re.sub(r"\bLP-\d+", "", value)
    return [int(n) for n in re.findall(r"\d+", stripped)]


def lint() -> Report:
    rep = Report()
    files = sorted(f for f in os.listdir(HIP_DIR) if f.endswith(".md"))

    by_number: dict[int, list[str]] = defaultdict(list)
    meta: dict[str, tuple[dict[str, str], str]] = {}

    for name in files:
        path = os.path.join(HIP_DIR, name)
        text = open(path, encoding="utf-8").read()
        raw, body = split_front_matter(text)

        if raw is None:
            rep.error("FM001", name, "no YAML front matter")
            continue
        fm = parse_front_matter(raw)
        meta[name] = (fm, body)

        m = re.fullmatch(r"hip-(\d{4})-[a-z0-9]+(?:-[a-z0-9]+)*\.md", name)
        if not m:
            rep.error("FM009", name, "filename is not hip-NNNN-kebab-case.md")
            m = re.match(r"hip-(\d{4})", name)
        if m:
            by_number[int(m.group(1))].append(name)

    known = set(by_number)

    for number, names in sorted(by_number.items()):
        if len(names) > 1:
            rep.error("IX003", f"HIP-{number:04d}", "claimed by " + ", ".join(sorted(names)))

    for name in files:
        if name not in meta:
            continue
        fm, body = meta[name]
        m = re.match(r"hip-(\d{4})", name)
        number = int(m.group(1)) if m else None

        for field in REQUIRED_FIELDS:
            if field not in fm:
                rep.error("FM002", name, f"no {field}:")

        if number is not None and "hip" in fm:
            declared = fm["hip"].strip()
            if not declared.isdigit() or int(declared) != number:
                rep.error("FM003", name, f"declares hip: {declared}, filename says {number:04d}")

        status = fm.get("status")
        if status and status not in STATUS:
            rep.error("FM004", name, f"status: {status!r} is not one of {sorted(STATUS)}")

        htype = fm.get("type")
        if htype and htype not in TYPE:
            rep.error("FM005", name, f"type: {htype!r} is not one of {sorted(TYPE)}")

        category = fm.get("category")
        if category and category not in CATEGORY:
            rep.error("FM006", name, f"category: {category!r} is not one of {sorted(CATEGORY)}")
        elif htype == "Standards Track" and not category:
            rep.error("FM006", name, "Standards Track HIP has no category:")

        for target in hip_numbers_in(fm.get("requires", "")):
            if target not in known:
                rep.error("FM007", name, f"requires HIP-{target:04d}, which does not exist")

        superseded_by = fm.get("superseded-by", "")
        if status == "Superseded" and not superseded_by:
            rep.error("FM008", name, "status is Superseded but no superseded-by:")
        for target in hip_numbers_in(superseded_by):
            if target not in known:
                rep.error("FM008", name, f"superseded-by HIP-{target:04d}, which does not exist")

        # ---- structure -------------------------------------------------
        heads, unterminated = headings(body)
        if unterminated:
            rep.error("ST006", name, "an unterminated code fence swallows the rest of the file")

        h1 = [(ln, txt) for ln, lvl, txt in heads if lvl == 1]
        if not h1:
            rep.error("ST001", name, "body has no H1")
        elif len(h1) > 1:
            rep.error("ST001", name, f"body has {len(h1)} H1 headings: " +
                      ", ".join(f"line {ln}" for ln, _ in h1[:5]))
        elif number is not None and "title" in fm:
            want = f"HIP-{number:04d}: {fm['title']}"
            if h1[0][1] != want:
                rep.error("ST002", name, f"H1 is {h1[0][1]!r}, front matter requires {want!r}")

        seen = Counter((lvl, txt) for _, lvl, txt in heads)
        for (lvl, txt), n in sorted(seen.items()):
            if n > 1:
                rep.error("ST003", name, f"{'#' * lvl} {txt!r} appears {n} times")

        # Section numbering. Two rules, because a naive "this number appears
        # twice" fires on every document that numbers 1..3 under one parent and
        # 1..3 under the next, which is ordinary structure and not a defect.
        #
        #   ST004 -- two sibling sections under one parent carry one number.
        #   ST007 -- a subsection's number does not extend its parent's. This is
        #            the shape a copy-pasted block leaves: HIP-0130 numbers the
        #            children of "## 11. Licensing" as 10.1, 10.2, 10.3.
        # Each open parent is (level, identity, number). Identity must be unique
        # per heading, not per number: keying an unnumbered parent as "<root>"
        # made every unnumbered "##" the same parent, so "### 1." under
        # "## Challenge types" collided with "### 1." under "## Verification" --
        # two ordinary numbered lists reported as a duplicate.
        stack: list[tuple[int, str, str | None]] = []
        siblings: dict[tuple[str, int], dict[str, str]] = defaultdict(dict)
        for lineno, lvl, txt in heads:
            while stack and stack[-1][0] >= lvl:
                stack.pop()
            sn = SECNUM.match(txt)
            num = sn.group(1) if sn else None
            parent_id = stack[-1][1] if stack else "<document>"
            parent_num = stack[-1][2] if stack else None

            if num:
                prior = siblings[(parent_id, lvl)].get(num)
                if prior is not None:
                    rep.error("ST004", name,
                              f"section {num} used twice under {parent_id[:32]!r}: "
                              f"{prior[:40]!r}; {txt[:40]!r}")
                else:
                    siblings[(parent_id, lvl)][num] = txt

                if "." in num and parent_num and not num.startswith(parent_num + "."):
                    rep.error("ST007", name,
                              f"{txt[:52]!r} is numbered {num} under section "
                              f"{parent_num}; it should extend {parent_num}.")
            stack.append((lvl, f"{lvl}:{lineno}:{txt[:32]}", num))

        # A Superseded or Withdrawn HIP is a tombstone: a pointer to whatever
        # replaced it. Requiring it to carry a full Abstract and Specification
        # is requiring prose that should not be written, since the live text
        # lives in the successor. HIP-0116 is the shape -- two sections, both
        # of which say "go read HIP-0106".
        if fm.get("type") == "Standards Track" and fm.get("status") not in ("Superseded", "Withdrawn"):
            present = {txt.lower() for _, lvl, txt in heads if lvl == 2}
            for want in REQUIRED_SECTIONS:
                if want.lower() not in present:
                    rep.error("ST005", name, f"no '## {want}' section")
            for want in ADVISORY_SECTIONS:
                if want.lower() not in present:
                    rep.warn("ST005", name, f"no '## {want}' section")

        # ---- policy ----------------------------------------------------
        for lineno, line in enumerate(body.splitlines(), 1):
            for cmp_hit in COMPARATIVE.finditer(line):
                lo = max(0, cmp_hit.start() - COMPARISON_WINDOW)
                hi = min(len(line), cmp_hit.end() + COMPARISON_WINDOW)
                prod = THIRD_PARTY.search(line, lo, hi)
                if prod:
                    rep.error(
                        "PL001", f"{name}:{lineno}",
                        f"compares to {prod.group(0)!r} ({cmp_hit.group(0)!r}): "
                        f"{line.strip()[:88]}")
                    break
        if name not in PRIVATE_ORG_EXEMPT:
            for hit in PRIVATE_ORG.finditer(body):
                rep.error("PL002", name,
                          f"depends on the private repository {hit.group(0)}")

    index_check(files, meta, rep)
    return rep


def index_check(files, meta, rep: Report) -> None:
    """README's table is a projection of HIPs/. Prove it still projects.

    Only the index. README carries a second table of HIP links -- the reading
    order, the same corpus in the order it is learnable, whose columns are a
    link, a count and a title. Reading the whole file matched those rows too and
    compared a required-by count against a `type:`, so the projection check
    failed on a section that is not the projection. The index starts at its own
    heading and ends at the next one.
    """
    src = open(README, encoding="utf-8").read()
    start = src.find(INDEX_HEADING)
    if start == -1:
        rep.error("IX001", README, f"has no {INDEX_HEADING!r} section")
        return
    rest = src[start + len(INDEX_HEADING):]
    nxt = re.search(r"\n## [^#]", rest)
    src = rest[: nxt.start()] if nxt else rest
    rows = re.findall(
        r"^\|\s*\[HIP-(\d{4})\]\(\./HIPs/([^)]+)\)\s*\|([^|]*)\|([^|]*)\|([^|]*)\|([^|]*)\|",
        src, re.M)

    linked = {r[1] for r in rows}
    have = set(files)
    for missing in sorted(linked - have):
        rep.error("IX001", README, f"links ./HIPs/{missing}, which does not exist")
    for unreached in sorted(have - linked):
        rep.error("IX002", unreached, "is unreachable from the README index")

    for num, fname, title, htype, category, status in rows:
        if fname not in meta:
            continue
        fm = meta[fname][0]
        title, htype, category, status = (x.strip() for x in (title, htype, category, status))
        if htype and fm.get("type", "") != htype:
            rep.error("IX004", f"{README} HIP-{num}",
                      f"row says type {htype!r}, file says {fm.get('type','')!r}")
        if status and fm.get("status", "") != status:
            rep.error("IX004", f"{README} HIP-{num}",
                      f"row says status {status!r}, file says {fm.get('status','')!r}")
        want_cat = fm.get("category", "") or "-"
        if category and category != want_cat:
            rep.error("IX004", f"{README} HIP-{num}",
                      f"row says category {category!r}, file says {want_cat!r}")
        # The table truncates long titles with an ellipsis; compare the prefix.
        want_title = fm.get("title", "")
        if title.endswith("..."):
            if not want_title.startswith(title[:-3]):
                rep.error("IX004", f"{README} HIP-{num}",
                          f"row title {title!r} is not a prefix of {want_title!r}")
        elif title != want_title:
            rep.error("IX004", f"{README} HIP-{num}",
                      f"row says title {title!r}, file says {want_title!r}")


def main() -> int:
    if "--list" in sys.argv:
        for code, what in CHECKS:
            print(f"{code}  {what}")
        return 0

    # --root lets the self-test run this against a scratch copy of the corpus.
    # A lint nobody can point at a mutated tree is a lint nobody can prove.
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    if "--root" in sys.argv:
        root = sys.argv[sys.argv.index("--root") + 1]
    os.chdir(root)

    rep = lint()
    for code, where, msg in sorted(rep.warns):
        print(f"warn  {code}  {where}: {msg}")
    for code, where, msg in sorted(rep.errors):
        print(f"ERROR {code}  {where}: {msg}")

    total = len(os.listdir(HIP_DIR))
    if rep.errors:
        by_code = Counter(c for c, _, _ in rep.errors)
        print(f"\n{len(rep.errors)} errors across {total} HIPs: " +
              ", ".join(f"{c}x{n}" for c, n in sorted(by_code.items())))
        return 1
    print(f"{total} HIPs, no structural defects")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
