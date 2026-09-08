---
hip: 1328
title: Forge — The Meta Code Host
author: Hanzo AI
type: Standards Track
category: Infrastructure
capability: forge
status: Draft
created: 2026-09-08
requires: HIP-0106, HIP-0139, HIP-1114, HIP-1122, HIP-1232
---

# HIP-1328: Forge — The Meta Code Host

## Abstract

Forge is where software is built: the tools, the CI/CD and the repository in one
place. This HIP proposes that it stop being a place code *lives* and become the
place code is *reached from*. A repository stays on whichever host its owner
already uses — GitHub, GitLab, a Gitea, or any git endpoint we hold credentials
for — and Forge connects to it, caches what it needs to run a build, indexes it
for search, and synchronises issues, boards and projects in both directions. A
durable copy of the objects is kept only when someone pays for one.

The name follows the shape: the current service hosts repositories (HIP-1232);
the proposed service federates hosts. `/v1/code` (HIP-1114) is the search surface
this makes cross-platform, and the GitOps plane (HIP-1122) is what runs against
a repository Forge does not own.

## Motivation

Two observations, one economic and one operational.

**Nobody wants a fourth place to put their code.** A team that uses GitHub uses
GitHub. Asking them to migrate, or to accept a mirror as the real copy, is the
cost of adoption and it is a cost we do not need to charge. What a team does
want is one place that can see across the hosts they already use: search that
answers over all of them at once, CI/CD that runs regardless of which one the
repository sits on, and an issue tracker that does not force a choice.

**Holding copies is the expensive part, and it is the part that breaks.**
Measured on the running forge, 2026-09-08:

| Fact | Value |
|---|---|
| Repositories held | 385 |
| Object storage on disk | 26.3 GB (`/data/git`) |
| Mirror set the reconciler targets | ~1,400 repositories |
| Postgres crash-recovery before it accepted connections | ~11 minutes (fsync of the data directory) |

During that recovery the forge answered `424 Failed Dependency` on `/v1/healthz`,
never became Ready, and the edge returned `503 no available server`. The
repository *data* was never at risk — but availability was, and the recovery time
is a function of how much we hold. Every repository we copy adds storage, adds
recovery time, and adds a second copy that can disagree with the first.

The mirror set exists so that CI can build from it and search can index it.
Neither requires a durable copy. A build requires the objects at one commit for
the duration of the build; an index requires content, not custody.

## Current behavior

Stated as fact, from the implementation:

- `apps/git` serves `/v1/git`: bare repositories on disk, smart-HTTP and SSH,
  imports, pull-mirrors and browse pages (HIP-1232). The copy is authoritative
  for anything native, and a mirror otherwise.
- `hanzoai/mirrors` reconciles every qualifying GitHub repository into a
  pull-mirror on the forge, on a six-hour schedule.
- `/v1/code` (HIP-1114) searches an org's repositories with hybrid retrieval —
  lexical, symbolic and semantic, fused by reciprocal rank. Its corpus is the
  repositories the forge holds.
- Push-to-deploy has no inbound webhook: a push into the embedded server fires
  the builder in-process, and a GitHub-homed repository's events arrive through
  the Hanzo Platform GitHub App.

So the corpus of both CI and search is exactly "what we copied". This HIP changes
what defines the corpus, not how either engine works.

## Specification

### 1. A connected host is the unit

A **connection** binds an external host to an org: a kind (`github`, `gitlab`,
`gitea`, `git`), an endpoint, and a credential held in KMS. `github`, `gitlab`
and `gitea` connections use the host's own app/integration so that repository-
and org-level configuration can be read and written, not merely cloned. The
`git` kind is the fallback: any endpoint reachable with a credential, tracked and
cached, with no platform features beyond the objects themselves.

A **tracked repository** is a repository on a connection that this org has asked
Forge to watch. Tracking grants Forge the right to fetch, cache, index and build
it. Tracking does not create a copy anyone else can push to, and does not make
Forge the source of truth for it.

### 2. Cache, not copy — and the paid boundary

Forge keeps a **cache**: git objects fetched to satisfy a build, an index pass or
a browse, retained under an eviction policy and reconstructible at any time from
the connection. A cache entry may be dropped without loss.

Forge keeps a **durable copy** only when an org explicitly asks for one and pays
for it. A durable copy is what today's mirrors are: retained, backed up, and
counted against storage. It is the exception, declared per repository.

The free path is therefore proxy and cache; the paid path is custody. This is the
inversion the rest of the design follows from, and it is what keeps recovery time
bounded by working set rather than by history.

### 3. CI/CD against a repository we do not own

A build takes a connection, a repository and a commit, fetches the objects it
needs into the cache, and runs. The existing GitOps plane (HIP-1122) is unchanged
— what changes is that its input may be a repository on any connected host.

Events arrive through the connection's own integration: the GitHub App for
`github`, the equivalent app for `gitlab` and `gitea`, and polling for a bare
`git` connection that has no event channel. Forge does not ask a host to deliver
to it by a mechanism the host does not already offer.

### 4. Issues, boards and projects, both directions

For connections whose host has an issue model, Forge synchronises issues, boards
and projects bidirectionally, so a team can work in Forge or in their own host
without either becoming a stale mirror of the other. The synchroniser is
idempotent per item and carries an origin marker so an echo of its own write is
not re-applied. Where two sides edit the same field between passes, the rule is
last-writer-wins per field with the conflict recorded, not silently dropped.

This is the half that makes "use your favourite host" true rather than
aspirational: without it, adopting Forge still costs a team its tracker.

### 5. Federated search

Search answers over three corpora at once:

1. **Tracked content** — indexed by the existing `/v1/code` tiers (HIP-1114).
2. **Live host search** — the connected hosts' own search APIs, queried in real
   time and fused with the local result, so a repository that is connected but
   not yet indexed is still answerable.
3. **Public OSS** — a public index across the three platforms and the package
   registries whose source they publish, so a search can reach code the org does
   not own at all.

Fusion is reciprocal-rank, as `/v1/code` already does across its tiers; a live
host result is one more ranked list, not a special case. A host that is slow or
down degrades the result set, never the request.

### 6. Surface

Forge answers under `/v1/forge`, one capability, one prefix (HIP-0139).
`/v1/code` remains the search surface and gains the federated corpus. `/v1/git`
remains what it is for repositories Forge does host — the paid, durable case, and
our own.

## Assumptions

- Every host we federate offers an API sufficient to read repository and org
  configuration and to write issues. Verified for GitHub; **not yet verified for
  GitLab or Gitea** — that check is the first implementation task.
- A cache miss is acceptable latency for a build. Not measured; the working
  assumption is that a shallow fetch at a known commit is fast enough, and it
  must be measured before the mirror set is retired.
- Public OSS indexing is subject to each platform's terms and rate limits. The
  scope and legality of a public cross-platform index is an open question, not a
  settled one.

## Implementation

Ordered so each step is useful alone:

1. Connections and credentials: the model, KMS storage, and the `github` kind
   against the existing Hanzo Platform GitHub App.
2. Tracking and the cache, with builds reading from the cache instead of a
   mirror. At this point the mirror set is redundant for CI.
3. `gitlab` and `gitea` connections, after their APIs are verified.
4. Federated search: live host search fused into `/v1/code`.
5. Issue, board and project synchronisation.
6. The paid durable-copy declaration, and retiring mirrors that nobody declared.

Step 2 is the one that changes the operational picture; steps 3–5 are what make
the product the user-facing claim.

## Limitations

- Forge stops being able to answer for a repository when the connection's
  credential is revoked or the host is unreachable. A durable copy is the only
  thing that survives that, which is precisely what the paid tier sells.
- Bidirectional synchronisation cannot make two models identical. Fields one host
  has and another does not are carried as metadata or dropped; the mapping is
  per-host and lossy by construction.
- A cross-platform public index is bounded by rate limits and terms, so "all
  public OSS" is a direction, not a guarantee.
- This HIP does not specify the eviction policy, the conflict-record format, or
  the pricing of custody. Each needs its own decision.

## Next step

Verify the GitLab and Gitea APIs against assumption one, then implement steps 1
and 2. Until a build demonstrably runs from cache at a commit on a connected host
that Forge holds no copy of, the rest of this document is a proposal.
