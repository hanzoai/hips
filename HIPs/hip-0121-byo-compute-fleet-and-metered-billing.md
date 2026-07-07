---
hip: 0121
title: BYO Compute Fleet & Metered Billing
author: Hanzo AI Team
type: Standards Track
category: Core
status: Draft
created: 2026-07-07
requires: HIP-0026, HIP-0027, HIP-0053, HIP-0106, HIP-0111, HIP-0112
---

# HIP-0121: BYO Compute Fleet & Metered Billing

## Abstract

This proposal defines the **unified compute fleet**: one per-org registry of
attached compute — managed Hanzo clusters, bring-your-own (BYO) Kubernetes
clusters, BYO GPU / bare-metal boxes, and bring-your-own-cloud (BYOC) accounts —
exposed through a single `/v1/clusters` surface, and a **three-tier metered
billing model** that charges each source by *how it connects*:

1. **1% of cloud spend** for compute the org runs on another cloud (BYOC:
   AWS / Azure / GCP / DigitalOcean / Nebius), pulled from that cloud's own cost
   API.
2. **$1/month per GPU or device** flat for BYO hardware not on any cloud (bare
   metal, a workstation, a desktop-linked box).
3. **Free / native** if the box is a mainnet validator of `hanzo.network`.

Anyone brings compute → sees it in their fleet → schedules work on it → is
billed fairly, on one invoice, through the canonical `commerce/metering` path —
no manual step. Tenant isolation is the **org boundary**, enforced end to end:
every credential and kubeconfig is sealed per-org in KMS (the MPC nodes see only
ciphertext), and every fleet call is scoped by the gateway-validated
`X-Org-Id` / `X-Project-Id`, never a client field.

The fleet is the `hanzoai/cloud` `clients/fleet` registry consumed by
`clients/visor` (the `/v1/clusters` surface) and `clients/ml` (workload
federation), per HIP-0106. **Visor** (HIP-0053) is the machine/cluster control
plane. This HIP is the fleet + billing contract that sits on top of both.

## Motivation

Hanzo's compute is no longer one pool. It is a DO GPU pool, a customer's EKS
cluster, a founder's GB10 workstation under a desk, an org's own AWS account, and
a validator box that already secures the chain. Today each of those is a
different code path, a different credential store, a different (or missing)
billing rule. That does not scale, and it does not compose.

The product requirement is one sentence: **anyone can bring compute, see it, use
it, schedule work on it, and get billed fairly for it** — whether "it" is a
managed cluster we provision, a kubeconfig they paste, a GPU box they plug in, or
their own cloud account. And for enterprises: run the entire Hanzo cloud on their
own metal, white-labeled, and pay a license.

Three forces make this a Core standard rather than a feature:

1. **One fleet, or N incompatible ones.** Managed clusters live in Visor. The
   BYO-kubeconfig registration built this cycle could have become a parallel
   `/v1/ml/clusters`. ML serving needs to place a workload on *whichever* cluster
   the org chose. Without one registry, every consumer re-invents attach,
   validate, seal, and list — and the two lists drift. There must be exactly one
   fleet primitive per org, with exactly one surface.

2. **Fair billing requires the source's *provenance*, not a flat rate.** A box on
   AWS already pays AWS; charging it a full instance price double-charges the
   customer. A bare-metal GPU costs the customer nothing per hour; a flat monthly
   fee is honest. A validator already earns chain economics and secures the
   network; taxing its spare cycles is hostile. The rate must be a *property of
   how the compute connects* — 1% / $1 / free — resolved once, at connect.

3. **Multi-tenant money safety is unforgiving.** The fleet is cross-tenant by
   construction (every org's compute in one control plane). A kubeconfig leak
   crosses a security boundary; a double-debit crosses a trust boundary. Both
   must be structurally impossible, not merely unlikely — per-org KMS sealing for
   the first, cluster-wide single-flight leases for the second.

## Specification

### The fleet: one surface, one primitive, N sources

A **fleet** is one org's set of compute **sources**. Each source has a `kind`,
is owned by exactly one org (narrowed by project), and is served through the ONE
`/v1/clusters` surface. There is never a second cluster surface.

| Source kind | How it attaches | Where it lives |
|---|---|---|
| **Managed cluster** | Hanzo provisions k8s (DOKS today; AWS/Azure/GCP via Visor provider backends) | Visor — merged into `GET /v1/clusters` |
| **BYO k8s cluster** | Org pastes a kubeconfig → `POST /v1/clusters` | `fleet.Registry` (KMS-sealed) |
| **BYO GPU / bare metal** | Box becomes a cluster via k3s + device plugins, OR a single box via `hanzo gpu connect` / desktop-link | `fleet.Registry` (cluster) / `FleetWorker` (box) |
| **Cloud account (BYOC)** | Org connects THEIR AWS/Azure/GCP/DO/Nebius credentials; Visor provisions + manages **in their account** | Visor `Provider` (per-owner, sealed) |

The first three are compute *targets* the fleet can schedule onto; the fourth is
a *provider* the fleet provisions against. All four are billed by the one model
in "Three-tier billing" below.

#### `/v1/clusters` API

Org-scoped; the org is the gateway-validated owner (`tenant(c)`), never a client
field. Reference: `cloud/clients/visor/byo.go`.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/v1/clusters` | The org+project fleet: managed clusters (from Visor) **merged** with BYO clusters (from the registry), one list |
| `POST` | `/v1/clusters` | Attach. A `kubeconfig` body ⇒ BYO attach (validate → seal → index). A provider+spec body ⇒ managed provisioning (Visor) — the sibling variant |
| `DELETE` | `/v1/clusters/:id` | Detach a BYO cluster (index + sealed kubeconfig + cached client) |

`POST /v1/clusters` body:

```json
{ "name": "spark-k8s", "kubeconfig": "<yaml>", "provider": "k3s", "default": true }
```

Attach is a fail-closed pipeline:

1. `tenant(c)` → org, or `403` (X-Org-Id required).
2. Validate `name` (lowercased) and `kubeconfig` non-empty.
3. If the registry is not KMS-backed → `503` (never store a kubeconfig in
   plaintext).
4. **Nominal management-fee gate** (`s.bill.Gate`) — the customer brings the
   compute; Hanzo meters the management plane. Fee =
   `ResourceFeeCents("CLOUD_COMPUTE_FEE_CENTS", "byo-cluster")`. Fail-closed on
   an unfunded org.
5. `s.fleet.Register(ctx, org, project, name, kubeconfig, provider, default)` —
   reach the cluster, seal the kubeconfig, index the metadata.
6. `s.bill.Meter(...)` — record the nominal fee against the paying org, then
   `201` with the cluster view.

#### The fleet Registry — KMS-sealed, per-org, one federation seam

Reference: `cloud/clients/fleet/fleet.go`. The registry is the single source of
truth consumed by **both** the `/v1/clusters` surface and ML serving. Its whole
state is in the org's KMS; a nil KMS makes it a graceful, fail-closed no-op
(`Enabled()` is false; `Register` errors, `List`/`DynForOrg` return empty).

```go
func (r *Registry) Register(ctx, org, project, name, kubeconfig, provider string, isDefault bool) (Cluster, error)
func (r *Registry) List(org, project string) ([]Cluster, error)
func (r *Registry) Deregister(org, project, name string) (bool, error)
func (r *Registry) DynForOrg(org, project string) dynamic.Interface   // the ONE federation seam
```

- **Validate by reaching.** `Register` builds a dynamic client from the
  kubeconfig, lists nodes, and reads `nvidia.com/gpu` + `amd.com/gpu` from each
  node's `status.allocatable`. An unreachable cluster or unusable kubeconfig is
  rejected before anything is stored. The metadata (`Cluster{Nodes, NvidiaGPU,
  AmdGPU, ...}`) is derived, never client-asserted.
- **Seal, never surface.** The kubeconfig bytes go to KMS under a per-org key;
  only non-secret metadata is indexed. The kubeconfig is never returned by any
  read path.
- **Idempotent** on `name` within the `(org, project)` shard (`upsert`).
- **Federate.** `DynForOrg` returns the org+project's default cluster's client
  (KMS-loaded, cached) or `nil` — in which case the caller falls back to the home
  in-cluster client. This is how `clients/ml` places a workload on the org's
  chosen cluster with zero branching.

KMS key layout (the one place the project segment is added or omitted):

```
scopeRef(org, project) = org                        # default project (legacy, byte-identical)
                       = org + "/" + project         # non-default project shard
index  ref:  <scopeRef>/fleet/clusters
config ref:  <scopeRef>/fleet/clusters/<name>/kubeconfig     # the sealed kubeconfig
```

The KMS client is `mpcseal` — an MPC/threshold store; the nodes hold only
ciphertext. It is opened once from `CLOUD_KMS_NODES` + `CLOUD_KMS_PASSPHRASE`
(the one bootstrap env shared with the rest of cloud); absent ⇒ disabled, never
plaintext.

#### Tenant + project scoping via the edge JWT

The org boundary is enforced by the edge, decode-once, per HIP-0110 / HIP-0112:

- The gateway **strips** any inbound `X-Org-Id` / `X-Project-Id`, then **mints**
  them from the validated JWT: the `owner` claim → `X-Org-Id`; the token's
  project scope → `X-Project-Id` (default `"default"`, minted only for a
  non-default project). These are ANDed authorization inputs, never identity
  authority on their own.
- Downstream, every service reads them via `principal.Project(c)` /
  `principal.IsDefaultProject` and the org via `tenant(c)`. `X-Org-Id` and
  `X-Project-Id` propagate over the ZAP interconnect to visor / cloud / ml.
- **Billing keys on the org**; the project is an isolation + attribution
  dimension (a distinct fleet shard, a distinct metering Actor), never a billing
  destination. So `z@hanzo.ai` bills only the `hanzo` org, and one project's
  fleet is a distinct shard within it.

### Three-tier billing

Connected compute is metered by HOW it connects — all through the ONE
`commerce/metering` path, so a customer sees one invoice however their compute is
attached. The tier is a property of the source, resolved at connect. Rates are
config-surfaced (the pricing service is the source of truth); the values below
are the canonical defaults.

#### Tier A — BYOC (on another cloud): 1% of cloud spend

The org runs compute on its own AWS / Azure / GCP / DO / Nebius account. Hanzo
reads that account's real spend and meters **1%**.

- **Cost pull** (`service/cloud_cost.go`, one `CloudCostReader` seam, one reader
  per cloud):

  | Cloud | Cost source | Read |
  |---|---|---|
  | AWS | Cost Explorer | `ce:GetCostAndUsage`, `UnblendedCost`, month-to-date (us-east-1) |
  | DigitalOcean | Customer balance | `GET /v2/customers/my/balance` → `month_to_date_usage` |
  | Azure | Cost Management | scope-level cost query |
  | GCP | BigQuery billing export | `SELECT SUM(cost) FROM <export> WHERE invoice.month = 'YYYYMM'` |

- **Idempotent 1%.** Every cloud reports **month-to-date** cents.
  `AdvanceCostCursor(owner, provider, month, currentMTDCents)` advances a
  per-`(owner, provider, month)` watermark and returns the *newly-billable
  increment*; the collector meters **1% of the increment**, so across a month it
  totals 1% of that month's spend, exactly once. Month rollover is implicit in
  the cursor PK. The daily unit is serialized cluster-wide by
  `ClaimBillingUnit("byoc:<owner>:<provider>:<YYYYMMDD>")`.
- **Honesty contract.** A reader with insufficient credentials returns
  `ErrCostUnavailable`; the collector **skips** that account — no fee — rather
  than inventing a figure. No spend → no fee. Requires cost-read scope on the
  stored creds (documented per cloud).

#### Tier B — BYO hardware (not on a cloud): $1/month per device

A bare-metal, GPU, or desktop-linked box that costs the customer nothing per
hour. `ConnectFleetWorker` (via `hanzo gpu connect` / desktop link) arms a
`FleetWorker{Kind: "byo-hardware", DeviceCount, GpuModel}` keyed by
`(Owner, Name)` with `Project` as the attribution dimension. The monthly meter
reads `GetConnectedFleetWorkers` (cross-tenant, org recovered per row) and debits
**100 cents × `DeviceCount`** per connected box, once per month, under
`ClaimBillingUnit("device:<owner>:<worker>:<YYYYMM>")`. `DisconnectFleetWorker`
stops the fee (the row is retained so the closing month still bills its last
device count).

#### Tier C — hanzo.network validator: free / native

If the connected box's validator address is in the `hanzo.network` mainnet
validator set, it is natively available to the cloud at **no fee** — it already
earns validator economics and secures the chain. `chain.ValidatorExemption(ctx,
address)` is the gate, and it never fabricates an on-chain fact:

| State | Result | Billing |
|---|---|---|
| Wired + address in set | `(true, "exempt")` | free |
| Wired + address not in set | `(false, "billed")` | billed as a device (Tier B) |
| Lookup unwired (`HANZO_VALIDATOR_INDEXER_URL` empty) | `(false, "pending-chain-wiring")` | billed, flagged |
| Wired + lookup errored | `(false, "lookup-error", err)` | billed (fail-safe), flagged |

The exemption is granted **only** on a positive, verified membership read
(indexer → read; the chain is authoritative and read-only). It activates
automatically the moment the operator wires the indexer; nothing is ever exempted
on an unverified claim.

#### Metering → invoice flow

```
attach / connect ──► tier resolved (property of the source)
        │
        ├─ BYO cluster attach ─► nominal mgmt-fee Gate + Meter        (WIRED, live)
        ├─ resell machine up   ─► hourly debit, MeterLease-guarded     (WIRED, live)
        ├─ BYOC account        ─► daily: 1% × cost increment           (primitives shipped; loop = roadmap)
        └─ BYO device          ─► monthly: $1 × DeviceCount − validators (primitives shipped; loop = roadmap)
        │
        ▼
commerce/metering  (one client per org: NewMeteringClient → metering.Record)
        │  RequestID = the billing-unit key; OTel mirror via telemetry.CountMetered
        ▼
commerce  ── per-org ledger ──►  ONE invoice
```

**Exactly-once is enforced outside the RequestID.** Commerce does not dedup the
withdraw on `requestId`, and visor runs `replicas: 2` with no leader election, so
every billable unit is guarded by an insert-once-wins lease:

- `MeterLease` (`ClaimMeterHour`, PK = `YYYYMMDDHH`) — the hourly resell-compute
  sweep. Lives on the shared linearizable engine (never per-org SQLite — two pods
  with separate files would each "win" and double-debit).
- `BillingLease` (`ClaimBillingUnit`, PK = the unit string) — the daily BYOC and
  monthly device units. A DB error yields "not claimed" ⇒ **fail safe = do not
  bill** (a missed unit is reconciled later; a double debit is not).

`PriceToCents` is the one price→cents rule (Ceil, with a 1e-9 epsilon so
`0.07 × 100` does not round to 8¢; a $0 price is free).

### Two surfaces over one dataset

| Surface | Audience | Scope | Backing |
|---|---|---|---|
| **console.hanzo.ai** | Any org (self-service) | Its OWN fleet, usage, schedules, billing | `/v1/clusters` + `/vm/v1/machines`, org-scoped |
| **admin.hanzo.ai** | SuperAdmin (`owner == "admin"`) | ALL orgs' fleets + usage + revenue, one board | `/v1/admin/*` cross-tenant aggregates |

Per the SuperAdmin standard: the unified all-org overview is gated on membership
of the reserved `admin` org (`owner == "admin"`), the only cross-tenant scope. A
brand-org admin (e.g. `z@hanzo.ai`, an org admin of `hanzo`) sees only the
`hanzo` fleet on console — never the cross-tenant board.

### Deployment modes — one binary, three shapes

The single cloud binary (HIP-0106) + white-label-by-hostname make one codebase
serve three product modes with no forks:

1. **SaaS (multi-tenant, Hanzo-hosted)** — the default; console per-org, admin
   unified, per-org billing.
2. **BYO-compute (hybrid)** — Hanzo's hosted control plane, the customer's
   compute (the fleet). Billed the nominal management fee + the three-tier model.
3. **Self-hosted / white-label (enterprise)** — the entire cloud binary in the
   enterprise's own cloud + K8s, white-labeled to their brand, via the
   GCP/AWS/Azure Marketplace or the operator/Helm. Billed by **license +
   entitlement metering**, not per-org SaaS billing.

Everything in this HIP stays mode-agnostic: never hardcode `hanzo.ai`, always
resolve brand + endpoints from config, never assume Hanzo's KMS/commerce is
reachable.

## Rationale

**Why one `/v1/clusters` for every org.** The fleet is inherently cross-tenant
(every org's compute in one control plane). One surface with one registry is the
only way ML serving, the console, and the admin board see the *same* list. A
parallel `/v1/ml/clusters` was built and deliberately deleted: the moment there
are two lists they drift, and `dynForOrg` cannot know which cluster the org
actually chose. One registry, two consumers (`clients/visor`, `clients/ml`),
never a second surface. This is the "one and only one way" rule applied to
compute.

**Why 1% / $1 / free.** Each rate matches what the compute actually costs the
customer, so the fee is never hostile:

- *1% of cloud spend* — the customer already pays the cloud in full; Hanzo adds a
  thin, usage-aligned management fee that scales to zero when they are idle. It is
  pulled from the cloud's own cost API, so it is auditable against the customer's
  own bill.
- *$1/mo per device* — bare metal has no per-hour cloud cost to take a percentage
  of, so a flat, trivially-predictable per-device fee is the honest unit. It
  arms on connect and stops on disconnect.
- *free for validators* — the box already earns validator economics and secures
  the chain; contributing spare cycles to the cloud is part of that contract.
  Charging it would be double-dipping.

One `commerce/metering` path renders all three as ledger lines, so a customer
with a validator, two GPU boxes, and an AWS account sees one invoice — not three
billing systems.

**Why KMS-sealed, per-org isolation.** A kubeconfig or a cloud credential is a
full grant of authority over the customer's infrastructure. The blast radius of a
leak is the customer's entire cluster or account. Sealing every secret in the
*org's own* KMS project (the MPC nodes see only ciphertext), keying it under a
per-org(+project) ref, and taking the org from the gateway-validated JWT — never
a client field — makes cross-tenant read structurally impossible: there is no
code path where org A's request resolves to org B's key. A disabled KMS fails the
whole feature closed rather than degrading to plaintext.

**Why watermark + lease instead of trusting request IDs.** Commerce does not
dedup withdrawals on `requestId`, and visor runs multiple replicas. Idempotency
therefore cannot live in the client key; it must be a cluster-wide,
insert-once-wins claim, with a DB error resolving to *do not bill*. Money safety
biases every failure toward under-billing (reconcilable) over double-billing
(a refund and a trust hit).

## Reference Implementation

Everything below is real code in `hanzoai/cloud` and `hanzoai/visor`. The fleet
surface and registry are **shipped and live** (`cloud` ≥ v1.786.90); the
three-tier billing **primitives are shipped, build, and pass tests**; the daily
and monthly billing **orchestrator loops are the remaining roadmap** — called out
explicitly below. No stubs are claimed as shipped.

### Shipped and live

- **`cloud/clients/fleet/fleet.go`** — the per-org KMS-sealed `Registry`
  (`Register` / `List` / `Deregister` / `DynForOrg`, `scopeRef` project sharding,
  kubeconfig sealed via `mpcseal`, GPU inventory via node list). Builds clean.
- **`cloud/clients/visor/byo.go`** — `attachCluster` (`POST /v1/clusters`),
  `detachCluster` (`DELETE /v1/clusters/:id`), `byoClusters` (the `GET` merge),
  with the nominal `CLOUD_COMPUTE_FEE_CENTS` Gate/Meter. Builds clean.
- **`cloud/resource_billing.go`** — `ResourceMeter.Gate` / `Meter` /
  `MeterUsage`, `ResourceFeeCents` (the wired nominal-fee path).
- **Live reference fleet** (k3s, built and proven this cycle):
  - **spark** — NVIDIA GB10 (Grace-Blackwell), arm64, k3s control-plane,
    `nvidia.com/gpu: 1`. Requires the **nvidia device-plugin ≥ v0.18.0**
    (earlier versions PANIC on the GB10's unified memory:
    `nvmlDeviceGetMemoryInfo "Not Supported"`; v0.18 logs and ignores it).
  - **evo** — AMD Ryzen AI MAX+ 395 / Radeon 8060S / gfx1151, x86_64, k3s agent,
    `amd.com/gpu: 1`, `rocm/k8s-device-plugin`.
  - **dbc** — CPU-only bare-metal arm64 worker.
  - **KServe v0.19.0** via helm OCI (`kserve-crd` + `kserve-resources`),
    `RawDeployment` mode (no Knative/Istio; warm serving).
- **Project-awareness** — the gateway mints `X-Project-Id`; `principal.Project` /
  `principal.IsDefaultProject`; every keyed surface (fleet ref, `ml-<org>` →
  `ml-<org>-<project>` namespaces, metering Actor) carries org+project. Live.
- **Visor multi-tenancy + BYOC** — Owner-keyed rows, IAM Bearer JWT bound by
  issuer, `hanzo-org:<org>` DO tags; per-owner cloud `Provider` connectors for
  DO / AWS / Azure / GCP / Hetzner / Lightsail (+ Nebius added this cycle); the
  hourly resell-compute meter (`MeterRunningMachines` + `MeterLease`) driven by
  the ticker.

### Shipped billing primitives (build + tests pass)

Verified: `go test ./object/... ./service/...` → `ok` (visor); `go build` clean
for `cloud/clients/{fleet,visor}` and `visor/chain`.

- **`service/cloud_cost.go`** + `service/cost_{aws,do,azure,gcp}.go` — the
  `CloudCostReader` seam and one real cost reader per cloud (Tier A input).
- **`object/cost_cursor.go`** — `CostCursor` + `AdvanceCostCursor` (the
  bill-the-increment watermark that makes 1% idempotent across a month).
- **`object/fleet_worker.go`** — `FleetWorker` model + `ConnectFleetWorker` /
  `DisconnectFleetWorker` / `GetConnectedFleetWorkers` (the Tier B / C registry).
- **`object/billing_lease.go`** — `BillingLease` + `ClaimBillingUnit` (daily
  `byoc:…` and monthly `device:…` exactly-once).
- **`object/meter_lease.go`** — `MeterLease` + `ClaimMeterHour` (hourly sweep
  exactly-once).
- **`service/metering.go`** — the one commerce path (`NewMeteringClient`,
  `PriceToCents`, `MeterRunningMachines`).
- **`chain/validator.go`** — `ValidatorExemption` (Tier C, fail-safe honesty
  contract).

### Roadmap (not yet wired — do not represent as shipped)

- **The daily BYOC 1% collector loop** and **the monthly $1/device meter loop.**
  Every primitive exists and tests pass, but no production ticker yet calls
  `AdvanceCostCursor` / `GetConnectedFleetWorkers` to emit the debits. The
  orchestrator is: enumerate active providers/workers → read cost / count devices
  → apply the rate → `metering.Record` under a `BillingLease`. The nominal
  per-attach management fee **is** wired; the usage-aligned tiers are not.
- **The `hanzo gpu connect` / desktop-link controller route** that calls
  `ConnectFleetWorker` — the model and lifecycle exist; the HTTP handler does not.
- **The validator indexer** (`HANZO_VALIDATOR_INDEXER_URL`) — unwired by default,
  so Tier C reports `pending-chain-wiring` until the operator provisions it.
- **ML `dynForOrg` federation wired into the serving handlers**
  (`create/list/get/del/predict`) — staged; returns the home client for non-BYO
  orgs, so it is a safe drop-in.
- **admin.hanzo.ai unified fleet + revenue board** — the cross-tenant aggregate
  pattern exists; the combined fleet+revenue overview is a gap to close.
- **Visor → cloud native persistence port** (Base per-org SQLite + HA per
  HIP-0302 / HIP-0107) — staged consolidation wave; visor Base mode is safe under
  `replicas: 1` today (the `MeterLease` leader election needs a shared
  linearizable store).

## Security Considerations

### Tenant isolation on the org boundary

The org is the isolation primitive, taken from the gateway-validated JWT `owner`
claim and propagated as `X-Org-Id`, never from a client field. Every fleet method
(`Register` / `List` / `Deregister` / `DynForOrg`) and every `/v1/clusters`
handler takes `(org, project)` as resolved by `tenant(c)` / `principal.Project`.
There is no code path where one org's request resolves another org's clusters:
`lux` sees only `lux`'s fleet, `zoo` only `zoo`'s, a customer only their own, and
within an org each project is a distinct shard.

### KMS-sealed credentials, no cross-tenant kubeconfig leak

- Kubeconfigs and BYOC cloud credentials are sealed in the org's own KMS project
  under a per-org(+project) ref; the `mpcseal` nodes hold only ciphertext.
- The kubeconfig is **write-only** from the API's perspective — no read path
  (list, get, view) ever returns it; only derived non-secret metadata (node
  count, GPU counts, endpoint) is surfaced.
- A missing/unreachable KMS **fails the feature closed** (`Enabled()` false;
  `Register` errors; attach returns `503`). Plaintext persistence is structurally
  impossible — there is no non-KMS store for the secret.
- Register **validates by reaching the cluster** before sealing, so a malformed
  or hostile kubeconfig is rejected up front; the derived inventory cannot be
  spoofed by the client.

### Billing integrity

- **No fabricated charges.** Cost readers return `ErrCostUnavailable` and are
  skipped when creds lack scope; the validator exemption is granted only on a
  positive, verified on-chain read. No spend and no verified fact is ever
  invented.
- **Exactly-once, fail-safe.** Every debit is guarded by an insert-once-wins
  lease (`MeterLease` / `BillingLease`); a DB error resolves to *not billing*.
  Under-billing is reconcilable; double-billing is not.
- **Spoof-proof attribution.** The billed org is recovered from the resource's
  own server-side tag / owner column (e.g. the `hanzo-org:<org>` DO tag injected
  at launch), never from a client parameter. Billing keys on the org; the project
  refines attribution without changing the debit destination.
- **Auth binding.** Callers present an IAM Bearer JWT bound to the brand by
  issuer (HIP-0111); a sibling brand's token is rejected, while every org within
  the brand is accepted — multi-tenant, not multi-trust.

### Cross-tenant control-plane exposure

The unified all-org fleet, usage, and revenue overview is gated on membership of
the reserved `admin` org (`owner == "admin"`) — the only cross-tenant scope, per
the SuperAdmin standard. Per-org admins are confined to their own org's console.
Trusting a per-org `isAdmin` for the platform board would be a privilege-
escalation bug; the predicate is `owner == "admin"`, checked the same way
everywhere.

## References

1. [HIP-0026: Identity & Access Management Standard](./hip-0026-identity-access-management-standard.md) — the org boundary, JWT `owner` claim
2. [HIP-0027: Secrets Management Standard](./hip-0027-secrets-management-standard.md) — KMS; per-org sealed credentials
3. [HIP-0053: Visor Monitoring & Supervision Standard](./hip-0053-visor-monitoring-standard.md) — the machine/cluster control plane
4. [HIP-0106: Unified Hanzo Cloud Binary](./hip-0106-unified-hanzo-cloud-binary.md) — `clients/fleet`, `clients/visor`, `clients/ml` in one binary
5. [HIP-0107: Streaming Replication over VFS](./hip-0107-streaming-replication-over-vfs.md) — the HA substrate for the visor→cloud persistence port
6. [HIP-0110: Gateway as Edge Process](./hip-0110-gateway-as-edge-process.md) — strip + mint `X-Org-Id` / `X-Project-Id`
7. [HIP-0111: IAM Authentication Standard](./hip-0111-iam-authentication-standard.md) — the Bearer JWT contract
8. [HIP-0112: Cloud Infrastructure Topology Standard](./hip-0112-cloud-infrastructure-topology-standard.md) — ingress → gateway → services, tenant scoping
9. [HIP-0302: Encrypted SQLite Replication Standard](./hip-0302-encrypted-sqlite-replication-standard.md) — per-org data isolation for visor's Base store
10. `cloud/clients/fleet/fleet.go`, `cloud/clients/visor/byo.go`, `cloud/resource_billing.go` — reference implementation
11. `visor/service/{cloud_cost,cost_aws,cost_do,cost_azure,cost_gcp,metering}.go`, `visor/object/{cost_cursor,fleet_worker,billing_lease,meter_lease}.go`, `visor/chain/validator.go` — billing primitives
12. `hanzoai/commerce/metering` — the canonical metering client and per-org ledger

## Copyright

Copyright and related rights waived via [CC0](https://creativecommons.org/publicdomain/zero/1.0/).
