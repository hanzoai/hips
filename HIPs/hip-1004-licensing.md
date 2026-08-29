---
hip: 1004
title: Licensing — Signed Tokens for Paid Binaries
author: Hanzo AI
type: Standards Track
category: Security
status: Final
created: 2026-08-20
requires: HIP-0139
capability: licensing
---

# HIP-1004: Licensing — Signed Tokens for Paid Binaries

## Abstract

`/v1/licensing` mints Ed25519-signed license tokens for products an org already
pays for, publishes the public key those tokens verify against, keeps a revocation
list, and gates artifact download on a valid license. It is implemented in
`hanzoai/licensing`. This HIP states the token contract a verifier implements, the
three parties whose questions it composes, and what the service refuses to do.

## Motivation

A binary that runs on a customer's own machine cannot phone home to decide whether
it may run. It needs a claim it can check by itself, offline, at startup, against a
key it already holds. That is one signed token and one public key — and everything
else in this capability exists to decide who gets a token and to take one back.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted as
in RFC 2119.

### Three parties, three questions, and this service asks none of them twice

Authentication is the identity plane's. Entitlement — does this org pay for this
product — is the commerce plane's. This service composes both answers and adds no
third check of its own (`ops.go:21-24`). An app that grows its own gate is a gate
nobody else can audit.

A deployment with no entitlement driver refuses to issue rather than granting
(`pkg/licensing/server.go:49-52`). There is no permissive development default that
can ship by accident.

### The token is the contract

A token is `base64url_nopad(JSON(payload)) "." base64url_nopad(ed25519_sig)`, with
the signature computed over the ASCII bytes of the encoded payload — the substring
before the separator (`pkg/licensing/token.go:5-17`). A verifier therefore never
re-canonicalizes JSON, which is the property that makes two independent
implementations agree.

The schema version is a fixed constant and a verifier MUST reject any other
(`pkg/licensing/token.go:32`). Issued-at skew tolerance is likewise fixed
(`pkg/licensing/token.go:36`), so an online check and an offline check reach the
same verdict on the same token at the same instant.

Unknown payload fields MUST be ignored by a verifier. That is what lets the payload
gain a field without invalidating a verifier built before it existed.

Offline verification checks signature, schema version, expiry and the application
the token was scoped to. Revocation is layered on top by the online check and is
deliberately not part of offline verification (`pkg/licensing/token.go:130-132`) —
an offline verifier cannot know about a list it has never seen, and pretending
otherwise would make the two paths disagree.

### The private key never enters the process

Signing goes through a key-service abstraction. The injection point takes a signer,
never key material, so the invariant holds on every construction path
(`pkg/licensing/server.go:26-36`). This service holds a public key and an opaque
handle.

The public key is published at two addresses and is the one surface that is safe to
read unauthenticated. Everything a verifier needs to check a token is therefore
obtainable without a credential, which is what makes offline verification possible
at all.

### Binding

A license binds to one install through an opaque value the service derives from
device signals supplied by the client, and that value is carried inside the signed
payload. A verifier compares the value; it does not reconstruct it. The derivation
is not part of this contract and a verifier MUST NOT depend on its shape.

### Revocation

Revocation is scoped four ways — one token, one holder, one binding, one release
(`pkg/licensing/revocation.go:3-10`) — so abuse handling can be surgical rather
than an account ban for every case.

**The shipped store is in-memory** (`pkg/licensing/revocation.go:11-13`). A
deployment that relies on revocation MUST persist the list in a shared store: with
more than one replica, an in-memory list means a revoked token still verifies at
whichever replica did not receive the revocation. This is the reason this HIP is
Draft and not Active.

### One route table

The operations are transport-free and become routes in exactly one place
(`pkg/licensing/server.go:3-8`). A second route table is a second contract, and the
published document would then describe whichever of the two the generator happened
to read.

### Price, events, telemetry, stage, upstream

The capability is free, in those words: `Price: cloud.Free`
(`hanzoai/cloud` `plugin/licensing/main.go:23`) — what is paid for is the
product the token unlocks, never the mint. It publishes no events on the bus.
Its stage is `beta` — the manifest row declares it (`manifest/apps.go:124`,
`Stage: Beta`; HIP-0139 §8). The issuer is `hanzoai/licensing`, pinned
v0.1.15 in cloud's `go.mod:692`; it derives from no forked, embedded or
mirrored OSS project.

### On the private repository

Everything an implementer of a *verifier* needs is public: the wire format and the
verification rules above, and the public key at its published address. What is not
public is the *issuer* — this repository. By HIP-0135's rule that is a publication
gap to close, not a dependency this specification places on a reader; nothing in
the verification contract requires reading the issuer's source.

## Rationale

The alternative to a signed offline token is an online license check at startup.
It is simpler to reason about and it makes the product unusable when the network is
unavailable — on software whose whole purpose is to run on the customer's own
hardware. Offline verification with an online revocation layer keeps the failure
mode proportionate: a network outage cannot stop a paying customer working, and a
revocation still lands the next time the machine is online.

The alternative to a fixed wire format is a self-describing token with negotiated
algorithms. That buys agility and costs the property that makes this work — two
implementations in two languages agreeing byte-for-byte on what was signed.

## Security Considerations

The signing key is the whole system. It stays in the key service; a process that
could hold it could mint entitlement for any org, for any product, forever.

An unauthenticated verify address is deliberate and is an oracle: anyone holding a
token can learn whether it is currently valid. That is the same fact the token's
own signature already discloses to its holder, so the exposure is bounded — but it
does mean the address MUST NOT be extended to answer anything about tokens the
caller does not already hold.

Download is gated on a valid license rather than on a session, so a leaked token is
a leaked artifact. Binding is what bounds that: a token that verifies only against
one install is worth much less when copied.

Expiry is the control that still works when revocation does not. Token lifetimes
SHOULD be set on the assumption that the revocation list may not have reached every
replica.

## References

- HIP-0135 — What Is Public

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
