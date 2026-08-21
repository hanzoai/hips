---
hip: 1172
title: visor — Compute You Rent
author: Hanzo AI
type: Standards Track
category: Infrastructure
capability: visor
status: Draft
created: 2026-08-20
requires: HIP-0026, HIP-0106, HIP-0139
---

# HIP-1172: visor — Compute You Rent

## Abstract

visor is the compute you rent from Hanzo: machines, GPUs and clusters — launch
one, resize it, tear it down. It is the tenant's own view of that compute on the
public API, covering both what Hanzo provisions and what the customer attached,
and it fabricates nothing: a GPU row is a real machine's accelerator, a cluster
is real node pools, and a field the source does not carry is omitted rather than
invented. It is implemented in `hanzoai/cloud` at `apps/visor` (HIP-0106).

## Motivation

Renting a machine is the one operation where the price must be knowable before
the money moves, so every launch here carries a quote at the same address as the
launch. And a fleet is the one inventory a tenant needs answered in a single
question rather than four, so the board unions every source the org has — the
machines Hanzo runs for it, the boxes it dialled in, its clusters, its agent run
targets at `/v1/agents/targets` — under "what compute do I have, and how hot is
it?". Both are properties an addressed face can have and a scatter of provider
calls cannot.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted
as in RFC 2119.

### §1 It owns no store

Every row visor answers with is read from something that owns it, and visor
persists none of it.

Provisioned compute is the compute service's: machines, node pools, the DOKS
lifecycle. Attached compute is the per-org registry of bring-your-own clusters
(`apps/fleet`), whose kubeconfigs are sealed in the org's KMS (HIP-1134) under a
per-org, per-project ref — one registry with two readers, visor and model
serving (HIP-1140), and therefore neither one's store. Utilization is the shared
compute time series (`apps/samples`), one table in the datastore with `org` as
its only tenant key, bound and never interpolated.

A capability that keeps a private copy of any of the three has two answers to
one question. visor keeps none.

### §2 The boundary: the machine, not what runs on it

visor answers for rented hardware. Everything a customer puts on it belongs
somewhere else, and the split is clean at every neighbour:

- **platform** (HIP-1230) is the container plane: builds, releases,
  environments, domains, logs. "Give me a GPU box" is visor; "run this image" is
  platform. Neither provisions the other's noun.
- **sandboxes** (HIP-1146) is the compute primitive for somebody else's code —
  a pod whose lifetime is a request, on capacity that already exists. visor
  never executes a customer's code; it hands back a machine and stops.
- **bots** owns `/v1/bots`, which is a bot doing work on a desktop, live: a
  session. `/v1/compute/bots` is a machine of kind bot plus its agent binding —
  rented hardware bootstrapped with a runtime. Two nouns share a word and do not
  share an address.
- **agents** (HIP-1210) owns the agent. visor owns the binding that says a given
  machine hosts one, because the binding is a property of the machine.

Inside visor, `/v1/clusters` is the fleet's answer to "what clusters do I have",
provisioned and attached together, while `/v1/k8s` is the provider lifecycle
that creates and destroys them. Both are visor's, which is exactly why they fold
under one name rather than being called two capabilities.

### §3 The addresses

visor answers under `/v1/machines`, `/v1/gpus`, `/v1/clusters`, `/v1/k8s`,
`/v1/fleet` and `/v1/compute`. HIP-0139 §3 gives a
capability one. Each of these is a line in the misfiled ratchet (HIP-0139 §5.1),
and each closes by fold (HIP-0139 §7.1), never by split: there is one owner and
§1 leaves no second store to split along.

- `/v1/machines` — the org's machines, one machine, its agent binding, and every
  binding in the fleet at `/v1/machines/agents`.
- `/v1/gpus` — the accelerators on those machines, and `/v1/gpus/alerts`.
- `/v1/clusters` — the cluster list, attach and detach, and node-pool create,
  scale and delete.
- `/v1/k8s` — cluster list, one cluster with its pools and worker nodes, create,
  delete, and the fleet-wide worker nodes at `/v1/k8s/nodes`.
- `/v1/fleet` — the board, the attached workers at `/v1/fleet/workers`, the
  utilization series at `/v1/fleet/samples`, and the GPU job queue at
  `/v1/fleet/jobs` with a cancel.
- `/v1/compute` — the launch catalog at `/v1/compute/regions` and
  `/v1/compute/sizes`, and bot machines under `/v1/compute/bots`.

Every route with a shape to state is typed. Five are declared with prose beside
the route, and each names why it cannot be a value:

1. `POST /v1/machines` and `POST /v1/compute/bots/launch` — the response shape
   is chosen by the request: `dryRun` answers 200 with a price quote, a real
   launch answers 201 with the created resource. A typed op declares one `Out`,
   so typing either would have to change one of the two bodies.
2. `GET /v1/compute/regions` and `GET /v1/compute/sizes` — the body is the
   launch catalog exactly as the compute service states it. visor does not know
   that shape, and inventing one is the opposite of what a passthrough is for.
3. `POST /v1/compute/bots/{id}/{action}` — a verb dispatch, not a resource. The
   `message` action streams the bound agent's answer back untouched: the
   upstream body, its content type and its status. There is no `Out`, and
   declaring one would buffer the stream.

The two launches spend real money, so their prose MUST state where the quote is;
a caller reading only the document has no other place to learn it.

### §4 Tenancy

The tenant is `principal.Org`, minted from the validated IAM owner claim
(HIP-0026). It is forwarded to the compute service as `owner=<org>`, beside the
gateway's own identity headers, which the edge has already sanitized of any
client copy. It is never read from a body: a launch always lands in the caller's
own tenant, and the ownership field a request might carry is ignored, not
honoured. Absent a validated principal the answer is 403.

A machine is addressed upstream as owner plus name, so another tenant's id is
not reachable rather than refused — the surface is not an existence oracle.
Reads are open to any validated member of the org. The two mutations on
`/v1/k8s/clusters`, create and delete, additionally require a platform
SuperAdmin or an admin of the caller's own org (`requireClusterAdmin`,
HIP-0118), because provisioning spends on the house account rather than the
customer's.

### §5 Money

The surface declares `cloud.Metered` (`plugin/visor/main.go`).

A launch is not metered here. It fronts the compute service's resell endpoint,
which owns the balance gate and the per-hour meter; visor forwards the tenant
and returns what came back, and a `dryRun` quote is that service's price
verbatim. Putting a second meter on this plane would be a second number for one
machine.

visor meters exactly one unit of its own: attaching a bring-your-own cluster,
kind `byo-cluster`, priced from the shared compute fee (`CLOUD_COMPUTE_FEE_CENTS`,
whose source is the price list, HIP-1222). The customer brings the compute and
the management plane is what is charged. The debit lands through the org's
resource meter under the provider label `compute` — the commerce attribution and
spend-cap scope key — and is gated before the register and metered after it, on
the same key, so the amount authorized and the amount charged cannot drift. A
deployment that prices the attach at zero is ungated exactly as it is unbilled.
Every other route is free.

### §6 Events and observability

visor publishes nothing on the bus: no `visor.*` event reaches a customer's
webhooks. Beyond the request span every route already gets, it writes no audit
record and exports no metric of its own.

What it does emit is the tenant's own data, on request. `POST /v1/fleet/samples`
is how an attached worker self-reports utilization; the sample is validated
against the closed source and unit vocabularies, stamped with the caller's org,
and appended to the shared series off the request path, so a slow or absent
warehouse never fails an ingest. `GET /v1/fleet/samples` reads that series back
and `GET /v1/fleet` folds the latest sample onto each unit.

### §7 A partial answer says it is partial

Several reads here fold two independent sources, and a fold that loses one MUST
still answer with the source that replied. An outage in a provider a tenant does
not use must not take away the box the tenant does own.

The fold therefore carries the failure rather than swallowing it: a `degraded`
list names the source that did not answer and gives a terse, log-safe reason —
never the upstream's body, which for an unknown path is a page of markup. The
field is additive and omitted when everything answered, so a healthy response is
unchanged and a consumer that wants to tell an outage from an empty estate can.
Without it, "the provider is down" and "you own nothing" are the same three
bytes on the wire.

### §8 Stage

`ga`. The manifest row declares no stage, and absent is `ga` (HIP-0139 §8).

### §9 Upstream

The capability derives from no upstream code: `apps/visor` embeds nothing and
holds one HTTP client. The compute service it fronts is `hanzoai/visor`,
Apache-2.0, which derives from Casbin's Casibase with that notice preserved in
its LICENSE.

That client speaks two wires and every call site says which, because they cannot
be told apart by looking. The enveloped wire answers HTTP 200 with
`{status, msg, data}`, so a logical failure is `status: "error"` at 200 and a
bare status check reads it as success. The typed wire answers the value: the
status is the outcome, 204 for a void result and 404 for a miss, with no
envelope. Converting a noun from one to the other is a wire break and lands with
its caller in the same change.

## Rationale

The alternative to one face over a compute service is the console and the CLI
each calling that service directly. It costs a second copy of the tenant rule in
every client, and the tenant rule is the whole security model here. The
alternative to folding attached compute into the same lists is a second cluster
surface for bring-your-own, which answers "what clusters do I have" twice and
eventually differently.

## Security Considerations

The wrong implementation hands one tenant another tenant's compute. Three facts
prevent it and none of them takes an input the caller controls: the owner is the
validated claim, so a launch cannot be addressed elsewhere; a machine is
identified upstream as owner plus name, so another tenant's id resolves to
not-found rather than to a refusal that confirms it exists; and the identity
headers forwarded are the gateway's own, the client's having been dropped at the
edge.

The attach is the sharpest edge, because a kubeconfig is both a credential for a
cluster and an instruction to dial a host. It is validated before it is sealed,
at the one check that discovery folds and hand-pasted attaches both pass
through: an `exec` or auth-provider credential plugin is refused, because
honouring one runs a binary in the serving process's environment, and the
apiserver must be a routable https endpoint, because a private address is a
request to dial inside the cluster. What is stored is sealed in the org's KMS,
so the custody nodes hold ciphertext, and it is never echoed back.

The admin gate on cluster create and delete protects Hanzo's own money rather
than the tenant's data, which is why it is the only mutation here that asks for
more than membership.

## References

- HIP-0026 — Identity and Access Management
- HIP-0106 — Hanzo Plugin Contract
- HIP-0118 — SuperAdmin and Tenant Isolation
- HIP-0139 — Capability
- HIP-1134 — KMS — Secret Custody
- HIP-1140 — ML — Model Serving
- HIP-1146 — Sandboxes — The Compute Primitive
- HIP-1210 — Agents — Define, Run, Keep the Run
- HIP-1222 — Pricing — The Price List and Who May See It
- HIP-1230 — Platform — The Container Plane

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
