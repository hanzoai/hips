---
hip: 0117
title: Cloud-in-a-Box — One Binary, Three Modes
author: Hanzo AI Team
type: Standards Track
category: Infrastructure
status: Draft
created: 2026-07-07
requires: HIP-0036, HIP-0037, HIP-0106, HIP-0116, HIP-0400
---

# HIP-0117: Cloud-in-a-Box — One Binary, Three Modes

## Abstract

This proposal defines the three deployment topologies of the ONE
`cloud` binary (HIP-0106) — from a laptop to an HA cluster without
changing the artifact:

1. **`cloud serve`** — single process, **no Kubernetes**: every
   subsystem in-process, per-tenant SQLite, datastore as a subprocess
   or gracefully absent. The true cloud-in-a-box for laptop, edge,
   and single-node installs.
2. **`cloud cluster init`** — the binary **fetches k3s** (it does NOT
   embed it), bootstraps a Kubernetes cluster, installs the operator,
   and hands reconciliation to `services.hanzo.ai` CRs (HIP-0400).
   Single command from bare metal to HA.
3. **`helm install`** — bring your own Kubernetes: the charts at
   `cloud/helm/cloud` deploy the same image into an existing cluster.

The mode is topology, not identity: same bits, same config surface,
same product behavior. What runs is decided by HIP-0116 (plugins /
enabled subsystems); *where* it runs is decided here — and nowhere
else.

## Motivation

An OSS AI cloud must install like a tool, not like a platform team.
The competition for the first five minutes is `docker run` and
`curl | sh`, not a 40-page Helm values reference. At the same time the
production shape is an operator-reconciled Kubernetes estate
(HIP-0400 CRs, HIP-0036 CI/CD). Historically these were different
software: a "dev mode" binary and a "real" set of manifests that
drifted apart.

HIP-0106 removed the reason for that split. The unified binary already
runs every subsystem in one process against SQLite; Kubernetes adds
scale-out and self-healing, not features. So the deployment story
collapses to one artifact with three entry points, and the only real
design question left is: **does the binary embed the orchestrator?**

The answer is no. Embedding k3s into `cloud` was considered and
**rejected**:

- **App ≠ orchestrator.** k3s is a cluster lifecycle concern with its
  own release cadence, CVE stream, and kernel-facing surface. Baking
  it into the app binary conflates two lifecycles that must upgrade
  independently.
- **Bloat.** The one-binary measured ~303.6 MiB (HIP-0106 realized
  state); a k3s payload roughly triples it for a code path most
  deployments never execute.
- **Precedent.** k3sup and Coder ship exactly this shape — a binary
  that *fetches and bootstraps* the orchestrator on demand — and it is
  the right separation: the app binary orchestrates the bootstrap; it
  is not the orchestrator.

## Specification

### Mode 1 — `cloud serve` (single process, no Kubernetes)

The binary IS the cloud:

- All enabled subsystems mount in-process per HIP-0106 (registry +
  fail-closed embeds). Disabled-by-default activation and 503
  blast-radius isolation apply unchanged.
- Storage is per-tenant SQLite (HIP-0029, HIP-0302) under
  `--data-dir`. No external database exists in this mode — SQLite is
  the default, not the fallback.
- **datastore** (ClickHouse-derived columnar store; the one non-Go
  exception per HIP-0106) runs as a locally supervised subprocess when
  present. When absent, analytics-dependent surfaces degrade
  fail-closed (503 on their prefixes) while everything else serves —
  the same isolation rule as any broken subsystem.
- The IAM single-replica guard (HIP-0106 realized state) is trivially
  satisfied: there is exactly one replica.
- Consensus/replication state per HIP-0116 runs in its single-node,
  in-memory shape: instant finality, zero configuration.

This mode is **shipped**: it is `cloud.Serve` — the same entry the
SaaS runs — pointed at local storage. Edge and laptop installs are not
a port; they are a smaller instance of production.

### Mode 2 — `cloud cluster init` (the binary bootstraps its own cluster)

For bare metal / VM fleets with no existing Kubernetes:

1. **Fetch k3s.** The binary downloads a **pinned k3s release** and
   verifies its checksum before executing anything. The pin lives in
   the cloud release, so `cloud` version N always bootstraps a known
   orchestrator version — reproducible clusters, no `latest`.
2. **Bootstrap.** Install/start k3s (server on the first node;
   `cluster join` adds agents), write the kubeconfig.
3. **Install the operator.** Apply `hanzoai/operator` and the
   `services.hanzo.ai` CRDs (HIP-0400 family).
4. **Reconcile.** Apply the deployment's CRs; the operator pulls
   `ghcr.io/hanzoai/<service>` images (built by HIP-0036 lanes),
   creates the datastore as a StatefulSet, and converges the estate.
   From here on, day-2 is GitOps against CRs — `cluster init` is a
   bootstrapper, not a parallel management plane.

HA and scale-out are properties of this mode: multiple nodes, replica
counts on CRs, and the durable Quasar/ZapDB substrate shape from
HIP-0116.

**Airgapped variant:** an optional **`cloud-fat`** build `go:embed`s
the pinned k3s binary for networks that cannot fetch. It is a separate
build target, never the default — the default binary never carries an
orchestrator. This is the ONLY sanctioned embedding of k3s.

**Status:** decided; staged behind the SaaS-first cutover. The
operator, CRDs, and images it composes all exist and run production
today (HIP-0400, HIP-0036); `cluster init` sequences them from the
binary.

### Mode 3 — `helm install` (bring your own Kubernetes)

For teams that already operate Kubernetes:

```bash
helm install cloud ./helm/cloud   # charts at hanzoai/cloud helm/cloud
```

The chart deploys the same `ghcr.io/hanzoai/cloud` image with the same
config surface (`--enable` / `CLOUD_*` per HIP-0106) and pins
`replicas=1` while the embedded IAM is enabled (the session
single-replica guard). BYO ingress-controller integration follows the
estate topology of HIP-0112. **Shipped:** the chart exists in-tree at
`cloud/helm/cloud`.

### Mode invariants

- **One artifact.** All three modes run the identical binary/image.
  A mode is a command-line entry point, never a fork or a build flag
  (the `cloud-fat` airgap variant differs only by the embedded k3s
  payload, not by application code).
- **One config surface.** Enabled subsystems, brand, domain, IAM
  issuer, and data dir mean the same thing in every mode.
- **Same product in every mode.** Per-product metering and
  balance-floor gating (HIP-0106 realized state; HIP-0018/HIP-0422)
  apply identically — a single-node install bills like the SaaS.
- **Graduation is data motion, not migration.** serve → cluster is:
  stand up the cluster, replicate the SQLite/ZapDB state (HIP-0107 /
  HIP-0302), repoint DNS. No schema rewrite, no "export".

## Rationale

**Why fetch-on-bootstrap instead of embedding k3s.** Separation of
concerns at the artifact level: the application's release cadence must
not be chained to the orchestrator's CVE cadence, and 95% of installs
(SaaS, BYO-k8s, single-node) never need the payload. Fetching a
pinned, checksum-verified release keeps bootstrap deterministic while
keeping the app an app. The airgapped `cloud-fat` variant proves the
rule by being the explicit, opt-in exception.

**Why three modes and not one.** Because the deployment spectrum is
real — laptop, edge box, reseller VM, production estate — but the
software spectrum should not be. Collapsing to one mode would either
force Kubernetes on a laptop or cap production at one process. Three
entry points over one artifact is the smallest surface that covers the
spectrum.

**Relation to the PaaS (HIP-0472).** platform.hanzo.ai is a *product
that runs on* the cloud — it deploys customer applications. This HIP
deploys the cloud itself. The two do not overlap: HIP-0472 assumes a
running estate; HIP-0117 is how that estate comes to exist.

## References

- HIP-0106 — Cloud — Unified Hanzo Binary (the artifact all three
  modes run; realized state documents `cloud.Serve`, the embeds, and
  the measured binary)
- HIP-0116 — Hanzo Plugin & VM Model (what runs: plugins/subsystems +
  the single-node vs HA state substrate)
- HIP-0400 — Service CRD (the operator/CR family `cluster init`
  installs and defers to)
- HIP-0036 — CI/CD Build System Standard (the lanes that build the
  images the operator pulls)
- HIP-0037 — AI Cloud Platform Standard (the product surface served in
  every mode)
- HIP-0112 — Cloud Infrastructure Topology Standard (the estate shape
  Mode 2/3 converge to)
- HIP-0107 / HIP-0302 — replication used for serve→cluster graduation
- HIP-0472 — paas (platform.hanzo.ai; runs ON the cloud, distinct
  concern)
- k3sup, Coder — prior art for fetch-on-bootstrap orchestrator
  installation
