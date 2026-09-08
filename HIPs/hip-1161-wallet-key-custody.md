---
hip: 1161
title: Wallet — Custody of Key Material
author: Hanzo AI
type: Standards Track
category: Core
capability: wallet
status: Final
implementation-go: shipped
created: 2026-08-20
requires: HIP-0026, HIP-0106, HIP-0139
---

# HIP-1161: Wallet — Custody of Key Material

## Abstract

`/v1/wallet` is blockchain key custody: create accounts and wallets, rotate
their key material, and sign with them. One custody seam, four interchangeable
signing backends selected per wallet by its `Kind`, and the recipient side of
x402 — a priced listing's payee resolves to a wallet here and settlement
credits that wallet's ledger subject. The implementation is `hanzoai/cloud`
`apps/wallet`.

## Motivation

Every product that touches a chain needs a signing key, and each grows its own
custody unless one exists: a key in this service's env, a mnemonic in that
one's store — every copy a place the key can leak, and no two with the same
rotation story. One custody capability, with the backend a per-wallet fact,
means "who can sign" has one implementation to audit and swapping a wallet
from a single KMS key to an m-of-n quorum is a row change, not a migration.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted
as in RFC 2119.

### §1 The store

One SQLite store, `wallet` (`apps/wallet/store.go:31`), holds every tenant's
accounts and wallets; isolation is the `org` column on every row, enforced in
the store itself — a wallet fetched for a different org returns not-found
there, not in the handler, so the boundary lives in one place. Private key
bytes are never rows in it: KMS-custody keys are sealed under the KMS
envelope, and MPC-family wallets hold no local key material at all.

### §2 The address

Every route is under `/v1/wallet` (`manifest/apps.go:173`): eight operations,
all typed — accounts (create, list), wallets (create, list, get), key
rotation, signing, and transactions. One plane op, `/wallets/payee`, publishes
payee resolution to the process that settles (`apps/wallet/rpc.go`): the
lookup is scoped to the org the caller acts for exactly as every other read
is, and not-found is an answer rather than an error, because a listing naming
somebody else's wallet must produce it and a retry will not change it.

### §3 The custody seam

`Kind` selects the backend, and swapping a wallet's custody is a config value
on one row, not a code path (`apps/wallet/custody.go`):

- `kms` — in-process single-sig via the embedded `luxfi/kms` client. The
  fully-exercised spine: a real secp256k1 key, sealed private bytes, every
  Sign recovers to the wallet address.
- `mpc`, `treasury`, `safe` — thin typed HTTP clients of the deployed
  `luxfi/mpc` cluster. cloud MUST NOT import that module (it drags its whole
  server stack into the binary); it is a faithful client of the real service.

When the cluster is not configured those Kinds MUST fail closed
(`ErrMPCNotConfigured`); a signature is NEVER fabricated. The same rule holds
at the treasury anchor seam (`apps/wallet/anchor.go`): when ring custody is
absent the anchor keeps its KMS signer rather than inventing one. Cluster
credentials are KMS references in config (`CLOUD_WALLETS_MPC_API_KEY_REF`),
never plaintext values.

### §4 Tenancy

Every handler derives the tenant through the validated principal
(`principal.Org` / `principal.Acting`) and refuses with 403 when it is absent
(`apps/wallet/wallets.go:14`). On the plane op the org rides the capability:
x402 acts for the publisher of the listing, an org read off the listing row
and never off the buyer's request, so a buyer cannot redirect a credit over a
socket for the same reason it could not in memory.

### §5 Money, events, telemetry

The surface is METERED (`plugin/wallet/main.go:28`, `Price: cloud.Metered`),
and CUSTODY IS THE PREDICATE: an act under `kms` custody is an in-process
keygen that buys nothing and stays free, while the three acts that leave for
the ring are each one charge — a keygen at the fleet's ordinary provision fee
(under Safe custody it also deploys a contract with real gas), a signing
round and a proposal at one cent each by default. The knobs are
`CLOUD_WALLETS_FEE_CENTS[_KEYGEN|_SIGN|_PROPOSE]`, zero making an act free
and un-gated; the gate runs before the act and the debit lands only after it
completed (`apps/wallet/meter.go`). The money it moves is other
capabilities' — it is where x402's credits land, not where a listing's charge
originates.

It publishes nothing on the bus; a customer's webhooks receive no `wallets.*`
events. Beyond the request span, wallet mutations append an audit record
(resource type `wallet`, redacted after-image) through the shared recorder,
best-effort (`apps/wallet/wallets.go:839-855`).

### §6 Upstream

`github.com/luxfi/kms` v1.12.22 and `github.com/luxfi/crypto` v1.20.5 (both
Lux Ecosystem License 1.2) are embedded — envelope custody and
secp256k1/Keccak respectively. `luxfi/mpc` is a deployed service spoken to
over HTTP, not a dependency. Persistence is `github.com/hanzoai/sqlite`
(MIT / Apache-2.0 dual).

### §7 Stage

`beta`: the manifest row declares it (`manifest/apps.go:173`, `Stage: Beta`),
so the surface is reached by flag until promoted (HIP-0139 §8). Settlement
(HIP-1163) resolves its payees here, so custody promotes when the money plane
does.

## Rationale

Four backends behind one interface, rather than one custody per product, is
what keeps "which quorum signs" a row-level fact. The alternative — importing
the MPC implementation — was measured and refused: it fuses another service's
server stack into this binary, and the seam's whole value is that cloud stays
a client of the deployed cluster it does not operate.

## Security Considerations

The wrong implementation signs with another tenant's key. The org filter
living in the store (§1) rather than in each handler is the defense: a handler
that forgets is answered not-found, not with a row. The second failure worth
naming is the fabricated signature — a backend that "helpfully" falls back
when the cluster is down turns an outage into an unauthorized signing
authority, which is why every unconfigured Kind fails closed (§3). Third,
config carries KMS references, never secret values: a copy of the environment
is not a copy of the ring's API key.

## References

- HIP-0026 — Identity and Access Management
- HIP-0106 — Hanzo Plugin Contract
- HIP-0139 — Capability
- HIP-1163 — x402 — Pay Per Request

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
