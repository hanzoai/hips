# Contributing to Hanzo Improvement Proposals (HIPs)

Thank you for contributing to Hanzo Improvement Proposals ([hips.hanzo.ai](https://hips.hanzo.ai)). For general contributor onboarding across all Hanzo repositories and documentation, see [docs.hanzo.ai/docs/contributing](https://docs.hanzo.ai/docs/contributing).

## Community & Discussion

Join [Hanzo Discord](https://discord.gg/XthHQQj) (`#hips` and `#docs`) to discuss proposals, ask questions, and coordinate with maintainers before or while drafting a HIP.

## Writing a HIP

1. **One thing we build → one public repo → one HIP.** Before starting a new proposal, check [hips.hanzo.ai](https://hips.hanzo.ai) (`HIPs/`) to see if a HIP already covers the capability or subsystem. If one exists, update that HIP rather than duplicating it.
2. **Copy the template:**
   ```bash
   cp docs/templates/hip-template.md HIPs/hip-<NNNN>-<slug>.md
   ```
3. **Follow the status rules:**
   - A new proposal lands as `Draft`.
   - It becomes `Final` when the capability it specifies is shipped in production code.
   - `Meta` and `Process` HIPs use `Living` and are amended in place.
   - State the design as it is — omit revision histories, changelog tables, or incident notes inside the specification body.
4. **Validate locally before opening a pull request:**
   ```bash
   python3 scripts/lint-hips.py          # validate front matter, structure, links, and policy
   python3 scripts/index.py              # project HIPs/ onto README.md
   python3 scripts/index.py --check      # verify README.md is in sync
   ```
5. **Open a pull request** against `main` on [`hanzoai/hips`](https://github.com/hanzoai/hips).

## Rewards

Merged contributions can earn points on Hanzo Rewards: see [hanzo.ai/bounty](https://hanzo.ai/bounty) and [hanzo.ai/leaderboard](https://hanzo.ai/leaderboard).

## Security & Conduct

- Never report a security vulnerability in a public issue or PR. Follow [SECURITY.md](https://github.com/hanzoai/.github/blob/main/SECURITY.md) (`security@hanzo.ai`).
- Everyone participating follows the [Code of Conduct](https://github.com/hanzoai/.github/blob/main/CODE_OF_CONDUCT.md).
