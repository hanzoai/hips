---
hip: 1145
title: Research — The Experiment Record
author: Hanzo AI
type: Standards Track
category: Infrastructure
capability: research
status: Final
implementation-go: shipped
created: 2026-08-20
requires: HIP-0026, HIP-0106, HIP-0139, HIP-0512
---

# HIP-1145: Research — The Experiment Record

## Abstract

`/v1/research` is every experiment an org has ever run, kept and comparable:
versioned, append-only evidence under one discriminator — `kind` ∈ benchmark |
kernel-perf | training | ablation | policy-eval — with provenance (git sha,
branch, dirty, library versions) as queryable columns. It is implemented in
`hanzoai/cloud` at `apps/research`. A correction appends a new version under
the same stable id and the prior version is RETAINED, never mutated; faulted
and failed runs are retained too, because a negative result is evidence
(`apps/research/research.go:17-22`).

## Motivation

A measurement that cannot be re-found, re-attributed to its commit, or compared
against its own history is an anecdote. The record exists so the question
"which library version regressed this benchmark" is a query over the
longitudinal record rather than an archaeology project — and so dedup never
reads as loss: RETAINED is the full history, CANONICAL is the deterministic
deduped view over it.

## Specification

The key words MUST, MUST NOT and SHOULD are to be interpreted as in RFC 2119.

### Two planes, one owner

Each org's transactional SQLite — `cloud.OrgStore`, one physically separate
`research.db` per org (`apps/research/research.go:191-206`) — is the local
source of truth, riding whatever HA path the deployment configured. It rolls up
best-effort into `hanzoai/datastore`, the platform's column-oriented OLAP
plane, for the cross-project query surface: losing a roll-up MUST never fail an
ingest whose SQLite write already committed (`apps/research/datastore.go:11-16`).
The stronger "immutable · replicated · recovery-tested" claim is deliberately
NOT yet made — retry, reconciliation and backup/restore are still on the
critical path (`apps/research/research.go:12-15`).

### Addresses

Eight operations under `/v1/research`, seven typed and one declared
(`apps/research/research.go:225-240`): ingest (`POST /experiments`, idempotent
by content — re-running a backfill appends nothing), the canonical listing
(`GET /experiments`), `GET /projects`, `GET /totals`, the grant
(`POST /grants`), and the diary (`POST /artifacts`, `GET /artifacts`,
`GET /artifacts/{sha256}`). The last is the one route that cannot be a typed
op: it streams the artifact's raw bytes under the artifact's own Content-Type,
which a typed op — always JSON from a Go value — has no vocabulary for; its
prose is declared beside the route.

An artifact's identity is the SERVER-derived sha256 of its bytes, never a
client-asserted hash, so the address space is genuinely content-addressed and
un-poisonable; a re-POST of the same bytes is a no-op.

### Tenancy

The org is the validated principal's and selects the physical file
(`storeFor` → `cloud.OrgStore`); the project is the server's validated
sub-scope, stamped positionally into every row and every warehouse write — a
payload cannot forge either (`apps/research/datastore.go:31-32`). One org
cannot read another's evidence even in the presence of a query defect, because
the other org's rows are not in the file being queried.

### Consent is a separate grant

An upload records `visibility=private` and grants NO training or
commons-publication rights. Board visibility, `trainable` and `publishable` are
each a SEPARATE authorized decision through `POST /v1/research/grants` — never
implied by uploading a run (`apps/research/research.go:28-31`). Ingest MUST
ignore any visibility or consent field a payload carries.

### The BYO endpoint is stored, not dialed

An experiment may name the endpoint it was measured against. Ingest refuses the
obviously-hostile URL (https only, every resolved address publicly routable —
`apps/research/ssrf.go`), and that check is declared to be ingest hygiene, not
the dial-time control: nothing in this capability dials a recorded endpoint,
and code that ever does MUST carry a DialContext IP-pin first.

### Money, events, telemetry

Free, said in those words: `plugin/research/main.go` declares `cloud.Free`. It
publishes nothing to the bus, so a customer's webhooks receive nothing from it.
Beyond the request span, its only extra emission is the warehouse roll-up rows
themselves — its own data plane, not telemetry a customer reads back under
`/v1/o11y`.

### Stage

`beta`: the manifest row declares `Stage: Beta` (`manifest/apps.go:410`). The
durability contract is still rolling out — the roll-up is best-effort and
reconciliation is unbuilt, so the record is versioned-append-only today and no
more is claimed.

### Upstream

Derives from none. The OLAP half reuses the platform's own
`hanzoai/datastore` connection beside the account-usage warehouse; nothing
external is forked, embedded or mirrored.

## Rationale

Versioned-retained, rather than mutate-in-place with an audit log, is the load
bearing choice: an evidence plane that can silently replace a number is a
marketing plane (HIP-0512 makes the same argument for verdicts). Idempotency by
content rather than by a client key follows — a backfill has no stable client
key, and content identity makes replays free. Consent as a separate grant,
rather than a flag on upload, exists because the uploader of a run is routinely
a CI job with no authority to publish or license anything.

## Security Considerations

The record carries two things worth stealing and one thing worth forging.
Stealing: another org's benchmark evidence (closed physically, per-org files)
and an artifact's raw bytes, which may carry licensed or personal material —
the artifact read is org-scoped before the hash is looked up, so a known hash
alone retrieves nothing across tenants. Forging: consent. The wrong
implementation lets an upload set `trainable:true` or a client assert an
artifact's hash — the first turns a CI credential into a licensing authority,
the second poisons the content address so a later honest upload resolves to
attacker bytes. Ingest forcing private/withheld and the server deriving every
hash are the closures. The stored BYO endpoint is the residual SSRF surface,
held closed by nothing dialing it.

## References

- HIP-0026 — Identity and Access Management
- HIP-0106 — The Hanzo Plugin Contract
- HIP-0139 — Capability
- HIP-0512 — Experiment — The Evidence Plane

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
