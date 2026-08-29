---
hip: 1324
title: KV — Buckets of Versioned Values
author: Hanzo AI
type: Standards Track
category: Infrastructure
capability: kv
status: Final
created: 2026-08-21
requires: HIP-0026, HIP-0106, HIP-0139, HIP-1060
---

# HIP-1324: KV — Buckets of Versioned Values

## Abstract

`/v1/kv` is keyed state an org holds: buckets of values addressed by key, where
each key keeps a bounded history of revisions, entries can expire by TTL, and a
read can ask either for the value or for how it got there. Six operations, all
typed. It is implemented in `hanzoai/cloud` at `apps/kv` (HIP-0106), and it owns
no server: the store is the one embedded broker node `pubsub` runs (HIP-1060),
reached by composition rather than by starting a second one.

This HIP specifies the capability and, because the split that created it is the
interesting part, the store boundary that made the split legal under
HIP-0139 §7.2.

## Motivation

The surface existed before the capability did. It answered at `/v1/pubsub/kv`
because the broker behind the bus ships a key-value layer alongside it, so one
package held both and the packaging of an implementation decided the shape of a
product. Nothing about a bucket publishes, subscribes or waits for a reply; a
caller reading `/v1/pubsub/kv` learns something false about what it is holding.

The address moved to `/v1/kv` first, which left the app named `pubsub` answering
an address not named for it — one line in cloud's `openapi/misfiled.txt`, the
ratchet HIP-0139 §5.1 defines, covering six operations. The argument for
stopping there was that a second app would dial the same broker twice. It does
not, and §1 below says why; the name follows the address, the line is gone, and
the ratchet is empty.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted
as in RFC 2119.

### §1 The store

This capability opens no store of its own. Its store is a set of buckets on the
one embedded broker node `pubsub` runs and owns (HIP-1060), and it reaches that
node through four calls that package exports for exactly this purpose: a dialer,
the validated org, the plane-wide name of a caller's bucket, and the translation
of a broker refusal into a wire refusal.

That is composition, not a second server, and it is why the split satisfies
HIP-0139 §7.2 rather than violating it. The rule refuses a split that leaves two
apps sharing one store; it does not refuse two capabilities on one ENGINE. The
boundary is exact and enforced by construction, not by convention:

- A bucket is a key-value object under the broker's own key-value namespace.
  This capability can address nothing else.
- `pubsub`'s tenant endpoint roots every subject a caller can name under that org's
  subject prefix, and refuses wildcards outright, so a publish cannot land on a
  bucket and a request cannot read one.
- Neither capability can name the other's objects through its own API, in either
  direction, for any caller.

Two disjoint namespaces on one durable log are two stores in the sense the rule
means — the defect it names is two apps reading and writing the same rows, and
that is not reachable here.

The dialer MUST be the shared one. In one process it hands back the in-process
handle to the node that process is running; in this capability's own binary,
where there is no such node, it dials the address the one bus knob names —
`CLOUD_PUBSUB_URL`, defaulting to the loopback address the embedded server
binds. There is no second address variable and no second connection policy. A
capability that dialled the broker itself would be a second copy of the tenancy
rule, free to drift from the first on the day one of them changed.

Mount MUST NOT require the plane to be reachable. The plane is another process,
so refusing to mount until it answers would make boot order load-bearing and
turn a slow neighbour into this capability's outage. The dial fails closed per
request instead: 503 while the plane is unreachable, correct the moment it is
back.

### §2 The addresses

Six operations under `/v1/kv`, all typed — this surface was born typed and there
is no declared-with-prose list here.

`POST /v1/kv/{bucket}` creates a bucket and answers 201 with it, taking the
revision depth, an entry TTL and a value ceiling; 409 when the org already holds
that name. `DELETE /v1/kv/{bucket}` removes it with every key and every revision
and answers 204.

`PUT /v1/kv/{bucket}/{key}` sets a value and answers the revision the write
created — each put is a new revision, never an overwrite, up to the bucket's
depth. `GET /v1/kv/{bucket}/{key}` answers the current value and its revision.
`DELETE /v1/kv/{bucket}/{key}` writes a delete marker, which watchers on the
broker's own port see, and answers 204. `GET /v1/kv/{bucket}/{key}/history`
answers the key's retained revisions oldest first, delete markers included.

Values are TEXT. A value is carried verbatim as UTF-8 bytes, so its round trip
through this endpoint is exact; bytes written on the broker's own port that are not
UTF-8 read back lossily here.

### §3 Tenancy

Every operation derives its org from the validated principal parked on the
request context (HIP-0026), never from a request field and never from a header a
caller may set. A request with no validated principal MUST be refused before it
reaches the plane.

A caller's bucket name is qualified into a plane-wide name that encodes the org,
and the encoding MUST be injective: a plane-wide name decodes to exactly one
(org, bucket) pair. Caller names are constrained so the separator cannot appear
in them, which is what makes the decode unambiguous rather than merely unlikely.
The same name in two orgs is two buckets, and each org may claim it.

What a malformed name is answered WITH is part of the boundary. On a create,
where the caller is choosing the name, it is a refusal that says so. Everywhere
else it is absence — the same answer another org's real bucket gets — because a
endpoint that distinguished "your name is malformed" from "that bucket is not yours"
would be an existence oracle for names in other tenants.

### §4 Money

Free, and said in those words: the plugin declares `Price: cloud.Free`. No meter
runs behind any route. Bytes held are the plane's, and the plane is free.

### §5 Events and observability

It publishes no events of its own, so a customer's webhooks (HIP-1310) receive
no `kv.*` event. Beyond the request span every route gets it emits nothing to
observability. A watcher on the broker's own port sees every write to a bucket,
which is the broker's facility and not an address this capability serves.

### §6 Stage

`ga`. The manifest row declares no stage, and absent is `ga` (HIP-0139 §8).

### §7 Upstream

It derives from no third-party project of its own. The layer behind it is
`hanzoai/pubsub`, a derivative of NATS Server (Apache 2.0), whose key-value
layer survives in HEAD; it is reached over the `nats.go` client (Apache 2.0).
Both are `pubsub`'s dependencies, declared there (HIP-1060 §Upstream), and this
capability adds none.

## Rationale

The alternative is the arrangement this replaces: one package answering two
addresses, with a line in the misfiled ratchet explaining it. It is cheaper on
the day the address moves and more expensive every day after, because each of
the nine projections then carries the explanation separately — a client class
named for the bus with methods about buckets, a tool description that has to
disclaim its own name, a documentation page filed under messaging.

The other alternative is a fold the other way: `/v1/pubsub/kv`, one capability,
one address. It was rejected on what the two things ARE. A fold is right when an
app with one store answers for several nouns; here the nouns do not compose —
`publish` and `put` share an engine and nothing a caller can reason about — and
the fold would put a store under a verb.

Keeping the dialer in `pubsub` rather than lifting it into a package both import
was chosen because `pubsub` already owns the plane and already exports the one
address knob every rider reads. A third package holding the connection would be
a new name for a thing that has one, and every rider would have to learn it.

## Security Considerations

The wrong implementation here is a cross-tenant read of stored state, which is
what a key-value store exists to hold — session material, configuration, keys a
customer parked in it. Three controls close it, and each is a construction
rather than a check.

The org is the gateway's verdict, so a caller cannot name a tenant. The
plane-wide name is injective, so one org's handle cannot resolve to another's
bucket even if a name were forged into existence by some other path. And the
tenant prefix keeps every bucket this endpoint creates disjoint from the platform's
own state on the same node, so a caller cannot address the event plane's storage
by guessing at a name.

The remaining edge is the dial. This capability's binary reaches the plane over
the address the one knob names, which in the shipped topology is a loopback
address inside the pod. A deployment that pointed that knob at a shared broker
reachable by another tenant's process would move the boundary out of this code
and into that broker's configuration, where none of the above is enforced.

## References

- HIP-0026 — Identity and Access Management
- HIP-0106 — The Hanzo Plugin Contract
- HIP-0139 — Capability
- HIP-1060 — Pubsub — The Tenant Endpoint on the Bus
- HIP-1310 — Webhooks — Outbound Delivery

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
