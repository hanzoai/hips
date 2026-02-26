# HIP-009: Unified Agent Skills Architecture

| Field | Value |
|-------|-------|
| HIP | 009 |
| Title | Unified Agent Skills Architecture |
| Author | Hanzo AI |
| Status | Draft |
| Created | 2026-02-26 |

## Abstract

Define a unified approach to agent skill distribution where `~/.hanzo/skills/` serves as the canonical source of truth for all AI agent skills, with automatic symlinks into agent-specific directories (Claude Code, Cursor, Codex, Openclaw, Hanzo Bot). This ensures all agents share a single consistent skill set while maintaining compatibility with the open Agent Skills specification.

## Motivation

The AI agent ecosystem is fragmenting across multiple tools, each with its own skill discovery directory:

- Claude Code: `~/.claude/skills/`
- Cursor: `~/.cursor/skills/`
- Codex / Openclaw: `~/.agents/skills/`
- Hanzo Bot: `~/.hanzo/bot/skills/` (legacy) / `~/.bot/skills/`

When a user installs skills via `npx skills add org/repo`, the skills get installed per-agent. This means:

1. **Duplication** — same skills cloned N times for N agents
2. **Inconsistency** — updating one agent's skills doesn't update others
3. **No single source of truth** — hard to audit what's installed

## Specification

### Canonical Directory

All skills are stored in `~/.hanzo/skills/`. This directory is the single source of truth.

```
~/.hanzo/skills/
├── bootnode-skills/        # Cloned from github.com/bootnode/skills
│   └── skills/
│       ├── bootnode-api/
│       │   └── SKILL.md
│       └── agentic-gateway/
│           └── SKILL.md
├── hanzoai-skills/         # Cloned from github.com/hanzoai/skills
│   └── skills/
│       └── ...
└── other-org-skills/
    └── ...
```

### Symlink Distribution

After installing to `~/.hanzo/skills/<name>`, symlinks are created in all supported agent directories:

```
~/.claude/skills/<name>  → ~/.hanzo/skills/<name>
~/.agents/skills/<name>  → ~/.hanzo/skills/<name>
~/.cursor/skills/<name>  → ~/.hanzo/skills/<name>
~/.hanzo/bot/skills/<name> → ~/.hanzo/skills/<name>
```

This ensures every agent sees the same skills from the same source.

### Installation Methods

**Open standard (any agent):**
```bash
npx skills add bootnode/skills --yes
```

**Hanzo Bot native (with symlink distribution):**
```bash
npx @hanzo/bot skills add bootnode/skills --yes
```

Both methods result in the same outcome: skills in `~/.hanzo/skills/` with symlinks everywhere.

### Skill Format

Skills follow the open [Agent Skills specification](https://agentskills.io/specification):

```yaml
---
name: skill-name
description: When to use this skill
metadata:
  author: org-name
  version: "1.0"
  bot:
    emoji: "🔗"
    requires:
      env: [API_KEY]
---

# Skill Name

[Markdown instructions, endpoints, examples]
```

### Updates

```bash
# Update a skill repo (git pull)
npx @hanzo/bot skills add bootnode/skills  # re-runs, pulls if exists

# Force reinstall
npx @hanzo/bot skills add bootnode/skills --force

# Remove (cleans canonical + all symlinks)
npx @hanzo/bot skills remove bootnode-skills
```

### Multi-Brand Support

Each Bootnode white-label brand publishes its own skills repo with identical capabilities but branded configuration:

| Brand | Skills Repo | GitHub Org |
|-------|------------|------------|
| Bootnode | `bootnode/skills` | github.com/bootnode |
| Hanzo Web3 | `hanzoai/skills` | github.com/hanzoai |
| Lux Cloud | `luxfi/skills` | github.com/luxfi |
| Zoo Labs | `zooai/skills` | github.com/zooai |
| Pars Cloud | `parsnetwork/skills` | github.com/parsnetwork |

All skills repos share the same structure and API surface. The differences are:
- Base URLs (api.bootno.de vs api.web3.hanzo.ai vs api.cloud.lux.network)
- Auth configuration
- Network defaults (Lux skills default to Lux chain, etc.)

## Rationale

### Why ~/.hanzo/skills/?

1. **Hanzo-owned namespace** — `.hanzo/` is our territory, not shared with any other tool
2. **Short path** — `~/.hanzo/skills/` is clean and memorable
3. **Unified** — all Hanzo tools (bot, CLI, MCP) can share this location
4. **Non-conflicting** — doesn't collide with `.claude/`, `.cursor/`, `.agents/`

### Why symlinks instead of copies?

1. **Single update point** — `git pull` in canonical dir updates all agents instantly
2. **Disk efficient** — no duplication
3. **Auditable** — `ls -la ~/.claude/skills/` shows exactly where skills come from
4. **Graceful degradation** — if an agent doesn't support symlinks, it still works via direct install

### Why follow the open standard?

1. **Adoption** — `npx skills add` already works with 40+ agents
2. **No lock-in** — users aren't forced to use Hanzo Bot
3. **Ecosystem** — skills written for any agent work with Hanzo Bot and vice versa
4. **Distribution** — appearing in the `npx skills` ecosystem gives us free distribution

### Why also support `npx @hanzo/bot skills add`?

1. **Symlink distribution** — the open `npx skills` tool installs per-agent; our command installs once and symlinks everywhere
2. **Hanzo-optimized** — our command prefers `~/.hanzo/skills/` as canonical
3. **Offline capable** — works without the `skills` npm package
4. **Unified experience** — users already in `@hanzo/bot` don't need another tool

## Security Considerations

- Skills are cloned from public GitHub repos — users should verify the source
- Private key environment variables (like `BOOTNODE_WALLET_PRIVATE_KEY`) must never be logged
- SKILL.md files are Markdown with YAML frontmatter — no executable code in the skill definition itself
- Skills that require shell execution should use `scripts/` subdirectory with explicit `requires.bins` declarations

## Backwards Compatibility

- `~/.bot/skills/` (legacy Hanzo Bot managed dir) continues to be scanned
- `~/.hanzo/bot/skills/` symlink added for backwards compatibility
- Existing `npx skills add` installations in agent-specific dirs are not affected

## References

- [Agent Skills Specification](https://agentskills.io/specification)
- [Vercel Skills CLI](https://github.com/vercel-labs/skills)
- [Hanzo Bot](https://hanzo.bot)
- [HIP-008: Payment Platform](./HIP-008-payment-platform.md)
