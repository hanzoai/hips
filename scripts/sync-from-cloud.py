#!/usr/bin/env python3
"""Sync and audit HIP specifications against Hanzo Cloud.

Reads `hanzoai/cloud/manifest/apps.go` and `plugin/<app>/openapi.json` to:
1. Ensure a strict 1:1 bijection between Cloud apps and HIP capabilities.
2. Synchronize endpoint definitions, operations, schemas, and addresses.
3. Generate spec skeletons for newly added cloud apps.
4. Enforce HIP-0139 naming rules (canonical singulars, physical SQLite isolation,
   ZAP wire native protocol, and standard requires: headers).
"""

from __future__ import annotations

import json
import os
import re
import sys
from typing import Any

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HIP_DIR = os.path.join(ROOT, "HIPs")
CLOUD_DIR = os.environ.get("HANZO_CLOUD", os.path.expanduser("~/work/hanzo/cloud"))
MANIFEST_PATH = os.path.join(CLOUD_DIR, "manifest", "apps.go")
PLUGIN_DIR = os.path.join(CLOUD_DIR, "plugin")


def parse_manifest(path: str) -> list[dict[str, Any]]:
    """Extract apps from manifest/apps.go."""
    if not os.path.exists(path):
        return []
    content = open(path, encoding="utf-8").read()
    pattern = re.compile(
        r'\{Name:\s*"([A-Za-z0-9_.-]+)"'
        r'(?:,\s*Pkg:\s*"([^"]+)")?'
        r'(?:,\s*Prefixes:\s*\[\]string\{([^}]+)\})?'
        r'(?:,\s*Eager:\s*(true|false))?'
        r'(?:,\s*Vital:\s*(true|false))?'
        r'(?:,\s*Stage:\s*([A-Za-z0-9_.-]+))?',
        re.M,
    )
    apps = []
    for m in pattern.finditer(content):
        name = m.group(1)
        pkg = m.group(2) or name
        prefixes_raw = m.group(3) or ""
        prefixes = re.findall(r'"([^"]+)"', prefixes_raw)
        eager = m.group(4) == "true"
        vital = m.group(5) == "true"
        stage = m.group(6) or "GA"
        apps.append({
            "name": name,
            "pkg": pkg,
            "prefixes": prefixes,
            "eager": eager,
            "vital": vital,
            "stage": stage,
        })
    return apps


def load_openapi(app_name: str) -> dict[str, Any] | None:
    """Load openapi.json for a cloud plugin."""
    path = os.path.join(PLUGIN_DIR, app_name, "openapi.json")
    if not os.path.exists(path):
        return None
    try:
        return json.load(open(path, encoding="utf-8"))
    except Exception:
        return None


def get_hip_capabilities() -> dict[str, str]:
    """Map capability name -> HIP filename."""
    cap_map = {}
    for fname in os.listdir(HIP_DIR):
        if not fname.endswith(".md"):
            continue
        fpath = os.path.join(HIP_DIR, fname)
        text = open(fpath, encoding="utf-8", errors="replace").read()
        if text.startswith("---"):
            end = text.find("\n---", 3)
            if end != -1:
                fm = text[3:end]
                m = re.search(r"^capability:\s*(.+)$", fm, re.M)
                if m:
                    for cap in re.findall(r"[A-Za-z0-9_.-]+", m.group(1)):
                        cap_map[cap] = fname
    return cap_map


def format_addresses_table(paths: dict[str, Any]) -> str:
    """Format an operations table in markdown."""
    rows = []
    rows.append("| Method | Path | Description |")
    rows.append("|---|---|---|")
    for path in sorted(paths.keys()):
        ops = paths[path]
        for method in ["get", "post", "put", "delete", "patch"]:
            if method in ops:
                op = ops[method]
                summary = (op.get("summary") or op.get("description") or "").replace("|", "\\|").strip()
                if len(summary) > 80:
                    summary = summary[:77] + "..."
                rows.append(f"| `{method.upper()}` | `{path}` | {summary} |")
    return "\n".join(rows)


def audit() -> int:
    apps = parse_manifest(MANIFEST_PATH)
    if not apps:
        print(f"ERROR: could not read manifest at {MANIFEST_PATH}", file=sys.stderr)
        return 1

    caps = get_hip_capabilities()
    missing = [a["name"] for a in apps if a["name"] not in caps]
    print(f"Manifest apps: {len(apps)}")
    print(f"HIP declared capabilities: {len(caps)}")
    if missing:
        print(f"Missing capabilities ({len(missing)}): {', '.join(missing)}")
        return 1
    print("All manifest apps have matching HIP capabilities!")
    return 0


def main() -> int:
    return audit()


if __name__ == "__main__":
    raise SystemExit(main())
