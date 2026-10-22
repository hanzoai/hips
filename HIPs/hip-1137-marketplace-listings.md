---
hip: 1137
title: Marketplace — Listings and Installs
author: Hanzo AI
type: Standards Track
category: Interface
capability: marketplace
status: Final
implementation-go: partial
created: 2026-08-20
updated: 2026-10-22
requires: HIP-0026, HIP-0106, HIP-0139
---

# HIP-1137: Marketplace — Listings and Installs

## Abstract

`/v1/marketplace` is the shop for tools and agents: browse, install into your
project, publish your own free or priced. It is a thin layer over the unified
tool plane — discovery reads the tool registry, install and uninstall ARE the
registry's activation writes — plus a listing store that says what a tool costs
and which wallet is paid. Marketplace never dispatches a tool and never moves
money itself. It is implemented in `hanzoai/cloud` at `apps/marketplace`
(HIP-0106).

A listing is discoverable outside its publisher org once a SuperAdmin approves
it. That rule is proposed by the Amendment below and is not served yet.

## Amendment: a public listing is reviewed (proposed)

Proposed with HIP-0528. Nothing in this section is served today; §1–§5 describe
what is. The column, the operator route, the filter in discovery and the audit
records below are all still to be built.

- **The state.** Every listing carries `review` — `submitted`, `approved` or
  `refused` — and a `reason`, which a refusal requires. Publish writes
  `submitted`. A republish that changes what an install would activate — the
  tool it names, the price, the payee, and for a mod listing (HIP-0528) the
  pinned bundle digest or the permission set — writes `submitted` again. Rows
  that exist when this lands enter `submitted`.
- **Who decides.** Only a SuperAdmin — `owner == "admin"`, the one predicate
  (HIP-0118, HIP-0026) — sets `approved` or `refused`, at
  `PUT /v1/admin/marketplace/listings/{org}/{id}/review` with `{state, reason}`:
  the operator's view of this capability (HIP-0139 §3.2), drawn in the admin
  console (HIP-1320). The queue is
  `GET /v1/admin/marketplace/listings?review=submitted`. An org admin's
  `isAdmin` admits nothing here, in any org, its own included.
- **The record.** Each decision is written to the tamper-evident trail
  (HIP-1103) before the row changes: the SuperAdmin, the listing key, the state
  it left and the one it entered, the reason, and for a mod the digest decided
  on. A decision that cannot be recorded changes nothing.
- **What it changes.** Discovery answers another org with approved listings
  only, and installing a listing that is not approved answers as if it did not
  exist, so the state is not an oracle. The publisher org's own-listings
  operation returns every listing it published with its state and reason, and
  the publisher MAY install its own listing in any state into its own projects.
  An install that already happened is an activation (§1), and a later refusal
  does not undo it; withdrawing installed code is HIP-0528's block.
- **A reviewer's verdict is evidence.** A verdict from HIP-0528's review (§7)
  attaches to the submission and is shown beside it. It never sets the state: a
  pass approves nothing, and approving over a refusal takes a reason, recorded
  as above.

## Motivation

A marketplace that keeps its own installed-tools table drifts from the registry
that actually dispatches, and a price that lives only in one process's memory
is not enforced anywhere else. Both defects were real here: the price table,
the charger and the wallet resolver were process-globals, the fleet runs one
process per app, so in the settling process the table was nil — and reading a
nil table as "nothing is priced" made every listed tool free the moment the
fleet split (`apps/marketplace/marketplace.go:16-30`).

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted
as in RFC 2119.

### §1 One store, and what is deliberately not in it

The listing store is one encrypted SQLite file, the deployment's own
`marketplace` (`apps/marketplace/store.go:51`), keyed by (publisher_org, id) —
a publisher only ever mutates its own listings. Installs are NOT in it:
install and uninstall are the tool registry's activation writes for the
caller's (org, project), so there is one store and one truth for what is
active (`apps/marketplace/marketplace.go:8-15`).

### §2 The address

Six operations under `/v1/marketplace`, all typed: discovery (catalog plus
listing overlay plus installed flag), the caller org's own listings, publish,
unpublish, install, uninstall. A published listing must name a tool that
already resolves in the publisher's own scope, so a listing can never
advertise a capability that does not exist; a priced listing must name the
payout wallet, so a monetized offer is never unpayable; the price is exact to
18 decimal places, so a per-call price below a cent is a real price and not a
rounded-away zero.

### §3 Money: the table here, the rail elsewhere

Marketplace itself is free (`cloud.Free`, `plugin/marketplace/main.go`). A
monetized listing is enforced per call by the x402 rail, and the enforcement is
four internal-plane operations, each served by the process that owns the
answer: tools asks x402 to settle; x402 asks marketplace what it costs and who
is paid; x402 asks wallets to resolve the payee; x402 asks commerce to credit
it (`apps/marketplace/marketplace.go:32-39`). The in-process seam stays the
fast path where an owner is co-resident; both paths are the same policy and
both fail closed, asserted against each other by a one-process test and a
five-process test (`apps/marketplace/marketplace.go:41-44`).

On the plane, the price answer carries the row's recipient, never a request's:
a buyer that could state either would buy at its own price or redirect the
credit. `priced=false` means FREE and is an ANSWER — an unlisted tool lands
there — while a store failure is an ERROR, because "I could not look it up"
must never read as "it costs nothing" (`apps/marketplace/rpc.go:22-33,47-50`).
The price op reads no tenant and requires none: a price is the shop window,
the same figure for everyone.

### §4 Tenancy

Every REST operation is org-gated on the validated principal (HIP-0026),
parked by the bridge the composer installs once at the root. The payee is
structurally the publisher's: PublisherOrg is the payee org, and the wallet id
resolves only within the org that is asked for, which makes a cross-org credit
unconstructible rather than merely unlikely
(`apps/marketplace/store.go:25-31`).

### §5 Events, observability, stage, upstream

It publishes nothing on the bus and emits nothing beyond the request span
every route gets. The stage is `beta` (`manifest/apps.go:430`, `Stage: Beta`):
reached by flag until promoted (HIP-0139 §8). It derives from no upstream.

## Rationale

The alternative to "install is activation" is a marketplace-owned installs
table, which is a second copy of the registry's fact — the defect the plugin
contract names — and it would disagree first exactly where it matters, on
whether a priced tool is active. The alternative to asking the owning process
for the price was replicating the table into the rail's process, a cache that
turns every price change into a coherence problem on the money path.

## Security Considerations

The money path is the exposure, and its two failure shapes are opposite. Fail
open: a missing price table read as "free" dispensed paid tools for nothing —
closed by making absence an error and free an explicit answer. Redirection: a
caller-influenced recipient or price turns the rail into a payout to the
attacker — closed by binding both to the listing row, publisher-owned and
publisher-org-payable only. The listing store's own writes are bounded by the
(publisher_org, id) key, so a tenant can unpublish only what it published.

## References

- HIP-0026 — Identity and Access Management
- HIP-0106 — Hanzo Plugin Contract
- HIP-0118 — SuperAdmin & Tenant Isolation Model
- HIP-0139 — Capability
- HIP-0528 — Mods — The App SDK
- HIP-1103 — Audit — The Tamper-Evident Trail
- HIP-1320 — Admin — The Operator Console

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
