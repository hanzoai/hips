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

Seventeen operations under `/v1/research`, sixteen typed and one declared
(`apps/research/research.go`). The measurement plane: ingest
(`POST /experiments`, idempotent by content — re-running a backfill appends
nothing), the canonical listing (`GET /experiments`), `GET /projects`,
`GET /totals`, the grant (`POST /grants`), and the diary (`POST /artifacts`,
`GET /artifacts`, `GET /artifacts/{sha256}`). The last is the one route that
cannot be a typed op: it streams the artifact's raw bytes under the artifact's
own Content-Type, which a typed op — always JSON from a Go value — has no
vocabulary for; its prose is declared beside the route.

The experiment record adds four kinds in one shape — a POST that records a
batch, a GET that lists it narrowed by the filters that matter, with `?id=`
selecting one so there is no second address for fetching one thing:
`/benchmarks`, `/runs`, `/studies`, `/papers` — plus `GET /compare`.

An artifact's identity is the SERVER-derived sha256 of its bytes, never a
client-asserted hash, so the address space is genuinely content-addressed and
un-poisonable; a re-POST of the same bytes is a no-op.

### The execution, and whether it finished

`Experiment` is one measured number and `Attempt` is one scored item; neither is
the EXECUTION. `Run` is (`apps/research/record.go`): the benchmark and split it
measured against, the system under test and its version, the configuration that
moves a number (embedder, reader, k, temperature, max-tokens, the prompt file and
its digest), the digests that pin its inputs (dataset, retrieval store, fact
layer), the commit it was frozen at, its per-(category, metric) measures with the
intervals the harness reported, when it ran, by whom — and `questions`,
`answered` and `ended`.

`completion` is DERIVED from those three and MUST NOT be accepted from a write:
`complete` where the record says the run covered its set and says when it ended,
`partial` where it says it covered less, `inconsistent` where the two counts
cannot both be true, `unknown` where the record does not say. A harness that
checkpoints as it goes reports whatever has been answered so far, so a run read
at question 57 of 282 is otherwise indistinguishable from a finished one — which
is how `locomo-all-context-k20-enso-flash` reached hanzo.ai/benchmarks 9.4 F1
points and 12.5 EM points above where it landed. Absence MUST stay absent:
`questions`, `answered`, `k`, `temperature` and `max_tokens` are nullable, and a
null is the record declining to answer rather than a zero.

`ResearchBenchmark` is the TASK — dataset, that dataset's licence and origin, the
splits it declares, the metric its authors score it by, the citation — and it is
independent of anyone's run. `Study` is the question a set of runs was run to
answer; `Paper` cites runs, and a run names at most its study, never a paper. A
baseline is a run carrying `baseline`, not a kind of its own and not a category
inside somebody else's numbers.

`GET /compare` reads two runs together and states FIRST what stops them being
compared — a different benchmark, a different split, different dataset digests,
either run not established as complete, either run not naming its system — then
every configuration field they disagree about, then the change over what BOTH
measured, with whether the reported intervals overlap. A metric only one of them
reported is left out rather than compared against nothing.

All four ride the same per-org SQLite through the same orm records, the same
content-hash version identity, the same server-assigned append clock and the same
private-by-default grant: a correction to a run APPENDS a version and the
published mistake stays retained. Runs also roll up to the warehouse with
`completion` as a column; their per-category measures do not, because a second
copy of the numbers with no reconciliation between them is worse than a join.

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

### Loading a measurement tree

`research.Load` reads a tree's OWN output — the harness's generated
`benchmarks.json` for the numbers and each run directory's `meta.json` and
`metrics.json` for what the run was — and recomputes no metric: a second
normalization would be a second answer to the same question, free to disagree
with the one the published tables came from. Where a field is absent it is
recorded absent and counted, never defaulted. Measured over `bench/brain` as it
stands: 56 runs and 2936 measures, of which 9 are complete, 3 are inconsistent
(their own `meta.json` records more answers than questions), and 44 are unknown;
no run records who ran it or the version of what it measured; 44 carry no
completion counts, 28 none of the reader knobs, 4 no commit.

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
