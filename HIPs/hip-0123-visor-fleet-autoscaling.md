---
hip: 0123
title: Visor — Fleet & Fabric Autoscaling Across Any Provider
author: Hanzo AI Team
type: Standards Track
category: Infrastructure
status: Review
created: 2026-07-07
updated: 2026-07-08
requires: HIP-0037, HIP-0053, HIP-0116, HIP-0117, HIP-0121, HIP-0400
---

# HIP-0123: Visor — Fleet & Fabric Autoscaling Across Any Provider

## Abstract

**Visor** (`hanzoai/visor`, **v1.108.11** live in production via the
operator CR) is the fleet and fabric control plane: it provisions
machines and clusters on any supported provider, watches workloads
across the operated fabric, and **scales the nodes** — up on pending
demand, down on measured idle — with org/project attribution carried
in the same loop that reports billing. Where Kubernetes HPA scales
pods within the nodes a cluster already has, visor scales the *nodes
themselves*, across *clusters*, across *providers*, including
providers the **customer** brings (HIP-0121 BYOC).

The target model this HIP formalizes: every service, in its plugin-VM
shape (HIP-0116), is an independently schedulable unit; visor scales
**just the nodes running that service for that tenant** — per-service,
per-org, per-project — on whichever provider that tenant's fleet
lives. The realized autoscaler already keys its pools by exactly those
labels (`hanzo.ai/org`, `hanzo.ai/project`, `hanzo.ai/pool`); the
cross-provider per-tenant placement policy is the decided
formalization on top of shipped machinery.

## Motivation

An AI cloud's unit economics live and die on node count. Three forces
demand one control plane for it:

1. **The fabric is already plural.** The operated estate spans eight
   Kubernetes clusters across providers this cycle — DOKS estates
   (`do-sfo3-hanzo-k8s`, `do-sfo3-lux-k8s`, `do-sfo3-bootnode-k8s`,
   the zoo estate, and siblings) plus BYO k3s fleets such as the
   spark/evo/dbc reference cluster of HIP-0121. No single cluster's
   autoscaler can see, size, or bill that fabric as one thing.
2. **Tenancy must reach the node layer.** HIP-0121 gives every org a
   fleet; HIP-0116 makes every service independently packageable. If
   scaling stays cluster-global, one tenant's burst dilutes into
   shared pools — unattributable cost, no per-tenant ceiling, no way
   to scale *only* the service that is hot. The scaling unit must be
   `(service, org, project)`, not "the cluster".
3. **BYO provider is a product promise, not a special case.** A
   customer connects their own AWS/Azure/GCP/DO/Hetzner/Nebius account
   or bare metal (HIP-0121); the platform must provision and scale
   *there*, on their credentials, with the same loop it uses for
   managed estates. A second, customer-specific scaling path would be
   the classic two-ways defect.

Visor is where this already lives: it is the machine/cluster
provisioner and supervisor (HIP-0053, HIP-0490), it holds the
per-owner sealed provider connectors (HIP-0121), and it ships the
autoscaler. This HIP names that role and fixes its contract.

## Specification

### The realized machinery (shipped, in-tree)

All of the following is real code in `hanzoai/visor` at v1.108.x:

- **Pod-pressure watcher** — `autoscaler/watcher.go`. A `PodWatcher`
  is constructed over `[]ClusterConfig{ClusterID, ProviderName,
  Owner}` — plural clusters, provider-tagged, owner-attributed — and
  runs the control loop (30 s checks): a pod pending longer than 60 s
  triggers scale-up; nodes idling below 30 % CPU and 40 % memory for
  10 minutes trigger scale-down. Cooldowns (5 m up / 10 m down) and
  floor/ceiling (min 2 / max 50 nodes per pool) bound oscillation.
- **Tenant attribution in the loop** — pending pods are read with
  their `hanzo.ai/org` and `hanzo.ai/project` labels; node pools carry
  `hanzo.ai/pool`. The scale decision knows *whose* demand it is
  serving at the moment it makes the decision — attribution is not a
  reporting afterthought.
- **Best-fit sizing** — `autoscaler/sizing.go`. `SizeForResources`
  sums the pending pods' requests and picks the smallest node size
  that fits from an ordered catalog (DO slugs today: standard →
  general-purpose → CPU-optimized → memory-optimized), defaulting
  safe. Node count = max(ceil by CPU, ceil by memory). Existing pools
  of the right size grow; otherwise a new pool is created.
- **Provider backends** — `service/{digitalocean,doks,aws,azure,gcp,
  aliyun,hetzner,lightsail,kvm,pve,vmware}.go`: machine and cluster
  provisioning across managed clouds AND on-prem hypervisors (KVM,
  Proxmox, VMware), plus managed network/chain provisioning
  (`chain/chainmaker.go` — provider-hosted blockchain networks through
  the same connector discipline). Per-owner cloud credentials are
  KMS-sealed per HIP-0121.
- **Billing in the same plane** — `billing/reporter.go` batches
  `MeterEvent{MeterID, UserID, Value, Idempotency, Dimensions}` to the
  one commerce metering path; the hourly machine meter and its
  exactly-once leases are specified in HIP-0121. Scaling and metering
  reading the same objects is what makes per-tenant cost honest.
- **Org-scoped authorization** — `authz/`: fleet calls are org-bound
  per the IAM boundary (HIP-0111); the org is never a client field.

### The scaling unit — plugin VM × tenant

The unit visor scales is the **(service, org, project) pool**:

1. **Service** — a plugin VM per HIP-0116. Because every Hanzo service
   builds as an independently deployable unit with an identical mount
   contract, "scale the ML serving plane" never implies "scale the
   whole cloud binary". The fat SaaS build stays one deployment; any
   hot subsystem splits out (HIP-0106 hybrid mode) and gets its own
   pool.
2. **Org / project** — the tenant shard, from the same labels the
   watcher already reads. One tenant's burst grows one tenant's pool;
   ceilings and cooldowns apply per pool, so no tenant can starve the
   fabric.
3. **Provider** — a property of the pool's fleet source (HIP-0121):
   a managed estate, a BYO cluster, or the customer's own cloud
   account. **BYO provider scaling** means visor executes the same
   sizing/watch loop through the org's own sealed credentials — the
   nodes appear in *their* account, billed by *their* cloud, with
   Hanzo metering only the management plane (HIP-0121 Tier A).

The placement rule is deliberately boring: a pool belongs to exactly
one `(service, org, project, provider)` tuple; the watcher scales
pools, never anonymous global capacity. Cross-provider "fabric"
behavior falls out of plural `ClusterConfig`s rather than a scheduler
rewrite.

### Relationship to the deployment stack

| Concern | Owner |
|---|---|
| What a service IS (shapes, mount contract) | HIP-0116 |
| Where a deployment RUNS (serve / cluster init / helm) | HIP-0117 |
| What compute a tenant ATTACHED and what it COSTS | HIP-0121 |
| Day-2 reconciliation of service estates (CRs, GitOps) | HIP-0400 operator |
| **How many nodes exist, where, for whom** | **HIP-0123 (this)** |

Visor does not reconcile Deployments — that is the operator's job
(HIP-0400); it feeds the node layer those Deployments land on. It does
not define the fleet registry or billing tiers — that is HIP-0121; it
executes against them. It is not the monitoring standard — HIP-0053
covers probes/alerting; the autoscaler consumes those signals.

### Decided vs shipped

Honesty section. As of v1.108.11:

- **Shipped:** the multi-cluster `PodWatcher` (thresholds, cooldowns,
  bounds as specified), best-fit sizing + pool grow/create, org and
  project attribution labels in the scale path, the provider
  connector set (clouds + on-prem hypervisors), per-owner sealed
  credentials, the metering reporter, and the eight-cluster operated
  fabric. Visor runs in production (`do-sfo3-hanzo-k8s`, operator CR
  at tag v1.108.11).
- **Decided, staged:** the full **per-tenant per-service
  cross-provider placement policy** — i.e. pools uniformly keyed by
  the complete `(service, org, project, provider)` tuple across every
  provider backend, and scale-execution fanned out beyond DOKS
  node-pool APIs to every connector in the set. Today's watcher
  executes pool changes through the DOKS client
  (`DOKSClients map[clusterID]`) while reading demand fabric-wide;
  generalizing the execution seam to the other shipped connectors is
  mechanical, not architectural — the sizing, attribution, and
  provider primitives it composes are all in-tree.

## Rationale

**Why not "just use cluster-autoscaler / HPA".** Three mismatches.
(1) *Scope*: upstream autoscalers are per-cluster; the fabric is
eight-plus clusters on heterogeneous providers, including customer
accounts — the decision must sit above any one cluster. (2) *Tenancy*:
upstream scaling is workload-anonymous; Hanzo's unit of both isolation
and *billing* is the org (HIP-0121), so the scaler must know whose
pods it is buying nodes for — attribution inside the loop, not derived
later from logs. (3) *Provisioning*: scale-up on a BYO provider is a
*provisioning* act on sealed customer credentials, which is visor's
existing competency, not a k8s add-on's.

**Why the pool is the primitive.** A pool keyed by
`(service, org, project, provider)` is the smallest value that answers
every operational question at once — capacity (nodes in pool), blast
radius (one tenant's service), cost (metered per the same key), and
placement (the provider is part of the key, not runtime discovery).
One primitive, four concerns, zero braiding.

**Why visor and not the operator.** The operator (HIP-0400) is
declarative reconciliation of *what should run*; node supply is a
feedback controller over *live demand* with money attached. Different
cadence, different failure posture (a wrong reconcile is drift; a
wrong scale-up is spend). Keeping the feedback controller in visor —
which already owns machines, credentials, and metering — keeps each
plane complete and independently auditable.

**Why this is the resell story's load-bearing wall.** HIP-0117 gets a
customer's cloud running anywhere; HIP-0121 lets any org attach any
compute; this HIP is what makes the result *elastic* per tenant on
infrastructure Hanzo does not own. Composed, they are the OSS AI cloud
a reseller can operate: bring a provider, get a fabric that sizes
itself and bills honestly.

## References

- HIP-0037 — AI Cloud Platform Standard (the product the fleet serves)
- HIP-0053 — Visor Monitoring & Supervision Standard (probes/alerts
  the autoscaler consumes)
- HIP-0106 — Cloud — Unified Hanzo Binary (hybrid split mode; the
  "auto-scaling per-subsystem" non-goal this HIP picks up at the
  right layer)
- HIP-0116 — Hanzo Plugin & VM Model (the independently schedulable
  service unit)
- HIP-0117 — Cloud-in-a-Box (the topologies whose node supply this
  HIP manages)
- HIP-0121 — BYO Compute Fleet & Metered Billing (the fleet registry,
  sealed providers, and billing tiers this HIP executes against)
- HIP-0400 — Service CRD (workload reconciliation above this node
  plane)
- HIP-0490 — visor (service catalog entry)
- `hanzoai/visor` — `autoscaler/{watcher,sizing}.go`,
  `service/{digitalocean,doks,aws,azure,gcp,aliyun,hetzner,lightsail,kvm,pve,vmware}.go`,
  `billing/reporter.go`, `chain/chainmaker.go`, `authz/`
- `universe/infra/k8s/operator/crs/visor.yaml` — the live CR
  (tag v1.108.11)

## Copyright

Copyright and related rights waived via [CC0](https://creativecommons.org/publicdomain/zero/1.0/).
