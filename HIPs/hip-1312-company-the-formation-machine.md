---
hip: 1312
title: Company — The Formation Machine
author: Hanzo AI
type: Standards Track
category: Application
capability: company
status: Draft
created: 2026-08-20
requires: HIP-0026, HIP-0106, HIP-0139
---

# HIP-1312: Company — The Formation Machine

## Abstract

`/v1/company` brings a legal entity into existence and records who owns it:
choose a structure, add founders, clear identity, pay the formation fee,
generate documents, route signature, anchor the equity genesis. The
implementation is `hanzoai/cloud` `apps/company`.

The capability is a **guarded state machine** — a closed table of stages and the
edges between them (`apps/company/machine.go`) — plus provider seams that reach
the outside world (`apps/company/providers.go`). HIP-0903 argues why a firm
should run this way; this is the contract the surface answers to.

## Motivation

Formation is a sequence where every step depends on a fact an earlier one
established, and most of those facts are legal rather than technical: money must
not move before identity clears, and an entity must not be reported as formed
before it is.

Enumerating what a caller may do — a permission list — fails in the direction
that matters here. A list has gaps, and a gap is a company incorporated without
a verified person behind it. A closed edge table has none: the illegal move is
not forbidden, it is absent.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted
as in RFC 2119.

### §1 The machine

Two paths reach the terminal stage, every edge carrying a guard
(`apps/company/machine.go`): **incorporate** — `structure → founders → payment →
documents → esign → genesis → company`, guarded by structure chosen, identity
verified, fee paid, documents generated, signature complete, genesis recorded;
and **import** — `structure → import → company`, for an entity that already
exists and brings its own cap table and documents.

The table MUST stay closed: an edge that is not listed does not exist, so no
request shape, argument or ordering advances a formation past a guard. A new
step is a new edge with a new guard in the table, never a condition in a
handler.

### §2 The addresses

Twenty-one paths, every one under `/v1/company` (`manifest/apps.go:426`,
`plugin/company/openapi.json`): the machine's edges (`/structure`, `/founders`,
`/kyc`, `/kyc/decision`, `/kyc/refresh`, `/payment`, `/documents`, `/esign`,
`/esign/complete`, `/genesis`, `/advance`, `/skip`), the import pair, the
fundraise trio, the platform book (`/register`, `/register/summary`, `/review`)
and the `GET|POST /v1/company` root.

Twenty operations are typed. Two are declared with prose beside the route and
held to that count by a test (`apps/company/typed_wire_test.go`): the deck
upload takes a PDF as the raw request body, which has no value to name, and
`POST /payment` answers denial with the fleet's nested error body, which a typed
operation cannot emit. Both declare their bodies through `openapi.Register`, so
neither publishes an address nobody can explain.

### §3 The store, and the tenant

One SQLite file in the system namespace — `company` — holds each org's formation
as a single row keyed by the org, at most one formation per org
(`apps/company/store.go:22-28`). Documents, cap-table rows and signing material
are NOT here: they live with `dataroom`, `captable` and `kms` behind the
provider seams (`apps/company/providers.go`), and a formation row that also held
them would make this capability the second owner of three other stores.

The org is `principal.Org`, the validated IAM owner claim (HIP-0026), on every
read and write; a caller with no validated principal is refused.

Two surfaces are SuperAdmin's and cross-tenant by nature: the platform book
(`/register`, `/register/summary`, `/review`) and the identity decision
(`/kyc/decision`). Hanzo forms the entity, so Hanzo carries the formation
identity obligation, and discharging it is the platform's own act rather than a
predicate over the customer's. The two planes MUST stay orthogonal — the
SuperAdmin operation writes a fact, the machine's guard reads it, neither calls
the other — and a reviewer's confirmation MUST be recorded as its own distinct
value, never as a provider verification. "A human confirmed this" and "a
provider verified this" stay different facts to an auditor forever. Every
privileged decision carries the deciding reviewer.

### §4 The genesis anchor

The founding allocation — entity plus founders, ordered deterministically — is
hashed to a keccak root and committed to the Hanzo L1 (chain `36963`) by a
KMS-signed transaction (`apps/company/genesis.go`). The chain is the source of
truth, so a holder of the allocation recomputes the root without trusting this
platform. When the RPC or the signer is unconfigured, the root MUST be returned
with an honest `pending` status: a transaction hash is never fabricated and
formation is never blocked on an unreachable chain.

### §5 Price, events, emission, stage, upstream

The route surface is **free**, in those words: `Price: cloud.Free`
(`plugin/company/main.go:21`). The one charge is the one-time formation fee —
99900 cents (`formationFeeCents`, `apps/company/providers.go:146`; operator
override `CLOUD_COMPANY_FEE_CENTS`, `apps/company/company.go:290-297`) — taken
at `POST /v1/company/payment` through the charge seam onto the org's own ledger.
Insufficient balance is 402 and an unreachable balance is 503; neither advances
the stage, because the paid guard reads the receipt rather than the attempt
(`apps/company/machine.go:332-335`).

It publishes no events on the bus, so a customer's webhooks (HIP-1310) receive
nothing from it — provider completion arrives INBOUND at `/esign/complete` and
`/kyc/decision`, it is not emitted. It emits nothing to observability beyond the
request span every route gets.

The stage is `beta` (HIP-0139 §8): a vertical application rather than core, so
an org reaches it by the `company` flag. The manifest row does not yet carry a
stage field, so today the operations serve as `ga` does; this declaration is
what the row inherits when stage lands in `manifest.App`. It derives from no OSS upstream — the
identity and filing providers are hand-written clients behind the seams
(`apps/company/providers.go`, `apps/company/filing.go`).

## Rationale

The alternative to the closed edge table is scopes: enumerate what each caller
may invoke and check the enumeration in every handler. It costs one gap to be
wrong, the gaps are invisible until exploited, and each new stage multiplies the
checks that must agree. The table has one place to be right.

The alternative to the platform book is per-tenant records only, which cannot
answer what the obligation actually poses: how many formations await review, and
which have waited longest. That question is cross-tenant because the duty is.

## Security Considerations

The wrong implementation hands an attacker one of three things. Another org's
formation row is its founders' identity documents and personal data — the most
sensitive record this platform holds outside secrets. A decision operation
reachable by a non-SuperAdmin is laundered identity approval: a self-declared
founder who then clears the guard. And an edge table with one extra entry is a
company formed without payment or without a verified person behind it — a real
entity, in a real jurisdiction, traceable to us. The anchor adds a fourth: a
fabricated transaction hash is a false claim of public verifiability, worse than
no claim, because a reader who checks the chain and finds nothing has already
relied on it.

## References

- HIP-0026 — Identity and Access Management
- HIP-0106 — Hanzo Plugin Contract
- HIP-0139 — Capability
- HIP-0903 — The Agentic Company — Autonomous Firms on Hanzo
- HIP-1310 — Webhooks — Outbound Delivery

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
