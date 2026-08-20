---
hip: 1049
title: Validators
author: Hanzo AI
type: Standards Track
category: Infrastructure
status: Draft
created: 2026-08-20
capability: validators
requires: HIP-0027, HIP-0106
---

# HIP-1049: Validators

## Abstract

`/v1/validators` turns proof that a wallet holds a validator-tier NFT into a
provisioned node: prove the slot, get a staking identity generated and sealed, get
a node custom resource written, and get a registration QUEUED for the owner to
co-sign. It is served by `apps/validators` in `hanzoai/cloud`.

The token id IS the slot. Everything else — the challenge, the signature, the
on-chain ownership read, the sealed keys, the queued registration — exists to make
that claim provable and its consequences reversible.

## Motivation

Onboarding a validator by hand is a sequence in which every step can be done
wrong: keys generated on somebody's laptop, a node pointed at the wrong network, a
registration submitted before anyone checked the stake. The sequence is worth
automating exactly once, server-side, with each step failing closed.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted as
in RFC 2119.

### 1. The claim, in order

1. A challenge is issued for a slot: a single-use nonce bound to (validated org,
   slot), stored server-side, with the EXACT message to sign
   (`apps/validators/validators.go:246`).
2. The claim burns the challenge FIRST, before any chain read, so a replayed or
   forged nonce dies before it can cost an RPC call
   (`apps/validators/validators.go:326`).
3. The signer is recovered from the message THIS SERVER REBUILDS from the
   validated org, the slot and the nonce — never from a message the caller
   supplied.
4. That recovered wallet MUST hold the validator-tier NFT for that slot on chain.
5. Only then: generate a staking identity, seal it, write the node resource, queue
   the registration.

Steps 1 and 3 together are the property: signing anything other than the server's
own message cannot claim a slot, and a signature obtained for one org or one slot
cannot be replayed for another.

A slot outside the validator tier is refused at the challenge, before anyone
signs.

### 2. Keys are sealed before anything is persisted

The staking identity is generated and sealed into the key management plane BEFORE
the claim row is written (`apps/validators/validators.go:363`). A claim MUST NOT
exist without its keys.

Key material MUST NOT be returned, logged or stored in the clear. It seals under an
org-scoped coordinate, and the reader that materialises it into a node is admitted
only for that same org (`apps/validators/validators.go:613`).

### 3. Registration is queued, never submitted

The pipeline ENQUEUES an owner-gated registration and MUST NOT submit it to any
chain. The owner co-signs out of band, and the stake weight is set at co-sign
time — never derived from the NFT (`apps/validators/validators.go:392-400`).

This is the line between "provisioning a node" and "committing stake". The first
is automatable; the second is a decision a person makes.

### 4. The new node is a NEW node

Provisioning writes a resource for a node this pipeline owns. It MUST NOT touch a
running node, and the guard is structural rather than procedural: the resource
name is always the claim's own prefixed form, reserved namespaces are refused, and
the legacy resource groups are refused, so even an org name that folds toward a
reserved word cannot escape the prefix (`apps/validators/validators_test.go:332`).

### 5. Degrade honestly

With no cluster reachable, the slot is still claimed, the keys are still sealed and
the registration is still queued; the node is reported PENDING
(`apps/validators/validators.go:433`). A provisioner that cannot provision MUST
report that rather than fake a success.

### 6. Tenancy, and the two 404s

The org is the validated principal, never a client header, and every store query
filters on it. A slot held by ANOTHER org is a 404 on the read path — the same
answer as a slot nobody holds — so the surface cannot be used to probe which slots
are taken (`apps/validators/validators.go:521`). On the WRITE path a slot held by
another org is a conflict, which discloses only what the on-chain ownership read
already established for this caller.

Re-claiming a slot the caller's org already holds is IDEMPOTENT: the node resource
is re-applied and the existing identity is returned, keys and node id stable. A
first claim answers 201, a re-claim 200.

### 7. Identity refusal precedes the body

A write with no validated principal is refused BEFORE the request body is decoded
(`apps/validators/validators.go:172`). A typed operation runs after decoding, so a
check inside the handler answers 400 to an unauthenticated caller whose body is
also malformed — telling them the shape of a surface they may not use. This is
pinned by a test, because it is a property of where the check sits and not of what
it says.

### 8. One parse rule per value

The slot id and the page limit each have exactly ONE parse rule, and the typed
inputs carry them as strings for that reason: the rule that has always served
these routes trims surrounding whitespace, and one rule is better than two
(`apps/validators/validators.go:632`). Path and query MUST NOT outrank a claim
body — the claim's fields are body-only, so there is no second way to address the
write.

## Rationale

Proof of ownership could be a signature over a client-chosen message, which is one
fewer round trip. It also lets a signature harvested anywhere else be replayed
here. A server-issued, server-stored, single-use nonce costs a call and closes
that.

Burning the challenge before the chain read, rather than after a successful claim,
means a flood of forged nonces costs one store write each instead of one on-chain
call each.

## Security Considerations

This capability mints a node identity and commits infrastructure, so its refusals
are the specification. Every gate fails closed: a bad signature, a non-owner, an
out-of-tier slot or an unreachable key plane all leave no claim persisted and no
key material exposed.

The queued registration is the last containment. Even a caller who defeated
everything above obtains a provisioned node and a pending request, not a validator
with stake — because nothing in this pipeline can submit one.

Sealed staking keys are the highest-value material here. They are generated
server-side, never leave the seal, and are addressed under an org-scoped
coordinate the reader admits only for that org; a coordinate that could be named
across orgs would make every other control cosmetic.

## References

- HIP-0027 — Secrets Management Standard
- HIP-0106 — The Hanzo Plugin Contract
- HIP-0519 — One Identity Boundary

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
