---
hip: 1164
title: Provisioning — Stores on Demand
author: Hanzo AI
type: Standards Track
category: Core
capability: provisioning
status: Draft
created: 2026-08-20
requires: HIP-0026, HIP-0106, HIP-0139, HIP-0401, HIP-1134
---

# HIP-1164: Provisioning — Stores on Demand

## Abstract

`/v1/instances` is one-click data add-ons: a SQL, key-value, document, vector,
search or object store, wired straight into your app. It is a control plane and
only that — it allocates the resource, records one row about it, and hands back
the one credential that reaches it. It never reads or writes a byte of what the
resource then holds. It is implemented in `hanzoai/cloud` at `apps/provisioning`
(HIP-0106).

## Motivation

Seven engines, asked for the same four ways. Without one address for the asking,
each engine grows its own allocation surface, its own name-to-tenant derivation
and its own idea of what a credential is scoped to — and the seventh copy of
"derive a physical name from an org" is the one that folds two tenants onto one
resource. The allocation is the part that must be identical across engines; what
you do with the resource afterwards is the part that cannot be.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted
as in RFC 2119.

### §1 The store

One store: an encrypted SQLite named `provisioning`, opened through the one
opener so it is born encrypted, single-connection so every write is atomic
against the file lock (`apps/provisioning/store.go:73`). One table,
`provisioned_resources` — one row per logical resource, carrying the org, the
kind, the friendly name, the derived physical name, the endpoint, the declared
size, the app instance it is bound to, and `secret_ref`. It NEVER carries a
password. Two unique indexes do the work: `(org, kind, name)`, and
`physical_name` globally across orgs — the second is the authoritative guard
that two logical resources can never map onto one backend resource
(`store.go:105-114`).

### §2 The address, and the seven kinds

`/v1/instances/{kind}` for seven kinds — `kv`, `sql`, `docdb`, `datastore`,
`s3`, `search`, `vector` — each answering the same four operations: list,
create, describe, drop. The kind is a path segment because it is a value from a
closed set, not a capability: `/v1/kv`, `/v1/sql`, `/v1/docdb` and `/v1/datastore`
carry no operation, and an engine MUST NOT take a top-level prefix for its
allocation surface. Allocation is one act with one store, so it has one address.

The reads and the drops are typed ops, spelled one constant route per kind
rather than registered from a loop: a computed path has no identity for
`zipdoc` to file prose under, so a looped registration can carry no doc comment
and reaches none of the projections (`apps/provisioning/typed.go`).

The seven creates are declared and untyped, and the reason is a wire fact.
A create runs the pre-provision balance gate, whose refusal `cloud.DenyResource`
renders as the money wire's nested `{"error":{"code","message"}}` at 402 or 503.
A typed op's only refusal channel is a returned error, which zip renders as its
flat `HTTPError` shape — the same denial in a different body for every metered
client that reads `error.code` across the fleet. Writing the nested body from
inside the op does not escape it either: a nil `Out` makes zip stamp its own
status over the 402. Moving the gate into middleware does not rescue it, because
middleware runs before the body decode and would turn a malformed name from 400
into 402. So the creates keep their closure and DECLARE their request and
response bodies through `openapi.Register` instead — an undeclared create
publishes a method with nowhere to put the name, which is strictly worse than an
under-described one. `apps/provisioning/typed_wire_test.go` holds that as a
closed list, so an eighth untyped route here goes red.

The pair `/v1/instances provisioning` is carried by cloud's
`openapi/misfiled.txt` and closes by fold (HIP-0139 §7.1), never by alias: this
capability has one store and one act, however many kinds it names, and §7.1 is
the default for exactly that shape. It does NOT close by rename: `instance`
names the resource, and a capability is the faculty (HIP-0139 §2.2).

### §3 Tenancy

A validated principal is required first, and the refusal is the point: without
it, the org is forgeable by anything that can reach the port, and what a forged
org buys here is not a read — it is the victim's connection string and password,
the ability to destroy the victim's store, and an enumeration of what they hold
(`apps/provisioning/provisioning.go:531`). With the principal established, the
tenant is the org the edge minted from the validated bearer owner claim
(HIP-0026), folded to a DNS slug. An empty org is refused unless the caller is a
SuperAdmin, and that fallback reaches the literal `admin` org's own physical
namespace and no real tenant's.

Isolation is then by construction, two ways, one per strategy:

- **Dedicated instance** — `kv`, `sql`, `docdb`, `datastore`. The org gets its
  OWN instance: a Datastore CR (HIP-0401) in the org's own `tenant-<org>`
  namespace, which the operator reconciles. Its admin credential is naturally
  tenant-scoped because the org owns the whole instance. The assembled DSN is
  injected as `<KIND>_URL` into the addons Secret of the app instance named in
  the create, so that instance switches onto the backend.
- **Shared logical** — `s3`, `search`, `vector`. The resource is a logical one
  inside an already-live shared backend, named `o<orgHash>_<name>` where the org
  hash is FIXED WIDTH. The fixed width is the whole guard: it makes the
  org-to-name boundary unambiguous, so `(org, name)` is injective up to a
  64-bit collision and no two tenants fold onto one resource. The global
  `UNIQUE(physical_name)` index makes any residual fold fail closed with 409.

The friendly name is validated at the door against
`^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$`; every physical name and every backend
identifier derives from it, so that regex is the injection guard.

A kind whose backend cannot grant a per-tenant-safe credential MUST be refused
with an honest 503 rather than granted a cross-tenant one
(`unavailableKinds`, empty today because the four that could not be scoped on a
shared backend moved to the dedicated strategy). A kind is never both refused
and dedicated.

### §4 Money

Metered. A create is gated BEFORE anything is created: the fee is
`cloud.ResourceFeeCents("CLOUD_PROVISION_FEE_CENTS", kind)` — a per-kind
operator knob over a global one over `cloud.DefaultResourceFeeCents` — and an
unfunded org gets 402, an unreachable ledger 503 in the fail-closed posture,
with nothing provisioned either way. The debit lands after success through the
one shared `cloud.ResourceMeter`, labelled with the kind. A fee of 0 makes a
kind free and therefore un-gated. Reads and drops are free.

A dedicated instance also carries a recurring footprint charge: one GB-day tick
per `dedicatedMeterInterval`, priced from the row's declared size at
`CLOUD_STORAGE_PRICE_CENTS_PER_GB_MONTH` (defaulting to the value in
`hanzoai/pricing`), rounded up so a footprint is never undercharged and floored
at one cent so a running instance is always billed. It is the SAME meter — there
is no second metering path — and it runs only where billing actually enforces.

### §5 Events

It publishes nothing on the bus; a customer's webhooks receive no
`provisioning.*` events.

### §6 Observability

Beyond the request span every route gets, structured log lines only: the mount
line naming the configured strategies and whether billing enforces, and the
degrade warning when secret custody is unavailable. It emits no metric of its
own. The seal of a generated credential is recorded by the custody plane
(HIP-1134), not here.

### §7 Stage

`ga`. The manifest row declares no stage, and absent is `ga` (HIP-0139 §8).

### §8 Upstream

It derives from no upstream code: it forks nothing, embeds no engine and mirrors
no project. It persists through `github.com/hanzoai/sqlite` and
`github.com/hanzoai/cek`, seals through the custody client, and reaches each
backend over that backend's own protocol — an index create, a collection put, a
bucket make, or a CR the operator reconciles. The engines themselves are
specified where they are deployed; nothing of them is linked into this app.

### §9 The boundary: allocate, then operate

This capability allocates and destroys. It never reads or writes a row, a
document, an object or a vector. Where the resource is then reached splits
three ways, and each side is somebody else's:

- `s3` — the customer data plane is `storage` at `/v1/s3` (HIP-1165). Both
  derive the physical bucket from the caller's org through the SAME exported
  derivation, so a bucket allocated here is browsable there. They MUST derive it
  identically or the tenant boundary drifts between allocate and operate, which
  is worse than either side being wrong alone.
- `search`, `vector` — a ranked answer over an org's own corpora is `search` at
  `POST /v1/search` (HIP-1147); the inventory of the two shared stores is
  `product` (HIP-1166). Neither is this capability's address.
- `kv`, `sql`, `docdb`, `datastore` — reached only over the engine's own wire
  protocol, at the host, port and credential the create returned. There is no
  HTTP data plane for them, and there MUST NOT be one under this capability: a
  proxy here would be a second door onto a store whose first door already
  authenticates, with a credential this app would then have to hold.

The credential is returned exactly once, in the create response, and nowhere
else. Every read beside it carries no password. A caller that does not keep it
re-provisions.

## Rationale

The alternative is an allocation surface per engine. Each would need the same
tenant derivation, the same balance gate and the same credential lifecycle, and
the seventh copy is where they stop agreeing — which is why the one property
that must hold across all seven, that a name maps to exactly one tenant, lives
in one function and one unique index rather than in seven implementations of an
intention.

The two strategies exist because a credential's scope is a property of the
backend, not of this control plane. A shared backend that cannot mint a
per-tenant credential can only be given a cross-tenant one, so the four kinds
that could not be scoped got their own instance instead of a shared grant. The
mechanism that refuses an unscopable kind stays even though nothing is refused
today, because the next kind is the one that needs it.

## Security Considerations

A wrong implementation gives an attacker three things, each closed here
structurally.

**Another tenant's store.** A folded name is a credential takeover, not a leak:
two orgs resolving to one physical resource share its password. The fixed-width
org hash makes the fold unspellable and the global `UNIQUE(physical_name)` makes
any residual one fail 409 rather than succeed quietly.

**A store in someone else's name.** Without the validated-principal check, a
caller inside the network could name an org and receive its connection string,
drop its data, or enumerate it. The check refuses exactly the anonymous path and
nothing else: every real caller arrives with a validated principal.

**A password at rest.** When custody is unavailable the create returns the
generated password once and persists only metadata, `secret_ref` empty. It
never writes a plaintext password anywhere durable, and a degraded custody plane
MUST NOT be resolved by writing one.

The tenant boundary is the naming derivation plus the validated principal, and
both are server-side with no caller input. The name regex is the injection
guard for every identifier downstream of it — a SQL identifier, a namespace, a
Secret name — so widening it is not a usability change.

The dedicated strategy places an org's instance in the org's own namespace,
which makes the k8s boundary carry the isolation rather than a credential
scope; the shared strategy has no such layer, so the physical naming and the
unique index are the whole boundary there and are written where no handler can
skip them.

The one-time credential return is a deliberate trade: it removes a durable
plaintext copy at the cost of a caller that must keep what it asked for.

## References

- HIP-0026 — Identity and Access Management
- HIP-0106 — Hanzo Plugin Contract
- HIP-0139 — Capability
- HIP-0401 — Datastore CRD
- HIP-1134 — KMS — Secret Custody
- HIP-1147 — Search — Hybrid Retrieval
- HIP-1165 — Storage — Buckets and Objects
- HIP-1166 — Product — Search and Vector Inventory

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
