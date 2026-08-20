---
hip: 1070
title: Git Webhook — The Push Door
author: Hanzo AI
type: Standards Track
category: Infrastructure
capability: git-webhook
status: Draft
created: 2026-08-20
requires: HIP-0027, HIP-0106, HIP-0119
---

# HIP-1070: Git Webhook — The Push Door

## Abstract

`/v1/git-webhook` is where the forge delivers a push. The delivery is verified by
signature, the landed ref becomes a build, and the same push becomes a lifecycle
fact for the mirror, the index and the notifier.

This HIP specifies the receiver: why it lives where it lives, why it cannot be a
typed operation, and the four bounds that keep an unauthenticated door from being
a lever. The implementation is `hanzoai/cloud` `apps/platform/hook.go`.

## Motivation

A receiver that accepts a delivery and does nothing is indistinguishable from a
working one. That is not hypothetical: this door previously lived in the version
control app, which runs as its own process, where the build trigger has no
registrant. Every delivery was signed, accepted, answered 204, and built nothing.
Nobody saw a failure, because there wasn't one.

Moving the address was the fix, and the general rule is worth stating once: **a
receiver has to sit in the process that can act on what it receives.** The retired
door now answers 410 naming this one.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted as
in RFC 2119.

### The receiver is in the process that builds

Each app runs as its own process, and the deploy trigger has exactly one
registrant. This door MUST be registered in that process.

Native and forge-borne pushes travel the same two seams: the push trigger and the
lifecycle emission. One trigger, two transports — the decision about what a push
*means* stays downstream, in the one place that knows.

### Authentication is the signature

The forge holds no platform session, so this address is public at the identity
layer and **authenticated by an HMAC over the raw bytes**, checked before the
payload is parsed. An unauthenticated body is never decoded.

That is also why this cannot be a typed operation: a typed operation decodes
first.

The bytes verified MUST be exactly the bytes acted on.

### The payload says what it is

The event kind is taken from the **payload**, not a header. A receiver gating on
one spelling of a header answers every push a benign 200 the day the forge picks
another spelling — the silent nothing this door exists to have stopped. A push is
identified by carrying a ref, a repository and the commit that ref moved to. An
all-zero commit id is a ref deletion.

### Four bounds

1. **No encoded body.** A request declaring a content encoding is refused 415
   before the body is touched. The order is the whole control: reading a body
   decompresses it, so a size check on what comes back bounds the *inflated* size
   and can only be told about an allocation that already happened. A few kilobytes
   on the wire would otherwise buy megabytes of it, in the process that owns
   builds and deploys, from a caller holding no credential. The forge sends
   uncompressed, so nothing served here needs the feature.
2. **A body cap** on what is hashed and acted on.
3. **A secret freshness window**, so a rotation goes live with no restart and an
   unauthenticated flood costs one key-store read per window rather than one per
   request.
4. **A read timeout** on that key-store read, set **below** the forge's own
   delivery timeout. This fork does not retry: a read that outlives the delivery
   has already lost the push and is only choosing whether to hold the refresh open
   behind it. Failing inside the window the forge still cares about is what lets
   the answer reach the delivery page.

### Failures are attributed to the right side

A deployment that cannot read its own verifying secret answers **503, not 401**. A
bad signature and an unreadable secret are different faults, and reporting the
second as the first sends an operator to inspect the forge's configuration for a
problem that is in ours. It fails closed — nothing after it runs — and it is red
on the delivery page, which is the recovery, since the only redelivery this
transport has is a person choosing to replay.

A deployment that cannot name its own forge also refuses rather than continuing.
The value it would carry on is an empty origin, which every mirror reads as a
native push to be sent onward — the one loop this door must not start.

A good secret survives a failed refresh: the read keeps serving the last value
that resolved cleanly. The consequence MUST be stated where operators will read
it — a rotation performed to burn a leaked secret is only as fast as a key-store
read that succeeds, so if the key store is unreachable the answer is to restart
the pods rather than to wait for a window that cannot turn.

### Duplicates are remembered by fact, not by delivery id

A landed ref is remembered for a bounded window, keyed on the **fact** — namespace,
repository, ref, and the commit it moved to — so two deliveries describing one
landed ref fire once however the forge chooses to identify them.

Taking that memory is half the act: what it becomes is decided by whether dispatch
succeeded, and a **failed dispatch gives it back**. Recording the fact up front
and never rolling it back is what turned a transient trigger failure into a push
lost for the whole window, and into a replay refused as already landed.

The memory is this process's own, and that is the whole of what it claims to be:
the duplicate it exists to stop is a redelivery of a request that timed out after
the seams already ran, and that retry reaches the replica the load balancer sends
it to. A cross-replica answer is the build store's to give; giving it here would
put one question in two places.

### The forge half

A receiver nobody delivers to is the same silence as a receiver that builds
nothing, so the configuration it must match is stated beside it: one **forge-wide
system webhook** covering every repository, posting JSON, triggered on pushes,
signed with the value at the configured key-store reference.

A repository therefore opts in by having an application that tracks it, **not** by
owning a hook of its own. Rotating the secret means writing the new value at that
reference and setting the same value on the forge; deliveries signed with the old
one are refused within one freshness window.

## Security Considerations

This is an unauthenticated door in the process that owns builds and deploys, so
the properties above are load-bearing rather than defensive detail:

- Verify before parse, over the exact bytes acted on.
- Refuse an encoded body before reading it, because the decompression is the
  amplification.
- Fail closed on an unreadable secret, and report it as ours rather than as a
  caller's bad signature.
- Refuse to proceed without a resolvable forge origin, because the empty value is
  the one that starts a mirror loop.

The duplicate window is a correctness property, not a rate limit; it MUST NOT be
relied on as one.

## References

- HIP-0027 — Secrets Management
- HIP-0106 — Hanzo Plugin Contract
- HIP-0119 — Hanzo Service Conventions

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
