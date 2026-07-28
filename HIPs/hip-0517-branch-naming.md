---
hip: 0517
title: Branch Naming — main is the Trunk, Everywhere
author: Hanzo AI Team
type: Process
category: Meta
status: Active
created: 2026-07-27
---

# HIP-517: Branch Naming — `main` is the Trunk, Everywhere

## Preamble

A branch name is not a preference. It is an **address** that automation resolves:
CI triggers on it, GitOps Applications pin `targetRevision` to it, release gates
check it, mirrors sync it, and every `README` that says "clone and go" assumes it.
When the address varies per repo, every one of those systems needs a per-repo
exception, and the exception is invisible until the day it silently does nothing.

This HIP fixes the address. Across Hanzo, Lux, and Zoo the trunk is **`main`**.

## The state this was written from

A survey of 1,190 non-archived repositories across `hanzoai`, `hanzo-apps`,
`hanzo-templates`, `luxfi`, `lux-apps`, `zooai`, `zoo-apps`, `zenlm`, `luxcpp`
and `hanzo-js`:

| default branch | repos |
|---|---|
| `main` | 1066 |
| `master` | 108 |
| `develop` / `dev` | 8 |
| a leftover feature or CI branch | 5 |
| none (empty repo) | 2 |

The tail is the part that matters. Five repositories have a **transient branch as
their default** — `luxfi/pqclean` on `fix-sphincs-duplicate-consistency`,
`zenlm/zen-private` on `fix-ci-1782365623`, `luxcpp/papers` on
`fix-ci-1782355258`, `luxfi/cggmp21.rs` on `m`, `luxfi/verkle` on
`account-leaf`. A throwaway branch became the thing every clone, every CI run and
every dependency resolution reads first. Nobody chose that; it is what happens
when the trunk has no name the tooling can assume.

## Specification

### 1. The trunk is `main`

Every repository in every Hanzo, Lux, and Zoo organization has a default branch
named `main`. Not `master`, not `develop`, not `trunk`, and never a feature or CI
branch.

This applies to repositories we own. Upstream forks keep whatever the upstream
uses on the branches that track upstream — but our own default branch is still
`main`, because that is the branch our tooling reads.

### 2. `dev` is the only other long-lived branch, and it is optional

A repository that needs an integration branch uses exactly one, named `dev`.
`develop` is not a synonym; pick one spelling or the tooling needs two.

Most repositories should not have one. Feature branches integrate into `main`
rapidly; a long-lived `dev` that drifts is a merge debt that compounds, and the
`hanzoai/templates` case below shows what the end state looks like.

### 3. Feature branches are `<kind>/<subject>`

`feat/`, `fix/`, `chore/`, `docs/`. No dates in branch names — a date in a branch
name is a comment that cannot be updated and is wrong by the second commit.

### 4. A feature branch may never become a default branch

If a default branch is ever observed pointing at a `fix/*`, `feat/*` or a CI-
generated name, that is an incident, not a preference: it means a force-push or a
branch deletion took the trunk with it.

### 5. Renaming is a rename, not a re-push

Use the rename operation, which moves open pull requests and installs a redirect:

```
gh api -X POST repos/<org>/<repo>/branches/master/rename -f new_name=main
```

Do NOT create `main` as a fresh branch beside `master` and switch the default.
That produces two branches with **unrelated histories** in one repository, and
every later merge fails with `refusing to merge unrelated histories`. This is not
hypothetical — see below.

## The failure this prevents

`hanzoai/templates` carries both. `master` held 30 commits `main` lacked; `main`
held 7 commits `master` lacked; the two shared **no common ancestor**. `master`
is the submodule-based catalog with 68 `.gitmodules` entries. `main` is a
flattened rewrite with no `.gitmodules` at all and a `flatten-apps.sh` explaining
the intent.

Both are real work. Neither is stale. The repository cannot merge them, and no
tool can tell which one a reader should trust — `git` will happily serve either.
That is the cost of creating `main` alongside `master` instead of renaming, and
it is unrecoverable without a human deciding which history is canonical.

## Migration

1. Rename `master` → `main` with the API call above (108 repositories).
2. Where a `main` already exists beside `master` with unrelated history, a human
   picks the canonical history first. There is no safe automatic answer.
3. Repoint anything that pinned the old name: GitOps `targetRevision`,
   `.gitmodules` branch keys, CI `on.push.branches`, and mirror configurations.
4. Consolidate `develop` → `dev` (8 repositories).
5. For the 5 repositories defaulting to a transient branch, identify the real
   trunk and set it; the transient branch is then deleted, not kept.

Renaming installs a redirect for clones and API reads. That redirect is not
permanent insurance: it is **released the moment any new branch claims the old
name**, exactly as a transferred repository's redirect dies when a new repository
claims its old path. Repoint the pins; do not rely on the redirect.

## Rationale

One name, resolved the same way by every tool, is worth more than any argument
for a different name. `main` wins because 1,066 of 1,190 repositories already use
it — the cost of this HIP is 108 renames, and the cost of the alternative is
1,066.
