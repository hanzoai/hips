---
hip: 0520
title: Serving Topology — Three Tiers, Horizontally Scalable, Pinned Per Entity
author: Hanzo AI Team
type: Standards Track
category: Infrastructure
status: Active
created: 2026-07-29
requires: HIP-0519
---

# HIP-0520: Serving Topology

## Abstract

Three tiers, each holding one concern, each horizontally scalable:

```
  DO LB ──▶ ingress          TLS termination. Decides nothing.
        ──▶ gateway          THE EDGE: JWT verify, authz, rate limit.
        ──▶ cloud            Serves ANY request through the plugin framework.
                  └── ZAP over UDS ──▶ plugins (lazy, capabilities)
```

One transport family: ZAP over QUIC between tiers, ZAP over a unix socket
on-host. Every tier scales by adding replicas.

Cloud is **stateless but pinned**: a replica owns no durable state, yet requests
for one entity land on one replica, because a per-org store has exactly one
writer.

## Motivation

Stateless and single-writer look contradictory. Resolving them by making the
store shared (one Postgres for everyone) throws away tenant isolation and the
local-latency property; resolving them by making replicas sticky-by-session
throws away scaling. Neither is necessary: the two are orthogonal once you
separate WHERE A REQUEST GOES from WHAT A REPLICA REMEMBERS.

## Specification

### The tiers

**Ingress** terminates TLS and forwards. It holds no identity, mints no header,
makes no authorization decision. Any replica serves any request.

**Gateway** is the edge (HIP-0519): it strips client-supplied identity, verifies
the credential against IAM, mints the identity headers, and applies the rate
limit. Any replica serves any request, because the JWKS is cacheable and the
decision is a pure function of the token.

**Cloud** serves any request through the plugin framework. It holds no state of
its own; the state belongs to the plugins' stores, and a store has ONE OWNER.

### Pinned per entity

A per-org store has one writer, so two replicas must never open one org's store.
The request therefore goes to the replica that owns the entity:

```
  replica = rendezvous(entity, live replicas)
```

Highest-Random-Weight (rendezvous) hashing, not modulo: adding or removing a
replica moves only the keys that must move, rather than reshuffling every key.

The entity is the **owner of the store being written** — the org for per-org
data, the user or writer where the store is finer. It is read from the identity
the edge already minted, so pinning costs no lookup and cannot disagree with
the tenancy decision.

**Pinning is a ROUTING property, never an authorization one.** A request that
reaches the wrong replica must be forwarded or refused, never served from a
store the replica does not own. Reading a store you were not routed to is the
single-writer violation this exists to prevent.

### Lazy plugins

A plugin's process starts on FIRST USE, not at boot. A host composing dozens of
plugins pays for the ones traffic reaches, not for the set. Dependency is a
typed capability the plugin declares and is handed: the call boots the callee if
it is registered, and the type — not a name string — is what says the dependency
exists (HIP-0519 §capabilities).

Laziness is what makes many plugins affordable, and it is why a replica can
serve ANY request: it need not hold every plugin resident to be able to answer
for any of them.

### Deployment

Every change deploys natively through **cd.hanzo.ai**. No hand-applied
manifests: a resource applied by hand is one git and the cluster can disagree
about, with nothing to detect the drift. HIP-0519 records two network policies
that are inert for exactly that reason.

## Security Considerations

**A pin is not a permission.** Routing decides which replica answers;
authorization decides whether the answer is owed. A replica must apply the same
tenancy check whether or not it was the pinned one.

**The edge must be unavoidable.** Cloud replicas reachable without traversing
the gateway accept whatever headers a caller sends — see HIP-0519, where a
forged identity reads another tenant's secret.

## References

- HIP-0519 — One Identity Boundary (the edge, the header set, capabilities)
- HIP-0106 — Wire protocol stack

## Copyright

Released under the MIT License.
