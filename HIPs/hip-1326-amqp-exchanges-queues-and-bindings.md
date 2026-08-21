---
hip: 1326
title: AMQP — Exchanges, Queues and Bindings Onto the One Bus
author: Hanzo AI
type: Standards Track
category: Infrastructure
capability: amqp
status: Draft
created: 2026-08-21
requires: HIP-0106, HIP-0139, HIP-1323
---

# HIP-1326: AMQP — Exchanges, Queues and Bindings Onto the One Bus

## Abstract

`amqp` is AMQP 0-9-1 spoken on `:5672` and translated to and from the JetStream
that `pubsub` serves. A standard RabbitMQ client points at the port and works
unchanged. It is implemented in `hanzoai/cloud` at `apps/amqp` (HIP-0106) over
the adaptor at `github.com/hanzoai/amqp`.

It is the second wire in the family HIP-1323 opened, and it is the one that
tests the family's rule. A Kafka client names a topic and the bus already has
somewhere to put it. An AMQP client DECLARES — exchanges, queues, bindings — and
expects the declaration to outlive its connection and to be visible to its
peers. So this adaptor has a topology to keep, which is exactly the state
HIP-1323 §1 forbids an adaptor to hold. The resolution is that it does not hold
it: the topology lives on the bus, in a JetStream KV bucket, and the adaptor is
a mirror of it.

## Motivation

The argument for meeting a client on the wire it already speaks is HIP-1323's
and is not restated. What is worth stating is why AMQP is the harder half of it,
because a reader who has the Kafka spec in hand will expect this one to be the
same shape and it is not.

AMQP's routing is a topology the CLIENT builds. Publishing names an exchange and
a routing key; what a message reaches is decided by the bindings other clients
declared. Two facts follow, and they are the whole design. The first is that
routing is a lookup and not a name, so the translation onto subjects has to be
total — every exchange kind, every wildcard, every degenerate spelling — and
where it cannot be total it has to REFUSE in the protocol's own vocabulary
rather than silently route somewhere adjacent. The second is that the topology
is durable and shared: a queue declared on one connection is consumed on
another, and on a second replica.

A broker would keep that in its own store. This is not a broker, and a private
store is how the two answers to "what is bound to this exchange" get shipped.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted
as in RFC 2119.

### §1 Where it sits

| Capability | What it is | Where a client meets it |
|---|---|---|
| `pubsub` (HIP-1060) | **the bus** — embedded NATS/JetStream | `:4222`, and `/v1/pubsub` |
| `kafka` (HIP-1323) | a wire-protocol adaptor over that bus | `:9092` |
| `amqp` | a wire-protocol adaptor over that bus | `:5672` |
| `mq` (HIP-1061) | the managed product: org-scoped durable queues and streams | `/v1/mq` |

The adaptor MUST dial the bus through `pubsub.URL`, so it cannot end up bridging
a bus other than the one the rest of the process publishes to.

It holds no state of its own. Messages live in one stream, `AMQP`, over subjects
`amqp.>`; the topology lives in one KV bucket, `amqp`. Both are the bus's. The
adaptor keeps an in-memory mirror of the bucket and MUST treat it as a cache: it
writes locally and then to the bucket, and every replica watches the bucket for
the rest. A replica MUST drain the watch's initial replay before it serves a
client, or two connections to two replicas disagree about what is declared.

`:5672` is the default and is configurable by `CLOUD_AMQP_PORT`.

### §2 Exchanges, queues and bindings become subjects, consumers and filters

| AMQP | On the bus |
|---|---|
| exchange + routing key | the subject `amqp.<exchange>.<key>` |
| queue | a durable pull consumer on the `AMQP` stream |
| binding | a filter subject on that consumer |
| exchange, queue, binding | a key in the `amqp` KV bucket |

Two spellings in the subject are not the obvious ones and both are load-bearing.
The DEFAULT exchange — AMQP's `""` — is the word `_`, and only in the exchange
position. An EMPTY routing key is spelled by omitting the word entirely, not by
an empty word. So `("", "")` is `amqp._` and `("", "_")` is `amqp._._`, and a
literal `_` key stays distinct from no key.

An exchange or queue name MUST be a single subject word — `[A-Za-z0-9_-]`, at
most 128 characters. A name containing a dot MUST be refused, because exchange
`a` with key `b.c` and exchange `a.b` with key `c` would otherwise be one
subject. A routing key on a PUBLISH MUST be literal: an empty word, or any of
`* # >`, is refused.

Exchange kinds `direct`, `fanout` and `topic` are implemented. `headers` is
refused (§4): it routes on the message's own table rather than on a name, so
there is no subject for it to be.

A queue's consumer is declared with explicit acknowledgement, a five-minute ack
wait, and DELIVER-NEW — a queue holds what was published after it was declared,
which is AMQP's rule. `MaxAckPending` is deliberately unbounded on the consumer
because prefetch is a property of a CHANNEL, not of a queue (§3). Declaring the
queue is what creates the consumer, so declaring is what starts collecting.

The queue's implicit binding to the default exchange under its own name is
DERIVED and MUST NOT be stored, or unbinding it becomes representable.

#### §2.1 `#` is not `>`

AMQP's `#` matches ZERO or more words; NATS's `>` matches ONE or more. They are
not the same wildcard and a one-for-one rewrite silently loses the zero case —
the message published to the exchange root, which is the case a binding of `#`
most obviously means to catch.

A binding key ending in `#` therefore produces TWO filter subjects: the `>` form
and the bare prefix.

| exchange kind | binding key | filter subjects |
|---|---|---|
| `topic` | `a.*` | `amqp.t.a.*` |
| `topic` | `a.#` | `amqp.t.a.>` and `amqp.t.a` |
| `topic` | `#` | `amqp.t.>` and `amqp.t` |
| `topic` | `` (empty) | `amqp.t` |
| `fanout` | anything, ignored | `amqp.f.>` and `amqp.f` |
| `direct` | `k` | `amqp.d.k` |

`*` MAY appear in any word of a `topic` binding key. `#` MUST appear only as the
last word, because NATS matches a rest-wildcard only in last position; anywhere
else it is refused (§4). A partial wildcard within a word — `a.b*` — is refused:
NATS has no such match. A `direct` binding key MUST hold no wildcard at all,
because a direct key matches literally.

Filters MUST be deduplicated and sorted before they reach the consumer, since
JetStream refuses a self-overlapping filter set.

#### §2.2 A message keeps its properties and stays readable

The AMQP body is the NATS payload verbatim. The content header's octets ride in
one NATS header, `Amqp-Props`, base64-encoded.

This is the right way round: a subscriber that is not an AMQP client — a
NATS-native consumer, or a Kafka one through the sibling wire — reads the body a
publisher sent, without having to know that AMQP was involved. Properties are
available to whoever wants them and are in the way of nobody.

### §3 Acknowledgement, and what bounds a consumer

| AMQP | On the bus |
|---|---|
| `basic.ack` | `Ack` |
| `basic.nack` / `basic.reject`, `requeue=true` | `Nak` |
| `basic.nack` / `basic.reject`, `requeue=false` | `Term` |

`requeue` is honoured and is the only thing that chooses between `Nak` and
`Term`. The `multiple` flag is supported on `ack` and `nack`: it settles every
outstanding tag at or below the one named, and a tag of zero means all of them.
`basic.reject` carries no such flag, per the protocol. Settling a tag that is
not outstanding is a 406; a `multiple` settle that matches nothing is not an
error. `basic.recover` is answered by re-queueing everything outstanding.

Delivery tags MUST be allocated in the order the deliveries are written to the
socket, or a `multiple` ack settles a set the client did not mean.

`basic.qos` prefetch-COUNT is implemented, per-consumer or, with the `global`
flag, shared across the channel. Prefetch-SIZE is refused (§4). The count is
enforced by the adaptor as an in-flight bound and is not merely a fetch size.

A `no-ack` consumer is UNBOUNDED, and this follows from the protocol rather than
from an omission: such a consumer has no outstanding delivery to count, so there
is nothing for prefetch to bound. A client that wants a ceiling MUST acknowledge.

Deliveries outstanding when a channel or connection closes are re-queued, never
dropped.

### §4 What is not implemented, and how it says so

Every entry below answers a CHANNEL exception — `channel.close` carrying reply
code 540 NOT_IMPLEMENTED, the class and method that were sent, and a sentence
naming what to do instead. The CONNECTION survives, so a client may open another
channel and continue.

| Not implemented | Class | The answer says |
|---|---|---|
| `headers` exchanges | exchange | routes on something other than a name and has no subject to be |
| transactions (`tx.*`) | tx | a publish is confirmed one at a time through `confirm.select` |
| byte-counted qos (prefetch-size ≠ 0) | basic | bound the channel by message count instead |
| the `immediate` flag | basic | publish with `mandatory` to learn that nothing is bound |
| `channel.flow(false)` | channel | pause a consumer with `basic.cancel` or bound it with `basic.qos` |
| exchange-to-exchange binding | exchange | bind the queue to each exchange it should read |
| `#` before the end of a binding key | queue | NATS matches a rest-wildcard only in last position |
| `basic.recover-async` | basic | use `basic.recover`, which is answered |

A refusal MUST name the remedy. A bare NOT_IMPLEMENTED tells a client author
that something is missing and not which of the several things they were doing
caused it.

#### §4.1 What IS implemented, and is commonly assumed not to be

Stated because the list above invites the wrong inference, and because a client
author who assumes these are absent will write a worse client.

`mandatory` is honoured, and `basic.return` is real: an unroutable mandatory
publish comes back with reply code 312 NO_ROUTE carrying the original properties
and body, and is not stored. Under publisher confirms it is still acknowledged,
per the protocol — a return is not a failure to publish.

`basic.get` is implemented, and answers `basic.get-empty` rather than blocking.
Consumer cancellation is implemented, and `consumer_cancel_notify` is advertised.
Publisher confirms (`confirm.select`) are implemented, with a per-message ack,
and a nack when the bus refuses the publish.

### §5 Fail closed at boot

`Mount` MUST fail CLOSED. The bus connect, the stream creation, the topology
bucket and the listen all happen before the port accepts, and a failure in any
of them within the startup window aborts boot rather than serving a phantom
broker. A broker that accepts a publish and drops it is worse than a port that
refuses, because the publisher believes it published.

Mount order is the row position in `manifest/apps.go`, and this row MUST stay
after `pubsub` so the embedded `:4222` is accepting when the adaptor dials it.
The row is `Eager` for HIP-1323's reason: it owns a listener, and a lazily
mounted listener would wait for an HTTP request its clients never make.

### §6 Two facts a single process cannot answer for the fleet

`exclusive` queues and the consumer count in `queue.declare-ok` are resolved
from the sockets THIS process holds. A second replica cannot see the first's, so
with more than one replica behind one Service `exclusive` is not a guarantee and
the consumer count is a lower bound.

This is stated rather than fixed because the fix is a decision: either the
exclusivity claim moves onto the bus, where every replica can see it, or the
capability is documented as single-replica. Shipping it as though it holds is
the one option that is wrong.

### §7 It mounts one HTTP route, and does not serve it

The adaptor registers no HTTP route. Cloud's generic per-subsystem liveness
route answers `GET /v1/amqp/health` with a constant, and it MUST NOT be read as
a statement about the AMQP listener: it does not consult the broker, the port or
the bus. A readiness check for this capability is a TCP check against `:5672`.

The consequence for the gates is HIP-1323 §2's and applies unchanged here: a
capability that serves no HTTP operation cannot appear in a document-derived
capability list, so `scripts/coverage.py` reads cloud's `manifest/apps.go` as a
second source. `amqp` was the last capability with no HIP, and it was invisible
to every gate that reads the emitted document.

### §8 The name

`amqp` is the protocol, and the protocol is what this capability is. Per
HIP-0139 §2.5 it is a word because it is the word — an author asking "does this
speak AMQP" finds it under exactly that name in the manifest, the package, the
port's documentation and this HIP. It is NOT named for a broker, because it is
not one, and naming it after one would promise the broker's whole surface.

## Rationale

**Why the topology is on the bus rather than in the adaptor.** A private store
would be simpler to write and would make every replica a different broker. Two
clients that declared the same queue against two replicas would each be told
they succeeded and would then consume different messages. Putting it in a
watched KV bucket keeps HIP-1323 §1's rule intact — one store, and the adaptor
is not it — and makes a second replica a scaling decision rather than a
correctness one, everywhere except §6.

**Why refusals are channel exceptions and not connection errors.** A client that
asks for a headers exchange has usually asked correctly for nine other things
first. Closing the connection discards them and turns a feature gap into an
outage; closing the channel leaves the client able to continue, and its library
already knows how to handle exactly that.

**Why the translation refuses rather than approximates.** Every entry in §4 has
an approximation available, and each one is a lie of a different size. `#` in
the middle of a binding key could be routed as `*`, which would deliver a
different set. `immediate` could be treated as `mandatory`, which has different
semantics on a queue with no consumer. A wrong delivery is worse than a refusal,
because the refusal is visible at the moment the client is written and the wrong
delivery is visible much later, to somebody else.

## Security Considerations

**There is no authentication on `:5672` today.** This is a known limitation, and
it is stated here plainly because the port is a credential surface and a spec
that omitted it would be describing a capability nobody has.

SASL PLAIN is offered in `connection.start`, and the `connection.start-ok`
response is never parsed. Any username and password — or none — opens a full
connection. The virtual host in `connection.open` is likewise discarded, so
vhost is not a namespace here. `ACCESS_REFUSED` (403), AMQP's own code for an
authorization failure, is declared in the implementation and returned nowhere.

**The namespace is flat.** Exchange and queue names are global keys in one KV
bucket, the subjects carry no org segment, and a queue's durable consumer name
is the bare queue name. There is no tenant boundary: a connection may address
any name in the deployment, and a `topic` binding of `#` attaches a consumer to
an entire exchange. `pubsub` exports org-scoping helpers (`Org`, `Qualify`) and
this adaptor calls neither.

Cloud adds nothing on this path and structurally cannot: the edge's identity and
scope middleware is HTTP middleware bound to a capability's route prefixes, and
a raw TCP listener has none. `Mount` receives the router and never uses it.

`kafka` on `:9092` has the same posture — its dispatcher registers no SASL
handshake and its `ApiVersions` advertises no SASL key, so a client cannot
negotiate authentication even if it wanted to. This is one property of the
family, not two independent gaps, and it SHOULD be closed once for both.

**What stands today is reachability, and only that.** The chart declares no
Service port and no container port for `:5672`, so the listener is not published
by it; but it binds all interfaces inside the pod, a pod IP is routable on the
cluster network by default, and `hanzoai/cloud` declares no NetworkPolicy.
Production topology is declared in a private repository and MUST be checked
rather than assumed.

Therefore: this capability MUST NOT be exposed beyond the fabric that needs it
until one of the following holds.

1. **Network.** A NetworkPolicy admitting only the workloads that must reach it,
   and the listener bound to loopback where the client is co-resident. This is
   the cheaper option and it grants no tenancy — every admitted client still
   shares one flat namespace, so it is sufficient only where every admitted
   client is equally trusted.
2. **Identity.** An IAM-minted token presented in the SASL PLAIN response and
   validated there, yielding the same org the equivalent HTTP principal would
   carry, with the org then scoping the subject and the topology key. This is
   the option that makes the capability multi-tenant, and it is the one that
   lets §1's table read the same way for `:5672` as for `/v1/pubsub`.

A third option — a second policy engine on this wire — MUST NOT be taken. The
subjects live on one bus and the authorization decision belongs with them.

Two implementation notes that bear on any such work. A `frame-max` bound is
enforced on read, so an oversized frame cannot become an unbounded allocation.
A content header declaring a body larger than the bus will accept is refused on
the HEADER, before the body is read.

## References

- HIP-0106 — Hanzo Plugin Contract
- HIP-0139 — Capability
- HIP-1060 — PubSub — The Tenant Door on the Bus
- HIP-1061 — MQ — Queues and Streams
- HIP-1323 — Kafka — A Wire Onto the One Bus
- AMQP 0-9-1, and its `basic`, `queue`, `exchange`, `tx` and `confirm` classes

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
