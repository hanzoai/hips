---
hip: 1022
title: Native Balance Reads
author: Hanzo AI
type: Standards Track
category: Interface
status: Draft
created: 2026-08-20
requires: HIP-1020
---

# HIP-1022: Native Balance Reads

## Abstract

`tokens` answers one question about an account on a declared chain: how much of
that chain's own currency it holds, as the chain itself reports it.

It is named for a family it deliberately does not serve. Enumerating an
address's fungible positions, and enumerating its non-fungible ones, are
questions no chain answers in a single call — they are indexer questions, and
the indexer relationship belongs to a different capability. This HIP is mostly
about why that refusal is better than a route that returns an empty list.
Implementation: `apps/web3` in `hanzoai/cloud`.

## Motivation

A wallet surface needs a balance, and the deployment already holds the upstream
(HIP-1020). The temptation is to make the same surface answer "and what else
does this address hold", because that is what a wallet shows. Doing it over
plain RPC means walking a token list and calling each contract — which returns a
number that silently omits whatever the list missed. A caller cannot tell that
answer from a complete one, so it is worse than no answer at all.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted
as in RFC 2119.

### 1. Declared chain, validated principal

Both rules are HIP-1020's and apply unchanged: the chain MUST be one the
registry declares (`apps/web3/web3.go:174`), and the caller MUST carry a
validated principal (`apps/web3/web3.go:167`). A balance read is an upstream
call, so it is spending the same budget the relay in HIP-1021 spends.

### 2. The address is checked before it becomes an upstream call

An address MUST be `0x` followed by forty hexadecimal digits
(`apps/web3/web3.go:359`), and a malformed one is refused locally
(`apps/web3/web3.go:341`). This is a cheap shape check, not a checksum
validation: it exists so a typo fails immediately instead of becoming an
upstream round trip that fails slowly.

### 3. The balance is the chain's own quantity, verbatim

The value is returned as the `0x`-quantity string the RPC returned
(`apps/web3/web3.go:322`). It MUST NOT be converted to a floating-point number,
and SHOULD NOT be rendered as a decimal by this capability: a wei value does not
survive a float64, and choosing a decimal place means knowing a denomination the
registry does not declare. Callers convert with a big-integer type, at the point
where they also know what they want to display.

### 4. A balance is a fact or it is not

If the chain does not answer, or answers something that is not a quantity, the
read FAILS (`apps/web3/web3.go:346`). It MUST NOT report zero.

This is the deliberate opposite of HIP-1020 §3, where a chain that will not
answer still describes itself with `live: false`. The difference is what the
zero would mean: for a height it is a real value on a fresh chain and absence
is the honest encoding, and for a balance it is the difference between an empty
account and an unanswered question — which is the difference between showing
someone their wallet and showing them somebody's idea of it.

### 5. What this capability refuses, and why

- **Enumerating fungible positions.** There is no chain call that answers "every
  token this address holds" (`apps/web3/web3.go:327`). An answer assembled from
  a token list is incomplete by exactly the amount the list is out of date, and
  nothing in the response says so.
- **Non-fungible holdings.** Ownership and metadata are not one chain call
  either (`apps/web3/web3.go:22`). A route returning an empty list forever would
  look like a feature and be a lie.
- **Historical balances.** The read is at the chain head. A read at a past block
  is an archive capability (`apps/web3/web3.go:344`), and the registry declares
  nothing about whether an upstream retains history — so this capability MUST
  NOT offer a block parameter that a declared chain may silently fail to honour.

The remedy for the first two is an indexer, and a capability that owns an
indexer relationship may answer them. It is not this one, and it MUST NOT be
made to look like this one by adding a field here that is populated sometimes.

## Rationale

The alternative to refusing is a best-effort list with a `partial: true` flag.
It fails in the way optional honesty always fails: the flag is read by whoever
implemented the client carefully and by nobody else, and the surface that
matters — a wallet page — renders the same either way. Refusing keeps the
guarantee simple enough to hold: everything this capability returns is a value
the chain itself proved.

The alternative to returning a string is returning a number, which is what every
caller wants until the first account holds more than about nine quadrillion of
anything.

## Security Considerations

An address is public and a balance is public, so there is nothing here to leak
between tenants; the principal check exists for the upstream's sake, not the
data's.

The shape check on the address bounds what this capability will put into an
upstream call on a caller's behalf. It is not sanitisation — the value travels
as a JSON parameter, not as a path or a query — but it keeps an arbitrary
caller-supplied string from reaching a chain as an address-shaped argument.

The refusals in §5 are a security property as well as an honesty one: a caller
who believes an incomplete holdings list is complete will act on it, and this
capability would have supplied the belief.

## References

- HIP-1020 — Chain Registry
- HIP-1021 — Chain JSON-RPC Endpoint

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
