---
hip: 0077
title: Mesh Identity, Gossip & Payments (PQ)
type: Standards Track
category: Infrastructure
status: Draft
author: Hanzo AI
requires: HIP-0001 (AI Coin), HIP-0005 (Post-Quantum Security), HIP-007 (ZAP), HIP-0018 (Payments), HIP-0069 (Service Discovery), HIP-0070 (Quantum Computing), HIP-0071 (Quantum Key Distribution)
---

## Abstract

HIP-0069 made every Hanzo service discoverable on the LAN via one mDNS
type. HIP-0077 layers three things on top so the mesh extends past the
broadcast domain and becomes a settlement substrate, end-to-end
post-quantum:

1. **Identity.** Every device, MCP, container, browser and node derives
   its keypair from a single HD mnemonic. The signing key is
   **ML-DSA-65** (NIST FIPS 204, the same primitive Lux consensus
   already uses for per-validator identity signatures). The
   ML-DSA-derived address rides in the mDNS TXT record; the ZAP
   handshake carries the full pubkey + a fresh signature over a
   server-supplied nonce; peers verify before accepting traffic.
2. **Gossip.** For cross-LAN propagation peers publish the same
   identity + capability record to the Lux consensus mesh on network
   `1337` (primary / dev) or whichever network the tenant pins. One
   read of the gossip set is equivalent to an mDNS browse, but
   globally.
3. **Payments.** The same identity is a Lux account. Any tool call on
   the mesh can carry a price; the consumer signs a promise; the
   provider signs a receipt; settlement happens on chain. The first
   200 device indices derived from the `LIGHT_MNEMONIC` are pre-funded
   in the network `1337` genesis from the P/X-chain LIGHT_MNEMONIC
   balance, so a fresh laptop or container joining the local mesh has
   working credit immediately — no manual top-up.

Net effect: one mnemonic in your environment, a hundred-plus devices
each with unique PQ identity and a balance, all discoverable and
billable across the LAN via mDNS and across the WAN via Lux
consensus, without any config file.

## Motivation

HIP-0069 solved discovery; it stopped there deliberately. After
shipping it four needs surfaced immediately:

- **mDNS does not cross subnets.** Browsing `_hanzo._tcp.local.` from
  a laptop on home wifi never sees the Hanzo Desktop on the office LAN
  or the bare-metal node in a datacentre. A small overlay is needed
  to relay records.
- **No identity verification.** Anyone on the same broadcast domain can
  advertise `role=kms` with a forged `server_id`. The TXT `auth=iam`
  field tells consumers what to expect, but does not bind the record
  itself to a key. A signed handshake fixes this.
- **No settlement.** Hanzo Containers and the HMM compute DEX
  (HIP-0008) both presuppose a way for one peer to pay another for
  work. The mesh already exposes the work as MCP tool calls; the
  missing piece is per-call billing keyed to the same device identity
  used for discovery.
- **No "just works" out of the box.** A new device joining the local
  network needs an account with balance before it can pay for
  inference, storage or any other priced call. Manual funding for
  every laptop / container / phone is friction we can remove with a
  genesis pre-allocation tied to the well-known dev mnemonic.

The cleanest answer reuses infrastructure that already exists:

- **Lux HD wallets** for deterministic key derivation.
- **ML-DSA-65** for post-quantum signatures, taken from
  `github.com/luxfi/pulsar/sign` and already wired into Lux consensus
  via `config.PQMode`.
- **Lux consensus** (Quasar family — `protocol/photon`, `wave`,
  `focus`, `prism`, `ray`, `field`, `quasar`) for cross-LAN gossip
  with BFT finality. Five PQ modes are available (see table below);
  the Hanzo mesh defaults to the strongest.
- **AI Coin** (HIP-0001) settled on the same accounts.
- **Genesis pre-allocation** native to the Lux node genesis tool.

No new chains, no new crypto, no new naming.

### Lux consensus PQ modes

`lux/consensus/config/pq_mode.go` exposes the full PQ design space
as five orthogonal modes. Every mode keeps BLS-12-381 as the
classical fast path; PQ layers stack on top. The names are picked
so each canonical mode is the sub-protocol that defines its
post-quantum surface.

#### The matrix

| `PQMode`         | env        | classical | threshold lattice                    | per-validator PQ      | rollup            | DKG required                            | suitable for open public chain? |
|------------------|------------|-----------|--------------------------------------|-----------------------|-------------------|-----------------------------------------|---------------------------------|
| `PQModeBLS`      | `bls`      | BLS       | —                                    | —                     | —                 | none                                    | no (no PQ)                      |
| `PQModeCorona` | `corona` | BLS       | Corona / **BLAKE3** (academic)     | —                     | —                 | trusted dealer                          | **no** (no DKG-with-rotation)   |
| `PQModePulsar`   | `pulsar`   | BLS       | Pulsar / **SHA-3 cSHAKE256** (prod)  | —                     | —                 | Pedersen DKG over R\_q + proactive resharing | yes                       |
| `PQModeQuasar`   | `quasar`   | BLS       | Pulsar / SHA-3                       | ML-DSA-65 (rolled)    | Groth16 / Z-Chain | Pedersen DKG over R\_q + proactive resharing | yes (**default**)         |
| `PQModeMLDSA`    | `mldsa`    | BLS       | —                                    | ML-DSA-65 raw         | —                 | none                                    | yes (audit-grade fallback)      |

Two production progressions:

```
public chains, open validator set:    BLS → Pulsar → Quasar
fixed federations / bridge MPC:       BLS → Corona
```

`MLDSA` is an audit-grade side path: every validator's raw
ML-DSA-65 sig in every cert (~N·3309 B). Use it transitionally if
the Z-Chain Groth16 witness isn't wired yet, or when an external
auditor needs the per-validator log.

#### Pulsar vs Corona — what's actually different

Both implement the same 2-round LWE threshold-signature **core
algorithm**. They diverge on the hash family and the production
lifecycle:

| dimension          | Corona (`github.com/luxfi/corona`) | Pulsar (`github.com/luxfi/pulsar`)                           |
|--------------------|----------------------------------------|--------------------------------------------------------------|
| canonical hash     | **BLAKE3** (academic upstream)         | **SHA-3 (cSHAKE256 / KMAC256 / TupleHash256, FIPS 202 + SP 800-185)** |
| DKG                | trusted dealer (fixed federation)      | Pedersen DKG over R\_q with proper hiding                    |
| validator rotation | none (re-run trusted dealer)           | proactive secret resharing (`pulsar/reshare/`)               |
| target deployment  | bridge MPC, audit, KATs                | open public chains (Lux primary network, Hanzo mesh)         |
| NIST profile?      | no (BLAKE3 not in FIPS 202 family)     | yes (every primitive in the FIPS 202 / SP 800-185 family)    |
| fork history       | upstream academic port                 | production fork that **will keep diverging** as protocol matures |

The modes are kept distinct on purpose: an open public chain that
reused Corona's trusted-dealer DKG would be unable to rotate its
validator set without a manual ceremony, and an audit fixture that
wanted byte-identical KATs against the academic spec needs the
BLAKE3 path. We treat them as first-class siblings, not as "old vs
new" — the helpers `PQMode.HashProfile()`, `PQMode.DKGRequired()`
and `PQMode.SuitableForPublicChain()` make the distinction queryable.

> **NIST submission posture.** The Pulsar SHA-3 profile is the only
> hash configuration eligible for any NIST-track submission (MPTC IR
> 8214C §4.6 lists the approved symmetric primitives: AES, Ascon, SHA-2,
> SHA-3, SHAKE/cSHAKE, HMAC/KMAC/CMAC/GMAC). BLAKE3 deltas, including
> `Pulsar-BLAKE3` legacy and Corona's BLAKE3 academic profile, are
> **product/experimental** profiles only. Pulsar keeps the BLAKE3 suite
> non-normative and marked "NOT for production"; Corona's BLAKE3
> profile is fixed-federation only and never intended for the Lux
> primary network.

#### Canonical `HashSuiteID` encoding

There is one canonical wire representation of the hash-suite identifier
across the Lux + Hanzo tree: a `uint8` byte, defined in
`lux/consensus/config/pq_mode.go` (and mirrored on the cert wire in
`lux/consensus/pkg/wire/candidate.go`). The currently-assigned values
are:

| byte   | name                    | meaning                                                          |
|--------|-------------------------|------------------------------------------------------------------|
| `0x00` | `HashSuiteNone`         | no hash-family commitment (BLS-only certs)                       |
| `0x01` | `HashSuiteSHA3NIST`     | FIPS 202 + SP 800-185 family (SHAKE256 / cSHAKE256 / KMAC256 / TupleHash256) — the normative production suite |
| `0x02` | `HashSuiteBLAKE3Legacy` | academic / federation-MPC profile; non-normative for NIST        |

`consensus/config.HashSuiteID` is the **single source of truth**. The
wire copy in `consensus/pkg/wire.HashSuiteID` is a structural mirror
for cert-envelope serialisation; downstream code MUST NOT define a
third encoding. The byte is bound into the cert transcript (see
`Certificate.TranscriptHash` and `quasar.computeRoundDigest`) so that
flipping the byte post-signing breaks signature verification, not just
a string-equality check.

The Warp 2.0 envelope (`lux/warp/envelope.go`) currently carries a
`HashSuiteID string` field defaulting to `"Pulsar-SHA3"`. This is a
**deprecated** parallel encoding inherited from the pre-pin era. It
MUST migrate to the canonical `uint8` form by the
**2026-Aug-31 encoding-freeze gate**:

- Producers SHOULD start emitting envelopes with the byte-form field
  (`HashSuiteID uint8`) in parallel during the transition window.
- Consumers MUST accept either form during the window and reject
  envelopes that disagree across the two forms.
- After 2026-Aug-31, the string form is removed; envelopes carrying
  only the legacy string field are rejected with
  `ErrEnvelopeBadSuiteID`. The default value `"Pulsar-SHA3"` maps
  exactly to `HashSuiteSHA3NIST (0x01)`; the legacy `"Pulsar-BLAKE3"`
  maps to `HashSuiteBLAKE3Legacy (0x02)`.

The migration MUST NOT change the value bound into the transcript hash
of any cert produced before the freeze; the wire layout changes, the
signed bytes do not.

#### Why exactly five modes

The orthogonal building blocks:

| block                                          | classical? | PQ? | cost                          |
|------------------------------------------------|------------|-----|-------------------------------|
| BLS aggregate                                  | ✓          |     | 48 B, pre-quantum only        |
| Threshold lattice (Corona OR Pulsar variant) |            | ✓   | O(1) post-DKG                 |
| ML-DSA-65 per validator                        |            | ✓   | linear in N                   |
| Groth16 rollup of ML-DSA → Z-Chain             |            | ✓   | ~192 B + verifier cost        |

Five practical modes cover the design space:

```
BLS only                                            = bls
BLS + Corona   (BLAKE3, trusted dealer)           = corona   (federations)
BLS + Pulsar     (SHA-3, Pedersen DKG)              = pulsar     (public-chain floor)
BLS + Pulsar + Z-Chain Groth16(ML-DSA)              = quasar     (default)
BLS + per-validator ML-DSA (no threshold)           = mldsa      (audit fallback)
```

The other on-paper combinations are redundant or strictly weaker:

- `BLS + per-validator ML-DSA + Groth16 rollup` — Groth16 already
  rolls the same ML-DSA sigs; emitting both wastes bandwidth for
  no extra cryptanalytic surface.
- `BLS + Groth16 rollup only` (no threshold) — strictly weaker
  than Quasar at the same cert size, since Quasar gets the
  threshold layer for free.
- `BLS + per-validator ML-DSA + Pulsar/Corona` — strictly
  dominated by Quasar at much larger cert size; `mldsa` already
  covers the no-Z-Chain transitional case.

Hence five modes. Constants are hard-renamed from the previous
`BLSPlusX` form per the forwards-only versioning policy. Aliases
that name actual components (`rollup`, `groth16`, `zk`, `bls-z`,
`z-chain`, `pulsar-z`, `bls-mldsa`, `bls-rt`, `academic`,
`sha3-rt`, …) parse to the right canonical mode; **counting words
(`triple`, `triple-quantum`, `double`, …) are rejected** because
they tell a caller nothing about what's signed.

#### Configuration

Three equivalent ways:

```go
// Explicit (any of the five modes):
params := config.DefaultParams().WithPQMode(config.PQModeQuasar)

// Boolean shorthand (collapses to extremes):
params := config.DefaultParams().WithPostQuantum(true)
// true  -> PQModeQuasar   (strongest available)
// false -> PQModeBLS      (classical)
// for the middle three (corona / pulsar / mldsa) call WithPQMode.

// Env override (highest priority, no rebuild needed):
//   LUX_CONSENSUS_PQ_MODE=quasar
mode, _ := config.PQModeFromEnv(config.PQModeQuasar)
```

`config.PQModeFromEnv` parses any canonical name or alias.

### PQ defaults for Hanzo mesh networks

Network `1337` (primary local / dev) and any tenant network minted
under HIP-0077 MUST default to `PostQuantum = true`
(= `PQModeQuasar`). Rationale:

- The mesh's identity layer already uses ML-DSA-65; the consensus
  layer running anything less than `Pulsar` would be a strictly
  weaker link in the same chain of trust.
- Corona keeps cert size O(1), so the cost of going from `Pulsar`
  to `Quasar` is one extra threshold signature per finality round
  — well inside the budget for a mesh that expects ms-grade
  finality on a few-dozen-validator quorum.
- Defense-in-depth: a future break of either ML-DSA or Corona
  (lattice cryptanalysis advance) does not lose the mesh; `Quasar`
  is the only mode that survives loss of one lattice primitive.

Operators with a hard latency budget MAY opt down to `Pulsar`
(threshold lattice only, no Z-Chain witness). Those needing every
validator's raw ML-DSA signature in the cert (auditor flow) MAY opt
sideways to `MLDSA` — at the price of N·3309 B per cert. They MUST
NOT opt down to `BLS` (no PQ surface) or `Corona` (trusted-dealer
DKG, unsuitable for an open validator set) while participating in
any production Hanzo mesh.

Decision tree for operators:

```
open public chain (epoch rotation, no trusted dealer)?
   no — fixed federation / bridge MPC
        → corona                  (academic BLAKE3, trusted dealer)
   yes ↓
   need any PQ?
     no  → bls                      (benchmark only; rejected on prod meshes)
     yes ↓
     need defense-in-depth (two lattice constructions)?
        yes → quasar                (Hanzo mesh default; degrades to mldsa if Z-Chain not wired)
        no  ↓
        need every validator's raw sig in the cert for audit?
          yes → mldsa               (per-validator ML-DSA, N*3309 B)
          no  → pulsar              (production threshold lattice, SHA-3, O(1) cert)
```

### Pulsar-M-65 production profile

Pulsar-M (the M-LWE / ML-DSA-compatible threshold variant) is
parameterised at the three FIPS 204 levels: `Pulsar-M-44`, `Pulsar-M-65`,
`Pulsar-M-87`. The per-use-case mapping is fixed:

| use case                                | profile        | rationale                          |
|-----------------------------------------|----------------|------------------------------------|
| Mainnet finality (per-block)            | Pulsar-M-65    | NIST PQ Cat 3, balanced            |
| High-value roots (governance, bridges)  | Pulsar-M-87    | NIST PQ Cat 5, low frequency       |
| Devnet / testnet / CI                   | Pulsar-M-44    | NIST PQ Cat 2, fast                |
| Audit / FIPS-only fallback              | raw ML-DSA-65  | single-party, FIPS 204 module      |
| Federation / bridge MPC                 | Corona       | trusted dealer, no DKG cost        |

`Pulsar-M-65` is the public-chain default. `Pulsar-M-87` is reserved
for roots that ship at epoch / governance / bridge cadence (low TPS,
high value). `Pulsar-M-44` is **forbidden on the Lux primary network
and any production Hanzo mesh** — devnet / CI only — because Category 2
is below the floor Hanzo commits to for any chain that anchors real
balances.

The fallback profiles (`raw ML-DSA-65` and `Corona`) MUST NOT be
silently substituted for the Pulsar-M production profile on a public
chain. They are explicit operator opt-ins, gated through the existing
`PQMode` selection (`mldsa` and `corona` respectively).

## Specification

### Identity

Every device in the mesh derives its key material from one mnemonic
in priority order: `MNEMONIC` > `LUX_MNEMONIC` > `LIGHT_MNEMONIC`. The
last is the public dev fallback
(`"light light light light light light light light light light light energy"`)
used on network-id `>= 1337`. Production deployments MUST set
`MNEMONIC`.

The mnemonic produces a master seed via BIP-39 → BIP-32. From that
seed two parallel keypairs exist for each device index `n`:

| derived              | path                              | curve / scheme   | use                                                      |
|----------------------|-----------------------------------|------------------|----------------------------------------------------------|
| `device_pq_key[n]`   | `m / 44' / 9000' / nid' / 0 / n`  | ML-DSA-65        | Mesh identity: TXT address, handshake & receipt signing  |
| `device_lux_key[n]`  | `m / 44' / 9000' / nid' / 1 / n`  | secp256k1        | Lux account: AI Coin balance, on-chain settlement        |

- `9000'` is the Lux SLIP-44 coin type.
- `nid'` is the Hanzo mesh network id (`1337'` for the primary local
  mesh; other values for tenant clusters).
- Branch `0` (PQ signing) and branch `1` (Lux account) keep mesh keys
  separate from spend keys.
- The ML-DSA-65 keypair is deterministically expanded from the BIP-32
  child seed via `SHAKE-256(seed)` → ML-DSA keygen RNG, per the
  procedure in `lux/crypto/mldsa` (single source of truth).

Per device:

| value             | derivation                                                      |
|-------------------|-----------------------------------------------------------------|
| `mldsa_pubkey`    | verify key of `device_pq_key[n]` (~1952 B)                      |
| `mldsa_address`   | `RIPEMD-160(SHA-256(mldsa_pubkey))` → 20 bytes, hex-encoded     |
| `lux_address`     | standard Lux account derivation from `device_lux_key[n]`        |

The 20-byte `mldsa_address` is the short identifier carried in mDNS;
the full pubkey is exchanged at handshake time where size doesn't
matter.

### mDNS TXT changes

HIP-0069's TXT record gains ONE REQUIRED key for `auth != none` roles
and OPTIONAL for `auth=none`:

| key       | example                              |
|-----------|--------------------------------------|
| `mldsa`   | `<40-hex-char address>`              |

We deliberately do NOT put a per-record ML-DSA signature in TXT —
ML-DSA-65 signatures are ~3309 bytes, hostile to multicast. Binding
is established at handshake time instead (next section). The TXT
`mldsa` field is a public commitment: a server forging a stranger's
address can't complete the handshake (doesn't have the private key);
a server using its own address is just a regular new peer.

### ZAP handshake

`MSG_HANDSHAKE_OK` from the server now carries a 32-byte random
`nonce`. The client follows with a new message:

```
MSG_AUTH = 0x03
payload = {
  pubkey:  <ML-DSA-65 verify key, base64>,
  sig:     <ML-DSA.Sign(device_pq_key, server_id || nonce || client_role)>,
}
```

Server verifies:

1. `RIPEMD-160(SHA-256(pubkey)) == TXT.mldsa`  (or, for inbound peers
   discovered via gossip, against the gossip record's address).
2. `ML-DSA.Verify(pubkey, server_id || nonce || client_role, sig)`.

Either check failing → server closes the socket. For roles with
`auth=none` (`static`, `gateway` brochures) the auth round is
SKIPPED entirely and any anonymous client is accepted.

This adds one round-trip on connect and one ~3.3 KB frame; for a
long-lived ZAP session that's negligible.

### Gossip — Lux consensus overlay

Every device that wants to be reachable beyond its LAN runs a Lux
consensus light client and publishes one record per role into a
well-known namespace on network `<nid>`:

```
namespace:  hanzo/mesh/v1/<nid>/<org>
key:        <mldsa_address>/<role>/<server_id>
value:      {
    addrs:        ["wss://hostname:port/", "..."],
    proto:        "zap/1",
    capabilities: ["mcp","browser-bridge","..."],
    version:      "1.2.3",
    pubkey:       <ML-DSA-65 verify key>,
    expires_at:   <unix-seconds>,
    sig:          <ML-DSA.Sign over canonical fields>,
}
```

Discovery rule:

- **Local first.** Always browse `_hanzo._tcp.local.` for ≤ 2 s.
- **Then gossip.** Pull the namespace once at startup, then subscribe
  for deltas (Lux consensus's standard subscription path — `wave`
  deltas committed under the `field` driver).
- **Dedup by `mldsa_address`.** If the same address shows up on both
  LAN and gossip, prefer the LAN address (lower latency, smaller
  billed bytes).

`expires_at` MUST be ≤ 5 minutes from publish; a peer refreshes its
record well before expiry. The consensus pruner drops expired
entries so the namespace stays bounded.

Use of consensus is intentional: the records are state that we want
ordered, verifiable, and resistant to partition. We are not building
a new gossip layer.

### Auto-funding the first 200 devices

The Lux node genesis builder for network `1337` (and any other mesh
network that opts in) MUST pre-allocate balance to the first 200
addresses derived from `LIGHT_MNEMONIC` on the **Lux** branch
(`device_lux_key[0..199]`). Allocation tables:

| chain | source                                            | per-address allocation     |
|-------|---------------------------------------------------|----------------------------|
| P     | LIGHT_MNEMONIC P-chain genesis balance × 0.001    | 1 000 LUX (testnet units)  |
| X     | LIGHT_MNEMONIC X-chain genesis balance × 0.001    | 1 000 LUX (testnet units)  |
| C     | LIGHT_MNEMONIC C-chain (EVM) balance × 0.001      | 1 000 LUX (testnet units)  |

Numbers are per-network parameters; the table above is the network
`1337` default. Real production networks pick their own.

Why 200: empirically covers "one developer's fleet" — laptop,
desktop, phone, ~10 dev containers, ~10 browsers, plus headroom for
short-lived ephemeral containers. Past 200, devices fund themselves
from one of the funded principal accounts via standard Lux transfers
— still automatic, but on-chain.

Implementation lives in `lux/genesis` and is invoked once at network
boot. Sibling tooling in `hanzo-cli`:

```
$ hanzo dev fund-status
device  lux_address                                  balance
0       lux1qzv...3kx                                1000.0 LUX
1       lux1qd9...8mq                                1000.0 LUX
…
199     lux1qy7...0aw                                1000.0 LUX
```

A device pulls its index from `HANZO_DEVICE_INDEX` (default `0`,
distinct per machine via container UUID hash mod 200). On first
boot it queries its own balance; if zero, it transfers from a
sibling-funded device or surfaces a clear "you've exceeded the
auto-funded set, top up" error.

### Payments

Each MCP tool MAY advertise a price in its description object:

```json
{
  "name": "engine.completion",
  "description": "...",
  "inputSchema": {...},
  "price": { "unit": "1_token_in_out", "currency": "AI", "amount": "0.0001" }
}
```

Currency is HIP-0001 AI Coin by default; tenant clusters MAY use other
Lux-native assets.

Call protocol:

1. Consumer issues `tools/call` with a `payment` field carrying a
   signed *promise* — `{ from_lux, to_lux, max_cost, nonce,
   mldsa_sig }` — payable on settlement.
2. Provider runs the tool, computes actual cost (within `max_cost`),
   returns the result plus a *receipt* — `{ promise_hash,
   actual_cost, mldsa_sig }` signed by `device_pq_key`.
3. Either party MAY submit the (promise, receipt) pair to the
   payments contract on network `<nid>`. The contract verifies both
   ML-DSA signatures and transfers `actual_cost` from `from_lux` to
   `to_lux`.

For sub-cent calls the receipt sits in a buffer; the provider
batches receipts and submits one settlement transaction per epoch
(amortising the on-chain cost across thousands of calls). HIP-0018
defines the wider payments surface; this section pins the receipt
shape to MCP tool calls specifically.

Refunds, disputes, and slashing for forged receipts: see HIP-0018.

### AI mining

A device that wants to monetise spare compute publishes an MCP role
(`role=engine`, `role=node`, etc.) advertising prices below market.
HMM (HIP-0008) reads the gossip namespace and routes inference jobs
to the cheapest verified peer matching the request's capability set.
Verification is via the same receipt mechanism: the provider's
ML-DSA signature on the (input, output) pair is sufficient for
honest clients; clients suspecting a Byzantine provider may run a
quorum of three peers and slash any minority answer.

### Containers as the compute unit

Zoo/Hanzo Container runtime (`hanzoai/container`) MUST, at boot:

1. Derive its `device_pq_key` and `device_lux_key` using
   `<device_index>` = the container's stable UUID hashed to a u32
   (mod 200 for the auto-funded slot; or > 200 if the orchestrator
   pre-allocated).
2. Publish via `_hanzo._tcp.local.` on the host network and (if the
   network policy allows) gossip.
3. Sign every `tools/call` receipt with `device_pq_key`.

When the container exits cleanly, it withdraws its gossip record;
when it crashes, the `expires_at` window evicts it within 5 minutes.

### Backwards compatibility

A peer advertising HIP-0069 TXT without `mldsa` SHALL be accepted by
HIP-0077 consumers when `auth=none`, refused when `auth` is anything
else. By 2027-Q1 unsigned (in the handshake sense) peers SHOULD be
refused for every role.

The on-chain gossip namespace and the auto-funding pre-allocation
are pure additions; no breaking change to existing Lux clients.
Devices opting out of gossip remain visible on their own LAN only —
degraded but functional.

## Reference implementation

Per language, one new module sits beside the HIP-0069 binding:

| layer        | package                                                       |
|--------------|---------------------------------------------------------------|
| Identity     | `hanzo-zap-identity`     (Python, TS, Go, Rust, Swift)        |
| Gossip       | `hanzo-zap-gossip`       (thin client over `luxfi/consensus`) |
| Payments     | `hanzo-zap-pay`          (consumer + provider helpers)        |

Genesis tooling: `lux/genesis` gains a `--hanzo-auto-fund` flag for
network builders that pre-allocates the first 200 device addresses.

`hanzo-mcp` MUST import all three runtime bindings; non-MCP roles
MAY import only the subset they use (a static-asset server doesn't
need payments).

Reference repos: `~/work/zap/identity`, `~/work/zap/gossip`,
`~/work/zap/pay`. ML-DSA-65 primitive is reused from
`~/work/lux/crypto/mldsa` — exactly one ML-DSA implementation in
the Hanzo + Lux tree.

## Security considerations

- **Mnemonic blast radius.** One mnemonic keys every device. Loss
  means total compromise. The `MNEMONIC` env var MUST come from KMS
  in production deployments; never plaintext on disk. The
  `LIGHT_MNEMONIC` is public-by-design and used only on dev /
  primary local networks.
- **Handshake replay.** TXT `mldsa` is a static address; a sniffed
  TXT is not exploitable because the connecting peer must produce a
  fresh ML-DSA signature over the server-supplied nonce. Roles with
  `auth=none` (`static`, `gateway` brochures) skip auth because
  nothing sensitive is exposed.
- **Receipt forgery.** A provider could over-bill via a fake receipt.
  Receipts are ML-DSA-signed by the same key that signed the
  discovery handshake, so the consumer can refuse and the on-chain
  contract rejects unsigned receipts. For high-value calls, the
  consumer SHOULD request a quorum.
- **Gossip spam.** A malicious peer could flood the namespace with
  bogus records. Lux consensus rate-limits per account at the
  protocol level; per-`mldsa_address` write-throttle is applied
  during the `wave` voting round.
- **Network-id confusion.** `1337` is reserved for dev. Production
  tenants MUST use a network-id assigned by the Hanzo registry.
  Consumers SHOULD pin `nid` at startup; cross-network bridging
  requires explicit operator opt-in.
- **Auto-funded blast radius.** The first 200 LIGHT_MNEMONIC indices
  are publicly known; their balances on network `1337` are
  testnet-only and have no value beyond the dev mesh. Production
  networks MUST NOT pre-allocate from a public mnemonic.
- **PQ-only path.** Per HIP-0005, classical schemes (Ed25519, BLS
  alone) MUST NOT appear in the handshake-auth or receipt-signing
  path. ML-DSA-65 is the single primitive. BLS may continue to
  appear in consensus aggregation per Quasar `PQModeBLSPlusMLDSA`.

## Adoption order

1. Identity-only: `hanzo_zap_mdns.publish` ships ML-DSA address in
   TXT (small change). Consumers log-but-accept missing addresses for
   one release, then enforce.
2. Handshake: ZAP server + client gain the AUTH step. Roll out
   server-side first (accept-anonymous), then client-side (always
   sign), then make server-side reject anonymous for auth-required
   roles.
3. Genesis pre-fund: land in `lux/genesis` for network `1337` and any
   new tenant network being launched after this date.
4. Gossip: `hanzo-mcp`, `hanzo-desktop`, `hanzo-node` add the Lux
   light client.
5. Payments: `hanzo-engine` first (highest call volume); HMM routes
   real load through receipts; remaining roles enable as priced APIs
   come online.
6. Containers: `hanzoai/container` gains the boot-time identity step;
   downstream zoo / hanzo deployments inherit automatically.

Each step is a 5-to-30-line change in the service's startup path,
mirroring the HIP-0069 adoption shape. One mnemonic, three bindings,
six steps.

## NIST process posture

NIST does three separate things; conflating them produces wrong
expectations:

| process | what it does for us | reality in 2026 |
|---|---|---|
| FIPS PQC standardization (FIPS 203/204/205/206/207, SP 800-208) | algorithm becomes a NIST-approved primitive | See per-standard table below. ML-DSA-65 (FIPS 204) and SLH-DSA (FIPS 205) are the two FIPS-final PQ signatures today; XMSS / LMS (SP 800-208) cover the stateful-HBS lane. |
| MPTC threshold call (NIST IR 8214C) | threshold schemes submitted as reference material for public analysis | **active now.** IR 8214C published January 2026. First-call package deadline expected 2026-Nov-16; preview writeup deadline 2026-Jul-20. 26 first-round preview writeups already submitted from 23 teams. |
| CAVP / CMVP | a specific module implementing approved algorithms is FIPS 140-3 validated | unchanged. CMVP requires an applicable approved standard + an ACVP / CAVP test path. A non-standard threshold variant cannot ride this lane until NIST creates an applicable approved threshold standard. |

NIST PQC standardisation snapshot (2026-05):

| standard | algorithm | role | status |
|---|---|---|---|
| FIPS 203 | ML-KEM (formerly Kyber) | KEM | final, August 2024 |
| FIPS 204 | ML-DSA (formerly Dilithium) | signature | final, August 2024 |
| FIPS 205 | SLH-DSA (formerly SPHINCS+) | signature, hash-based | final, August 2024 |
| FIPS 206 | FN-DSA (formerly Falcon) | signature | IPD published 2025-10; public-comment period closed 2026-01; final draft pending |
| FIPS 207 (planned) | HQC-KEM | KEM, code-based backup to ML-KEM | selected 2025-03; draft expected 2026-2027 |
| SP 800-208 | XMSS / LMS (stateful HBS) | signature, hash-based | final; approved with stateful-key-management caveats |

### Per-mode NIST positioning

| Pulsar-M (M-LWE) | target Class N1 (signing) + N4 (ML keygen / DKG) — IF the threshold-produced signature verifies under unmodified FIPS 204 ML-DSA.Verify. Output interchangeability is the headline pitch. Falls back to Class S if interchangeability cannot be achieved. |
| Pulsar (R-LWE) | target Class S1/S4 — special threshold-friendly primitive. Not output-interchangeable with any NIST-approved primitive. Submitted alongside Pulsar-M but with a different framing. |
| Corona (R-LWE academic) | not submitted. Federation-MPC use case only. Trusted-dealer DKG + BLAKE3 hash both rule it out of MPTC. |
| ML-DSA-65 raw | already FIPS 204; we ship as the audit / FIPS-spirit fallback (the `mldsa` PQMode). No NIST submission needed; we just consume the standard. |
| BLS-12-381 | not on any NIST track. Used for the classical fast path only; no FIPS claim. |

Pulsar-M boots as `~/work/lux/pulsar-m`. The repo structure follows
NIST IR 8214C §5 package requirements: technical specification,
reference implementation, experimental-evaluation report, notes on
patent claims, open-source license, build/test/benchmark scripts,
I/O test vectors, public repository.

### Calendar

```
NOW → 2026-Jul-20      preview writeup
2026-Jul-21 → 2026-Aug                  first reference impl + KATs
2026-Sep                                experimental-evaluation report + ePrint v0.1
2026-Oct                                external cryptanalysis engagement begins (rolling)
2026-Nov-16            MPTC package submission (NIST first call)
2027                   public-analysis response, revisions
2028+                  if NIST publishes an approved threshold standard, CMVP track opens
```

## Related HIPs — layered architecture

> The Z-Chain PQ rollup is specified in HIP-0078; the Q-Chain finality
> block format is in HIP-0079; the Pulsar-M threshold-signing primitive
> is in HIP-0084. This HIP (0077) is the umbrella; refer to the three
> child HIPs for the layered architecture.

## References

Canonical citations (verified against ePrint and conference proceedings):

- **Corona**, Boschini, Kaviani, Lai, Malavolta, Takahashi, Tibouchi —
  *"Corona: Practical Two-Round Threshold Signatures from Learning
  with Errors"* — Cryptology ePrint Archive 2024/1113.
- **GKS24**, Gür, Katz, Silde — *"Two-Round Threshold Lattice-Based
  Signatures from Threshold Homomorphic Encryption"* — PQCrypto 2024,
  ePrint 2023/1318.
- **DOTT21**, Damgård, Orlandi, Takahashi, Tibouchi — *"Two-Round
  n-out-of-n and Multi-Signatures and Trapdoor Commitment from
  Lattices"* — PKC 2021, ePrint 2020/1110.
- **HJKY97**, Herzberg, Jakobsson, Jarecki, Krawczyk, Yung — *"Proactive
  public key and signature systems"* — ACM CCS 1997. Mobile-adversary
  model for proactive resharing.
- **FIPS 204**, NIST — *"Module-Lattice-Based Digital Signature
  Standard"* — August 2024.
- **FIPS 202** + **SP 800-185**, NIST — SHA-3 family + cSHAKE / KMAC /
  TupleHash derived functions.
- **NIST IR 8214C**, NIST — *"First Call for Multi-Party Threshold
  Schemes"* — January 2026.
- **Olingo**, ePrint 2025/1789 — competing threshold ML-DSA candidate.
- **THED**, ePrint 2026/638 — competing threshold lattice signature.

Tracked in `~/work/lux/pulsar-m/spec/references.bib` so the spec PDF
and the HIP both cite from the same authoritative source.
