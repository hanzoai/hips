---
hip: 1163
title: x402 — Pay Per Request
author: Hanzo AI
type: Standards Track
category: Core
capability: x402
status: Final
created: 2026-08-20
requires: HIP-0026, HIP-0106, HIP-0139
---

# HIP-1163: x402 — Pay Per Request

## Abstract

x402 is pay-per-request over HTTP 402: quote a price, take the payment, serve
the resource. It speaks x402 protocol version 2 — challenge, EIP-3009
`transferWithAuthorization` signed over the advertised terms, verify, settle
exactly once, serve — native to the cloud binary. It is a rail and nothing
else: the marketplace declares what is priced and who is paid, wallets says
where the money lands, and this capability enforces. The implementation is
`hanzoai/cloud` `apps/x402`.

## Motivation

A marketplace where agents buy tools and data per call needs a payment that
works without an account relationship: the buyer may be a client that has
never heard of the seller, and the price may be a fraction of a cent. HTTP 402
with a signed transfer authorization is the shape that fits — the challenge
carries the terms, the retry carries the proof, and no session, invoice or
card vault sits between them. What it demands in exchange is exactness:
replay, double-settlement and misdirected credit are all one-request attacks
if the rail is loose anywhere.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted
as in RFC 2119.

### §1 The wire is the spec's, not ours

The protocol is x402 version 2 as specified by `x402-foundation/x402`
(`specs/x402-specification-v2.md` and its HTTP transport binding). Every field
name, header name and error reason on the wire MUST be the one the
specification prints (`apps/x402/protocol.go`): the wire is a contract with
other people's clients, and a client that has never heard of Hanzo must be
able to pay us. The version is a number on the wire (`x402Version: 2`) and the
only thing that decides how a message is read — a wire whose shape depends on
an operator flag is two wires. One scheme (`exact`), one transfer method
(EIP-3009); signature verification is secp256k1 recovery over the EIP-712
domain the challenge itself stated. The default settlement network is
`eip155:36963`, the Hanzo L1, matching wallets.

### §2 The store, and settle-once

One SQLite store, `x402` (`apps/x402/store.go:55`): one row per claimed
authorization, keyed by a deterministic id derived from (payer address,
nonce). That id is both the replay-dedup key — a primary key, so a second
insert of the same authorization is atomically refused — and the idempotency
ref on both money writes, so the fast in-pod dedup and the ledger's own
idempotency agree on one key. A row is written at claim and flipped at settle;
an interrupted settlement is recoverable because the claim names payer, payee,
amount and the payee's ledger subject, and startup `Reconcile` completes
anything the last process left in doubt (`apps/x402/x402.go:181`). The payee
subject is on the row and MUST NOT be re-resolved at completion time — a claim
has to be sufficient on its own, or the sweep silently pays whatever the
wallet resolves to later.

### §3 The address, and the three callers

The addressed surface is one typed operation, `GET
/v1/x402/settlements/{id}` (`manifest/apps.go:174`) — the receipt lookup,
scoped by `principal.Ledger`, which folds in the SuperAdmin masquerade so an
admin inspecting another org still reads their own settlements
(`apps/x402/x402.go:791`). The flow itself is written once (`run`) and reached
three ways: `Enforce`, a handler a priced route group applies; `Settle`, the
same flow for a resource named in a request body; and the plane op
`/x402/settle` for the fleet's one-binary-per-app shape, where the payer is
the caller's org resolved at the edge and never a field
(`apps/x402/rpc.go`). On the plane the outcome is data, not a transport error
— a 402 carries the terms the client must read to pay — so a transport error
means the rail did not answer, and callers fail closed on it, never free.

### §4 Money

The surface declares `cloud.Free` (`plugin/x402/main.go`): the rail itself
charges nothing per request. The money it moves is the settlement — a payer
debit through the metering spine under provider label `x402` with the
settlement id as `Ref` (`apps/x402/x402.go:732`), which is how paid usage
appears in billing/usage like any metered spend, and a payee credit deposited
into the ledger subject of the wallet the publisher's listing named, resolved
through wallets (HIP-1161). What a resource costs is the marketplace
registry's table; when the price cannot be learned the answer MUST be an
error, never "free" — a rail that reads its own outage as "nothing is priced"
sells the whole catalogue for nothing (`apps/x402/peer.go`). Unknown payee is
503; unreachable ledger is no settlement, no receipt, no dispatch.

### §5 Events and telemetry

It publishes nothing on the bus; a customer's webhooks receive no `x402.*`
events. Beyond the request span, each settlement appends an audit record
(resource type `x402.settlement`, redacted; `apps/x402/x402.go:899`), and the
startup reconcile logs what it completed.

### §6 Upstream

It implements the x402 specification version 2 (`x402-foundation/x402`) — a
wire specification, not a code fork; no upstream implementation is embedded.
Signature recovery rides `github.com/luxfi/crypto` v1.20.5 (Lux Ecosystem
License 1.2), the same primitive wallets custody signs with. Persistence is
`github.com/hanzoai/sqlite` (MIT / Apache-2.0 dual).

### §7 Stage

`beta`: the manifest row declares it (`manifest/apps.go:174`, `Stage: Beta`;
HIP-0139 §8), reached by flag until promoted.

## Rationale

The alternative to a rail-plus-registry seam is a payments module inside each
priced subsystem. That is N copies of verify-and-settle, N nonce stores that
do not share a dedup key, and a marketplace that cannot price a resource
without shipping code into its owner. One rail, inert until a registry is
published, keeps enforcement in one place and pricing where the catalogue is.

## Security Considerations

The attacks are the classic payment ones, and each is closed structurally.
Replay: the (payer, nonce) primary key refuses a second claim atomically, and
the same id is the ledger's idempotency key, so even a bug in the fast path
cannot double-move money. Redirection: the payee org comes off the listing
row and the payer off the edge-resolved principal — neither is a request
field, so a buyer can neither choose who is paid nor who pays. Free-fall: the
priced set must fail closed (§4); the one exception this rail ever held —
reading an unreachable marketplace as "no marketplace, nothing priced" — is
recorded in `apps/x402/peer.go` as the defect that sold everything for
nothing, and is why the price has no exception now.

## References

- HIP-0026 — Identity and Access Management
- HIP-0106 — Hanzo Plugin Contract
- HIP-0139 — Capability
- HIP-1161 — Wallets — Key Custody

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
