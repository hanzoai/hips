---
hip: 1020
title: Chain Registry
author: Hanzo AI
type: Standards Track
category: Interface
status: Draft
created: 2026-08-20
requires: HIP-0106
---

# HIP-1020: Chain Registry

## Abstract

`chains` is the capability that says which chains a deployment can reach, and
whether one of them is answering right now. Those are two different facts and it
keeps them apart: a chain is *configured* by an operator and *live* only if its
upstream replies.

It is the admission list for the other two chain capabilities — `rpc`
(HIP-1021) and `tokens` (HIP-1022) accept exactly the ids that appear here, and
nothing else. Implementation: `apps/web3` in `hanzoai/cloud`.

## Motivation

A chain plane can get its chain list from three places: a table compiled into
the binary, a public directory fetched at boot, or the operator. The first two
produce a list that claims reachability the deployment does not have, and both
end in a silent fallback to a public endpoint — which means a customer's traffic
leaves the estate without anybody choosing that. The operator is the only party
who knows which upstreams this deployment actually holds, so the operator is the
only source.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted
as in RFC 2119.

### 1. The registry is declared, never guessed

A chain is `{id, name, chainId, rpc}`. The set of them is deployment
configuration, read once at mount (`apps/web3/web3.go:93`).

- A malformed registry MUST fail the mount rather than serve an empty one. An
  operator who wrote the variable meant to configure chains, and a typo that
  surfaces at the first request is the slowest possible way to learn about it.
- A chain declaring no upstream MUST fail the same way
  (`apps/web3/web3.go:129`). It would otherwise mount cleanly and refuse every
  request forever.
- An empty registry is LEGAL and means *this deployment reaches no chains*. The
  capability still mounts and answers honestly with an empty list.
- There MUST be no fallback upstream. An id that is not declared is refused
  (`apps/web3/web3.go:174`); it is never quietly served from somewhere else.

Ids fold to lower case on both write and read (`apps/web3/web3.go:125`,
`apps/web3/web3.go:175`), so one chain has one name.

### 2. The upstream address is not part of the record

The `rpc` field is unexported and therefore unserializable
(`apps/web3/web3.go:70`). It routinely carries a provider key in its path, and
the chain record is read by a browser. `TestRegistryNeverLeaksTheUpstream`
(`apps/web3/web3_test.go:88`) fails on any encoding that puts it on the wire.

### 3. Configured and live are different answers

Describing one chain reports whether its upstream answered a head read, and the
height it reported.

- An unreachable chain MUST still describe itself, with a success status and
  `live: false` (`apps/web3/web3.go:226`). The chain is configured, which is
  true whether or not it is up, and refusing here would turn a console page into
  an error for a chain that is merely offline.
- The height MUST be omitted when the chain did not answer, never reported as
  zero (`apps/web3/web3.go:219`). Zero is a real height on a fresh chain, so
  absence is the only encoding of "unknown" that does not lie.

### 4. The record carries only what was declared

`id`, `name` and `chainId`, and nothing further. `chainId` is the EIP-155 value
so a caller can check that the chain matches the wallet it is about to sign with
(`apps/web3/web3.go:68`). Token lists, explorer links and iconography are not
here: none of them is a fact this capability can check against the chain, and a
field a deployment cannot verify is a field it will eventually publish wrongly.

### 5. Reading requires a validated principal

Every read is gated on one (`apps/web3/web3.go:167`). A chain is a public
ledger, so there is no per-org row to protect — the boundary exists because this
list is the discovery step for the relay HIP-1021 describes, and an anonymous
caller MUST learn nothing about the upstreams a deployment holds.

## Rationale

The alternative is a built-in registry with a public-endpoint fallback, and it
is attractive because it makes a deployment work with no configuration. What it
costs is the property this capability exists to have: the list a caller reads is
exactly the set the deployment can serve. With a fallback, the list becomes a
claim about the public internet, an outage moves a customer's traffic to an
upstream nobody chose, and the failure is invisible because everything keeps
answering.

## Security Considerations

The declared upstream is a credential-bearing URL. It is unserializable by
construction rather than by a filter someone maintains, because a filter is one
refactor away from being forgotten.

A registry that could be extended at request time would let a caller point this
deployment's outbound requests at an address of their choosing. It cannot be:
the registry is fixed at mount, and an undeclared id is refused rather than
dialled.

## References

- HIP-0106 — Hanzo Plugin Contract
- HIP-1021 — Chain JSON-RPC Endpoint
- HIP-1022 — Native Balance Reads

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
