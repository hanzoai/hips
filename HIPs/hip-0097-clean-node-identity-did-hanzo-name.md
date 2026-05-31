---
hip: 0097
title: Clean Node Identity (did:hanzo:<name>)
author: Hanzo AI Team
type: Standards Track
category: Core
status: Draft
created: 2026-05-31
requires: HIP-0048 (Decentralized Identity), HIP-0005 (Post-Quantum Security), HIP-0024 (Sovereign L1), HIP-0026 (IAM), HIP-0027 (KMS)
---

# HIP-97: Clean Node Identity (`did:hanzo:<name>`)

## Abstract

Every Hanzo node, profile, agent, and device is currently named with the
Shinkai-legacy `HanzoName` format: a `@@`-prefixed label with a network suffix
baked into the string, e.g. `@@alice.sep-hanzo/main/agent/myChatGPTAgent`. That
string is signed into every `HanzoMessage` and is the lookup key for on-chain
identity registration (Base Sepolia, contract
`0x425fb20ba3874e887336aaa7f3fab32d08135ba9`). It therefore is **not** a cosmetic
label — it is consensus- and wire-critical.

This HIP proposes one clean replacement scheme: the **canonical node identity is a
`did:hanzo:<name>` Decentralized Identifier**, aligned to the `did:hanzo:` method
already standardized in HIP-48. The legacy `@@…<suffix>` and the
`network-in-the-string` design are retired. The network/chain is expressed as DID
query parameters or resolved from the registry, never embedded in the human-readable
name. A precise grammar and charset are defined, the signing and on-chain
registration impact is specified, and a backward-compatible, three-phase migration
and rollout is given so that no in-flight message or already-registered name breaks.

## Motivation

The `@@<name>.<network>-hanzo` format is inherited verbatim from Shinkai. It has
four concrete problems, all of which touch code that is live today in
`hanzo-libs/hanzo-messages/src/schemas/hanzo_name.rs`:

1. **Network is welded into the identity string.** The valid endings are hard-coded:
   `.hanzo`, `.sepolia-hanzo`, `.arb-sep-hanzo`, `.sep-hanzo`
   (`HanzoName::VALID_ENDINGS`). The *same node* on testnet vs. mainnet has a
   *different identity string*, a different signed sender, and a different registry
   key. Migrating a node from Base Sepolia to the Hanzo L1 mainnet (HIP-24, chain
   `36963`) today means it is literally a different identity. This is the single
   worst property of the legacy scheme.

2. **`@@` is non-standard and non-interoperable.** It is not a URI, not a DID, not a
   DNS name. Nothing outside Hanzo can resolve it. Meanwhile HIP-48 already ships
   `did:hanzo:` as the W3C-compliant identity method for humans, agents, services,
   and devices, with a resolver at `did.hanzo.ai` and an on-chain registry
   (`IHanzoDIDRegistry`). Node identity and DID identity are needlessly two
   different namespaces.

3. **The format is already half-migrated, inconsistently.** `HanzoName` *already*
   accepts `did:hanzo:<network>` and `did:lux:<network>` (see `is_did_format`,
   `validate_did_name`), but only as a network selector
   (`did:hanzo:mainnet`, `did:hanzo:sepolia`, `did:hanzo:local:node1`) — the *node's
   own name* still has no home in that form, and a separate `hanzo-libs/hanzo-did`
   crate parses general W3C DIDs with yet another grammar. Three parsers, one
   concept.

4. **Charset and case rules are loose.** The legacy regex
   `^@@[a-zA-Z0-9\_\.]+(\.hanzo|…)$` permits embedded dots in the node label
   (`@@a.b.c.hanzo`), mixes case then lowercases at construction, and silently
   auto-corrects (`correct_node_name` prepends `@@` and appends `.hanzo`). Loose,
   auto-correcting identity parsing is a security smell for something that is signed.

### Why a clean break is worth it

Because the name is signed and on-chain, we will *already* have to do a careful,
versioned migration for any change at all (see Migration). Given that cost is
unavoidable, we should land on the format we actually want long-term rather than a
second interim hack. HIP-48 already committed the ecosystem to `did:hanzo:`; node
identity should converge onto it rather than maintain a parallel `@@` namespace
forever.

## Specification

### 1. Decision: `did:hanzo:<name>`, not `<name>.hanzo`

Two candidate clean schemes were considered:

* **A. ENS-like `<name>.hanzo`** — e.g. `alice.hanzo`, `alice.hanzo/main/agent/x`.
* **B. DID-style `did:hanzo:<name>`** — e.g. `did:hanzo:alice`,
  `did:hanzo:alice/main/agent/x`.

**This HIP selects B, `did:hanzo:<name>.`** Rationale:

| Criterion | `<name>.hanzo` (A) | `did:hanzo:<name>` (B) — chosen |
|---|---|---|
| Aligns with existing standard | No — new third namespace | **Yes — same method as HIP-48** |
| Already parseable by `HanzoName` | No | **Partly — `did:hanzo:` path exists today** |
| Network kept out of the name | Yes | **Yes** (query param / registry, never the label) |
| Globally resolvable / W3C interop | No (looks like a DNS host but isn't) | **Yes — resolves at `did.hanzo.ai`, `did:` URI scheme** |
| Collides with real DNS / TLD confusion | Yes (`.hanzo` reads as a gTLD) | No |
| One identity across testnet/mainnet | Yes | **Yes** |
| Verifiable Credentials, `alsoKnownAs` cross-chain (`did:lux:`, `did:ai:`) | No native hook | **Native (HIP-48)** |

`A` reads more cleanly to a human, but it manufactures a *third* identity grammar
(after `@@…` and `did:…`) and looks deceptively like a DNS hostname while resolving
through none of DNS. `B` collapses node identity into the DID method the ecosystem
already standardized, makes node identity a first-class W3C DID, and gets
cross-chain `alsoKnownAs`, Verifiable Credentials, and the `did.hanzo.ai` resolver
for free. The human-friendly display form is recovered cheaply (see §6, UX) by
rendering `did:hanzo:alice` as `alice` / `@alice` in UIs without changing the wire
identity.

> Note on `did:hanzo:mainnet` legacy usage: the existing code uses
> `did:hanzo:<network>` where the method-specific-id is a *network*. Under this HIP
> the method-specific-id is the **node name**, and the network moves to a query
> parameter (`?chain=`/`?network=`). `did:hanzo:mainnet` is reinterpreted during
> migration as the reserved node name `mainnet` on the default chain; deployments
> that used it purely as a network selector MUST migrate to
> `did:hanzo:<node>?network=mainnet` (see Migration §M0).

### 2. Canonical grammar (ABNF)

The canonical, signed, on-chain identity is the **`hanzo-id`** production:

```abnf
hanzo-id     = did-node [ "/" profile [ "/" sub-type "/" sub-name ] ]

did-node     = "did:hanzo:" name [ params ]
name         = label *( "_" label )           ; node name, the method-specific-id
label        = lletter *( letterdigit )        ; MUST start with a letter
profile      = label *( "_" label )
sub-type     = "agent" / "device"
sub-name     = label *( "_" label )

params       = "?" param *( "&" param )        ; OPTIONAL; carried, never signed (§3)
param        = pkey "=" pval
pkey         = "network" / "chain" / "versionId" / "versionTime"
pval         = 1*( unreserved )

letterdigit  = lowletter / digit
lowletter    = %x61-7A                          ; a-z   (lowercase ONLY)
letter       = lowletter
digit        = %x30-39                           ; 0-9
unreserved   = lowletter / digit / "-" / "." / ":"
```

Equivalently, the node-name regex (replacing the legacy
`^@@[a-zA-Z0-9\_\.]+(\.hanzo|…)$`):

```
^did:hanzo:[a-z][a-z0-9]*(_[a-z0-9]+)*(\?[a-z]+=[a-z0-9.:-]+(&[a-z]+=[a-z0-9.:-]+)*)?$
```

#### Charset and length rules (normative)

* **Lowercase only.** The method-specific name and every path segment MUST match
  `[a-z][a-z0-9_]*`. No uppercase, no auto-lowercasing at parse time — a mixed-case
  input is **rejected**, not silently corrected. (The legacy lower-casing in
  `HanzoName::new` is removed; canonicalization is now the *caller's* job before
  signing.)
* **No dots in names.** Unlike legacy `@@a.b.hanzo`, the node name MUST NOT contain
  `.`. Dots appear only inside `params` values (e.g. a chain RPC alias).
* **Separator is `_` inside a segment, `/` between segments.** Matches the existing
  4-part structure (node / profile / `agent|device` / name) so downstream parsing in
  `inbox_name.rs`, `tool_router_key.rs`, etc. keeps the same `split('/')` shape.
* **Length:** `name` and each path segment 1–63 bytes; total `hanzo-id` ≤ 255 bytes
  (DNS-label-compatible bound, keeps registry keys bounded).
* **Reserved names:** `localhost`, `mainnet`, `testnet`, `sepolia`, `local`, `node`,
  `agent`, `device`, `did` MUST NOT be used as a *node* `name` except for the
  reserved-mapping defined in Migration §M0. The default local dev identity becomes
  `did:hanzo:localhost?network=local` (replacing `@@localhost.sep-hanzo`).

#### Valid examples

```
did:hanzo:alice
did:hanzo:alice/main
did:hanzo:alice/main/agent/my_chatgpt_agent
did:hanzo:alice/main/device/my_phone
did:hanzo:alice?network=mainnet
did:hanzo:alice?chain=36963
did:hanzo:node1?network=sepolia          ; Base Sepolia during migration
did:hanzo:localhost?network=local
```

#### Invalid examples (and why)

```
@@alice.sep-hanzo                 ; legacy @@ form — rejected post-migration (accepted read-only in Phase 1)
did:hanzo:Alice                   ; uppercase
did:hanzo:al!ce                   ; illegal char
did:hanzo:a.b.c                   ; dot in node name
did:hanzo:_alice                  ; must start with a letter
did:hanzo:alice/main/myPhone      ; 3-part must be …/agent/… or …/device/…
did:hanzo:alice/main/agent        ; agent/device requires a 4th sub-name part
did:hanzo:alice.hanzo             ; no network/TLD suffix in the name
```

### 3. Network is a parameter, never part of the identity

The single most important rule: **the chain/network is NOT part of the signed,
on-chain identity.** `did:hanzo:alice` is the *same node* whether it is registered on
Base Sepolia (migration), the Hanzo L1 mainnet (chain `36963`, HIP-24), or running
locally.

* The optional `params` (`?network=…`, `?chain=…`) are a **resolution hint only**.
* When computing the value that is **signed** (sender/recipient in
  `external_metadata`) and the value used as the **registry key**, the params are
  **stripped**. The canonical signed form is the bare `did:hanzo:<name>[/path]`
  with no query string.
* This directly fixes Motivation #1: a node moving from testnet to mainnet keeps the
  same identity, the same signed sender, and the same registry key.

### 4. Signing impact

In `hanzo_message_signing.rs`, the name is not hashed field-by-field; rather
`external_metadata.sender` / `external_metadata.recipient` (full `HanzoName`
strings) are part of the message whose hash is signed with ed25519
(`sign_outer_layer` / `sign_inner_layer`). Therefore **the exact bytes of the
identity string are inside the signature preimage.** Consequences:

1. Changing a node's canonical string from `@@alice.sep-hanzo` to `did:hanzo:alice`
   changes the signed bytes. A verifier expecting one form will fail signatures
   produced under the other. This is why a flag-day rename is unacceptable and why
   §7 defines an `IdentityProtocolVersion` negotiation.
2. The **canonicalization rule for the preimage is fixed by this HIP**: the signed
   sender/recipient MUST be the **params-stripped, NFC, lowercase `did:hanzo:` form**
   (§3). Because §2 forbids uppercase and auto-correction, canonicalization is now
   deterministic and side-effect-free — there is exactly one byte sequence per
   identity, removing the legacy ambiguity where `@@Alice…` and `@@alice…` could
   both be constructed and then lower-cased.
3. **PQ readiness.** Outer/inner signatures stay ed25519 for wire compatibility in
   this HIP. The `did:hanzo:<name>` DID Document MAY additionally carry an
   `MLDSAVerificationKey2025` key (HIP-5 / HIP-48) so the *same node identity* can be
   verified post-quantum without another rename. PQ message signing is deferred to a
   follow-up but is unblocked by using the DID form now.

### 5. On-chain registration impact

Registration today goes through
`hanzo-bin/hanzo-node/src/managers/identity_network_manager.rs`:

* RPC `https://sepolia.base.org`, contract
  `0x425fb20ba3874e887336aaa7f3fab32d08135ba9`, via
  `HanzoRegistry::get_identity_record(identity)`.
* Resolution special-cases the suffix: it checks
  `node_base.ends_with(".sepolia-hanzo")` to decide proxy handling.

Changes required:

1. **Registry key becomes the canonical params-stripped `did:hanzo:<name>`.** The
   existing Base Sepolia registry contract is retained during Phase 1–2 (no contract
   redeploy needed to *start*), but the *key string* it stores transitions from
   `@@alice.sepolia-hanzo` to `did:hanzo:alice`. A node registers its DID form; the
   suffix-sniffing (`.sepolia-hanzo`) branch is replaced by reading the
   `?network=`/`?chain=` hint (default `sepolia` during migration, `36963` after).
2. **Converge onto `IHanzoDIDRegistry` (HIP-48).** The end-state registry is the
   HIP-48 `did:hanzo:` registry on Hanzo L1 (chain `36963`), which stores
   `documentHash`, `controller`, `version`, `active` per DID. Node registration and
   HIP-48 DID registration become the **same on-chain record**: a node *is* a DID.
   This removes the separate Base Sepolia identity contract entirely at end-of-life
   (Phase 3).
3. **Dual-read during migration.** The resolver MUST, given a query, attempt
   resolution of both the new `did:hanzo:<name>` key and the legacy
   `@@<name>.<suffix>` key (deterministic mapping, §M1) so that a node which has
   re-registered under the DID form is still reachable by peers that only know its
   legacy name, and vice-versa.

### 6. UX / display form

To preserve readability lost by dropping the short `@@alice` look:

* UIs render `did:hanzo:alice` as **`alice`** (or `@alice` in social contexts);
  `did:hanzo:alice/main/agent/researcher` renders as
  **`alice › researcher`**.
* `alsoKnownAs` in the DID Document MAY list `did:lux:alice`, `did:ai:alice`
  (HIP-48 cross-chain links). These are display/interop aliases, never the signed
  identity.
* A node MAY publish a human label and avatar in its DID Document `service` /
  profile credential (HIP-48 `HanzoAgentCredential`), so the short name is a
  resolvable attribute, not part of the cryptographic identity.

### 7. `HanzoName` type changes (normative, Rust)

In `hanzo-libs/hanzo-messages/src/schemas/hanzo_name.rs`:

* Add `pub network_hint: Option<String>` and `pub chain_id_hint: Option<u64>` to
  `HanzoName`, populated from `params` and **excluded** from `Display`, `Hash`,
  `PartialEq`, `Serialize`, and from the signing preimage (they are resolution-only).
* `node_name` now holds the canonical `did:hanzo:<name>` (params stripped). The
  fields `profile_name`, `subidentity_type`, `subidentity_name` are unchanged.
* `validate_name` gains a `did:hanzo:<name>` branch (the §2 regex) and **stops
  auto-correcting**: `correct_node_name`'s `@@`/`.hanzo` injection is gated behind a
  legacy-compat flag and is off by default in Phase 2+.
* Add `IdentityProtocolVersion { Legacy = 1, Did = 2 }` carried in the message
  envelope / handshake. A peer advertises which forms it can *verify*. Two `Did`
  peers sign/verify the DID form; if either side is `Legacy`-only, both fall back to
  the legacy string for that exchange (so signatures still match) until Phase 3.
* `default_testnet_localhost()` returns
  `HanzoName::new("did:hanzo:localhost/main?network=local")`.
* Equality across forms: provide `HanzoName::same_identity(a, b)` that compares the
  canonical DID form after applying the §M1 legacy→DID mapping, so routing/dedup
  treat a legacy name and its migrated DID as one identity.

## Backward Compatibility & Migration

This is a signed, on-chain identifier; the migration is explicitly versioned and
phased. No flag day.

### M0 — Reserved-name and network-param remap (pre-flight)

Existing `did:hanzo:<network>` selectors (`did:hanzo:mainnet`, `did:hanzo:sepolia`,
`did:hanzo:local:node1`) are reinterpreted:

* `did:hanzo:mainnet` → reserved; if it was a *network* selector it becomes
  `did:hanzo:<node>?network=mainnet`. Operators MUST update config to name the node.
* `did:hanzo:local:node1` → `did:hanzo:node1?network=local`.

### M1 — Deterministic legacy ↔ DID mapping (the bridge)

A pure function maps any legacy name to its canonical DID form and back:

```
legacy:  @@<name>.<suffix>[/<profile>[/<type>/<sub>]]
canon:   did:hanzo:<name>[/<profile>[/<type>/<sub>]]  with params: network=<from suffix>

suffix → network/chain:
  .hanzo          → mainnet (chain 36963)
  .sep-hanzo      → sepolia (Base Sepolia)        ; current default
  .sepolia-hanzo  → sepolia (Base Sepolia)
  .arb-sep-hanzo  → arb-sepolia
```

`<name>` is copied verbatim **iff** it already satisfies §2 (lowercase, no dots).
Legacy names containing dots or uppercase are flagged for operator-assisted rename
(they are rare; the dominant case `@@alice.sep-hanzo` maps cleanly to
`did:hanzo:alice?network=sepolia`). This mapping is the basis for dual-read (§5.3)
and `same_identity` (§7).

### Phase 1 — Accept DID, keep signing legacy (read-compatible)

* Nodes upgrade to a build that **parses and resolves** both forms (`HanzoName`
  accepts `did:hanzo:<name>` and `@@…`).
* **Signing still uses the legacy string** (`IdentityProtocolVersion::Legacy`), so
  the wire format and existing signatures are unchanged. Old and new builds
  interoperate fully.
* Registry: dual-read enabled; new registrations MAY be written under the DID key in
  addition to the legacy key.
* Duration: until a quorum (e.g. ≥90%) of active nodes report a Phase-1-capable
  build via the handshake.

### Phase 2 — Sign DID form between capable peers (negotiated)

* Two `Did`-capable peers negotiate `IdentityProtocolVersion::Did` in the handshake
  and **sign/verify the canonical `did:hanzo:` form**. A `Did` peer talking to a
  `Legacy` peer transparently falls back to the legacy string for that session, so
  no signature ever fails due to form mismatch.
* `correct_node_name` auto-`@@`/`.hanzo` injection is **disabled by default**.
* New nodes are *born* as `did:hanzo:<name>` and register under the DID key on the
  HIP-48 registry (chain `36963`); legacy Base Sepolia entries remain dual-read.

### Phase 3 — DID-only (cutover)

* A flag-block height / date is announced. After it, nodes refuse
  `IdentityProtocolVersion::Legacy`; only `did:hanzo:` is signed, registered, and
  accepted.
* The Base Sepolia identity contract is frozen; the canonical registry is the HIP-48
  `IHanzoDIDRegistry` on chain `36963`. Legacy `@@` parsing is removed from
  `HanzoName` (kept only in an offline migration tool).
* `VALID_ENDINGS` and the `@@` regex are deleted.

### Migration tooling

* `hanzod identity migrate` — reads the node's current `@@…` identity, derives the
  `did:hanzo:` form via §M1, re-registers it on-chain, and writes both keys until
  Phase 3.
* A read-only `did:hanzo:` ↔ `@@` lookup table is published by the resolver at
  `did.hanzo.ai` for the duration of Phases 1–2.
* Test vectors (legacy string, canonical DID, signed preimage bytes) are added to
  `hanzo-libs/hanzo-messages/tests/hanzo_name_tests.rs` so both forms hash to the
  expected signature inputs.

## Rollout

1. Land `HanzoName` changes (DID branch, hints, `same_identity`,
   `IdentityProtocolVersion`) behind a feature flag; ship in a normal node release
   (Phase 1 behavior default).
2. Update the ~60 call sites that build/validate `HanzoName` (identity manager,
   inbox/tool-router keys, payments managers, tests) to use canonicalized DID
   construction helpers; behavior stays Legacy-signed.
3. Ship resolver dual-read + `hanzod identity migrate` + `did.hanzo.ai` lookup
   table.
4. Flip default to Phase 2 once telemetry shows quorum of capable peers.
5. Announce Phase 3 cutover height/date; freeze Base Sepolia contract; converge on
   `IHanzoDIDRegistry` (chain `36963`).

## Security Considerations

* **Signature-preimage determinism.** Because §2 forbids uppercase/dots and removes
  auto-correction, each identity has exactly one canonical byte sequence; this closes
  the legacy ambiguity where multiple inputs canonicalized to the same lower-cased
  name, which is dangerous for a signed field.
* **No silent identity coercion.** Invalid identities are rejected, never
  auto-completed into a valid-looking one (legacy `correct_node_name` could turn a
  typo into a different, valid node).
* **Network-confusion resistance.** Stripping `?network`/`?chain` from the signed and
  registry forms means a signature or registration cannot be replayed as if it were
  for a different chain by swapping a suffix — the identity is chain-agnostic by
  construction.
* **Migration window risk.** Dual-read and `Legacy` fallback are the only periods
  where two strings denote one node; `same_identity` (§M1 mapping) MUST be used for
  all auth/routing decisions to prevent a peer from being treated as two identities
  (or two peers as one).
* **PQ path.** The DID form lets a node attach an `MLDSAVerificationKey2025` key
  (HIP-5) to the same identity, so the eventual move to PQ message signing needs no
  further rename.

## References

* HIP-48 — Decentralized Identity (DID) Standard (`did:hanzo:` method, registry, VCs)
* HIP-5 — Post-Quantum Security (`ML-DSA-65`, `MLDSAVerificationKey2025`)
* HIP-24 — Hanzo Sovereign L1 (chain `36963`)
* HIP-26 — IAM (credential issuer); HIP-27 — KMS (key custody)
* W3C DID Core 1.0; W3C Verifiable Credentials Data Model 2.0
* `hanzo-libs/hanzo-messages/src/schemas/hanzo_name.rs` (current `HanzoName`)
* `hanzo-bin/hanzo-node/src/managers/identity_network_manager.rs` (Base Sepolia registration)
* `hanzo-libs/hanzo-did/` (existing W3C DID parser to converge on)
