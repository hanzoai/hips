#!/usr/bin/env python3
"""Does every capability have a HIP?

`lint-hips.py` checks the corpus against ITSELF -- front matter, structure, the
index. It needs no input but the corpus, which is why it can be total. This asks
the other question, and it cannot be answered from the corpus alone: **is there a
HIP for every `/v1/<capability>` the cloud serves?**

The capability list is therefore an INPUT, and a missing input is an ERROR rather
than a skip. A coverage check that quietly passes when it cannot find the list is
the shape this estate keeps deleting: a gate that has only ever been seen to pass
has not been shown to work.

    python3 scripts/coverage.py            # exits 1 on any ERROR
    python3 scripts/coverage.py --list     # the checks, by code
    python3 scripts/coverage.py --report   # measure and print, never fail

**A HIP covers a capability when it SAYS SO, in front matter: `capability: sandbox`.**
Declared, never inferred, and one capability has exactly one HIP.

The two inferring rules were both tried and both overstate. Matching a title reads
"Data Plane" as covering `data` and "On-chain settlement" as covering `chain`.
Matching the ROUTE in the body is tighter and still wrong in the direction that
matters: measured on this corpus it credited 72 of 191, but HIP-0106 earned nine
of those by LISTING the plugin set and HIP-0040 earned `audio` by showing an SDK
call. A reference is not a specification, and a gate that counts references
reports a corpus that covers the surface when it does not.

Route mention survives as a HINT -- `mentions()` names the HIP that already talks
about a capability, so adopting an uncovered one is mechanical rather than a
search. It decides nothing.

**UNCOVERED is a RATCHET, not a list of excuses.** `capability-coverage.txt`
carries the capabilities that have no HIP yet, and it may only SHRINK. A new
capability with no HIP fails, so the gap cannot grow silently while the surface
does. A capability that gains a HIP must leave the file in the same commit, so
the file cannot rot into prose that describes a corpus nobody has. Same shape as
cloud's `openapi/floor.json` and `openapi/unreachable.txt`, for the same reason.

**Nothing here hardcodes a count.** Every number this prints is measured at the
moment it runs, against the capability list of the release being cut. A count
written into prose is stale the next week; a count printed by a gate is not.
"""

from __future__ import annotations

import os
import re
import sys
from collections import Counter

HIP_DIR = "HIPs"
RATCHET = "capability-coverage.txt"

# Where the capability list comes from, most explicit first. It is the PUBLIC
# taxonomy (hanzoai/openapi `capabilities.yaml`), regenerated when a cloud
# version is cut -- so this gate measures the release it is run against rather
# than a snapshot somebody committed here. A second copy inside this repo would
# be exactly the drift the ratchet exists to prevent.
CAPABILITY_SOURCES = (
    os.environ.get("HANZO_CAPABILITIES"),
    "../openapi/capabilities.yaml",
    "../../openapi/capabilities.yaml",
)

CHECKS = [
    ("CV001", "a capability has no HIP and is not in the ratchet"),
    ("CV002", "a ratchet entry now HAS a HIP -- delete the line"),
    ("CV003", "the ratchet names a capability that no longer exists"),
    ("CV004", "the capability list could not be resolved"),
    ("CV005", "two HIPs declare one capability"),
    ("CV006", "a HIP declares a capability nothing serves"),
]


class Report:
    def __init__(self) -> None:
        self.errors: list[tuple[str, str, str]] = []
        self.warns: list[tuple[str, str, str]] = []

    def error(self, code: str, where: str, msg: str) -> None:
        self.errors.append((code, where, msg))

    def warn(self, code: str, where: str, msg: str) -> None:
        self.warns.append((code, where, msg))


def capabilities(path: str) -> tuple[list[str], dict[str, str]]:
    """The declared capabilities, and the domain each one sits in.

    Parsed without PyYAML: this runs in CI images that carry a bare Python, and
    a lint that needs a pip install is a lint that gets skipped. The shape is
    fixed and shallow -- `domains:`, each with a `name:` and a list of leaf
    strings -- so a reader can check this against the file by eye.
    """
    caps: list[str] = []
    domain: dict[str, str] = {}
    current = ""
    buf = ""          # an open `tags: [` flow sequence, which wraps across lines
    for raw in open(path, encoding="utf-8").read().splitlines():
        line = raw.split("#", 1)[0].rstrip() if not buf else raw.rstrip()
        if not line.strip():
            continue
        if buf:
            buf += " " + line.strip()
        else:
            m = re.match(r"^\s*-\s*id:\s*['\"]?([A-Za-z0-9_.-]+)", line)
            if m:
                current = m.group(1)
                continue
            m = re.match(r"^\s*tags:\s*\[(.*)$", line)
            if not m:
                continue
            buf = m.group(1)
        if "]" not in buf:
            continue
        for cap in re.findall(r"[A-Za-z0-9_.-]+", buf[:buf.index("]")]):
            caps.append(cap)
            domain.setdefault(cap, current)
        buf = ""
    return sorted(set(caps)), domain


def declares(text: str) -> list[str]:
    """The capabilities a HIP DECLARES it specifies, from its front matter:

        capability: sandbox
        capability: [sandbox, exec]

    Declared, never inferred. Reading a route out of the prose instead credits
    every passing mention: HIP-0106 names nine capabilities because it LISTS the
    plugin set, and HIP-0040 names `audio` because it shows an SDK call. Those
    are references, not specifications, and counting them reports a corpus that
    covers the surface when it does not.
    """
    fm, _ = split_front_matter(text)
    if not fm:
        return []
    m = re.search(r"^capability:\s*(.+)$", fm, re.M)
    if not m:
        return []
    return re.findall(r"[A-Za-z0-9_.-]+", m.group(1))


def mentions(cap: str, bodies: dict[str, str]) -> list[str]:
    """HIPs whose body names `/v1/<cap>` -- a HINT for which HIP should declare
    it, never the rule. Reported to make the migration mechanical."""
    route = re.compile(rf"/v1/{re.escape(cap)}(?![A-Za-z0-9_-])")
    return sorted(f for f, body in bodies.items() if route.search(body))


def split_front_matter(text: str) -> tuple[str | None, str]:
    if not text.startswith("---"):
        return None, text
    end = text.find("\n---", 3)
    if end == -1:
        return None, text
    return text[3:end].strip(), text[end + 4:]


def ratchet() -> list[str]:
    if not os.path.exists(RATCHET):
        return []
    out = []
    for line in open(RATCHET, encoding="utf-8").read().splitlines():
        line = line.split("#", 1)[0].strip()
        if line:
            out.append(line)
    return out


def measure() -> tuple[Report, dict]:
    rep = Report()

    path = next((p for p in CAPABILITY_SOURCES if p and os.path.exists(p)), None)
    if not path:
        rep.error("CV004", "capability list",
                  "not found. Set HANZO_CAPABILITIES to hanzoai/openapi's "
                  "capabilities.yaml, or check that repo out beside this one. "
                  "Refusing to report coverage against a list I do not have.")
        return rep, {}

    caps, domain = capabilities(path)
    if not caps:
        rep.error("CV004", path, "resolved but named no capabilities")
        return rep, {}

    bodies = {}
    for name in sorted(os.listdir(HIP_DIR)):
        if name.endswith(".md"):
            bodies[name] = open(os.path.join(HIP_DIR, name),
                                encoding="utf-8", errors="replace").read()

    hits: dict[str, list[str]] = {c: [] for c in caps}
    for name, text in bodies.items():
        for cap in declares(text):
            if cap in hits:
                hits[cap].append(name)
            else:
                rep.error("CV006", name,
                          f"declares capability {cap!r}, which nothing serves")

    have = {c for c, v in hits.items() if v}
    missing = [c for c in caps if c not in have]
    known = ratchet()

    for c in missing:
        hint = mentions(c, bodies)
        where = f" -- {hint[0]} already names the route" if hint else ""
        if c not in known:
            rep.error("CV001", c,
                      f"({domain.get(c, '?')}) no HIP declares it{where}. Write "
                      f"one, or add {c} to {RATCHET} with the reason.")
    for c in known:
        if c in have:
            rep.error("CV002", c,
                      f"is in {RATCHET} but {hits[c][0]} declares it -- "
                      "delete the line in the same commit")
        elif c not in caps:
            rep.error("CV003", c,
                      f"is in {RATCHET} but is not a capability any more")

    for c in sorted(have):
        if len(hits[c]) > 1:
            rep.error("CV005", c,
                      f"{len(hits[c])} HIPs declare it: {', '.join(hits[c])}. "
                      "One capability, one HIP.")

    return rep, {
        "source": path, "caps": caps, "domain": domain,
        "hits": hits, "have": have, "missing": missing, "known": known,
    }


def main() -> int:
    if "--list" in sys.argv:
        for code, what in CHECKS:
            print(f"{code}  {what}")
        return 0

    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    if "--root" in sys.argv:
        root = sys.argv[sys.argv.index("--root") + 1]
    os.chdir(root)

    rep, m = measure()
    report_only = "--report" in sys.argv

    if m:
        caps, have, missing = m["caps"], m["have"], m["missing"]
        by_domain: dict[str, list[int]] = {}
        for c in caps:
            d = m["domain"].get(c, "?")
            row = by_domain.setdefault(d, [0, 0])
            row[1] += 1
            if c in have:
                row[0] += 1
        print(f"capabilities {len(caps)} from {m['source']}")
        for d, (h, n) in sorted(by_domain.items()):
            print(f"  {d:16s} {h:3d}/{n:3d}")
        print(f"covered {len(have)}  uncovered {len(missing)}  "
              f"ratchet {len(m['known'])}")

    for code, where, msg in sorted(rep.warns):
        print(f"warn  {code}  {where}: {msg}")
    for code, where, msg in sorted(rep.errors):
        print(f"ERROR {code}  {where}: {msg}")

    if rep.errors and not report_only:
        by_code = Counter(c for c, _, _ in rep.errors)
        print("\n" + ", ".join(f"{c}x{n}" for c, n in sorted(by_code.items())))
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
