---
hip: 0114
title: ZAP — Inter-VM Cognitive Transport for Thinking Chains
author: Hanzo AI
type: Standards Track
category: Core
status: Draft
created: 2026-06-21
requires: 0113
---

# HIP-0114: ZAP — Inter-VM Cognitive Transport for Thinking Chains

## Abstract

**ZAP** is the node-local / inter-VM transport that carries the *messages* of a
Thinking Chain: inference intents, settled receipts, and agent/operator messages
between the consensus engine, the VM, the Cognitive Sidecar (HIP-0113), and the
A-Chain provider runtime. ZAP is **only a transport**. It moves bytes; it is never
a proof and confers no consensus weight. A ZAP message becomes consensus-relevant
only when an *independent* committed proof or receipt certifies its content — the
Bridge Law. This HIP specifies the ZAP message envelope, the cognitive procedure
set, framing and authentication, and the binding rule that separates transport from
truth, so that the messaging layer can be reasoned about and audited independently
of the proofs it happens to carry.

This is the focused companion to HIP-0113 (Cognitive Sidecar & Hanzo Engine
Provider Runtime). It is one of four sibling artifacts sharing one canon: the Lux
*Thinking Chains* proposal, the Zoo *Beluga L3 Thinking-Chain Architecture* ZIP,
and the Zoo *Thinking Chains* paper.

## Motivation

A Thinking Chain has several actors that must exchange messages without any of those
messages silently acquiring authority: a contract submits an inference intent; the
A-Chain returns a settled receipt; the Cognitive Sidecar emits a recommendation; an
operator publishes a health alert. The dangerous failure mode is treating a
*message* as if it were a *decision* — letting a value on the wire steer consensus
before it is committed and certified.

Hanzo already runs ZAP as its service-to-service RPC surface (dot-prefixed
procedures like `kms.Get`, `tasks.ExecuteWorkflow`, `notify.Send`; the native RPC
that parallels the HTTP routes, default port 9999). This HIP carves out the
*cognitive* procedure set on that same transport and makes one property binding:
**ZAP transports; proofs commit; receipts settle; VMs execute.** Pulling the
transport into its own HIP lets the proof/receipt layer (HIP-0113, the Zoo PoT
receipt ZIP) be specified and audited without entangling it with the wire that
delivers it — orthogonal separation of concerns.

## Specification

The keywords MUST, MUST NOT, SHALL, SHOULD, MAY are used per RFC 2119.

### 1. What ZAP is, and what it is not

- ZAP is a **transport**: a framed, authenticated, ordered byte channel between two
  endpoints (two VMs, a VM and the sidecar, the node and the A-Chain runtime).
- ZAP is **not a proof**. No ZAP message carries consensus weight. A receiver MUST
  NOT make a consensus-relevant state transition on the basis of a ZAP message
  alone; it MUST require an independent committed artifact (a proof verified against
  a committed root, or a settled receipt) per the Bridge Law.
- ZAP delivery is **at-least-once** and idempotent at the application layer: every
  cognitive message is keyed by a content identifier (`intent_id`, `receipt_hash`,
  or `artifact_id`) so a duplicate delivery is a no-op.

The binding rule, identical across all four artifacts:

> **ZAP transports; proofs commit; receipts settle; VMs execute.**

### 2. The Bridge Law boundary

> **C-Chain consensus state MUST NOT depend on a live query whose result is not
> already committed and certified.**

ZAP is the wire on which the two-pattern bridge runs, and it is precisely *because*
ZAP is non-authoritative that the bridge is safe:

- **Pattern A (submit intent)** is a *deterministic local* state change (staging an
  intent in an outbox), recorded under the originating chain's consensus. ZAP MAY
  carry the intent to the A-Chain, but the intent's existence is established by the
  committed outbox entry, not by the ZAP delivery.
- **Pattern B (verify receipt)** acts only on a receipt whose `receipt_hash` is
  proven (keccak/Merkle) against a *committed* `receipt_root`. ZAP MAY carry the
  receipt and its proof, but the state change is gated by proof verification, not by
  receipt arrival.

A receiver that has the bytes but not the committed proof has nothing it may act on.

### 3. Message envelope

Every ZAP cognitive message shares a fixed envelope. Fields are fixed-width and
big-endian where numeric; the payload is procedure-specific (§4).

```
ZapMessage {
    Version      uint16     // envelope schema version
    Procedure    string     // dot-prefixed cognitive procedure (§4)
    Kind         uint8       // 1 = intent, 2 = receipt, 3 = agent, 4 = operator, 5 = alert
    ContentID    bytes32     // intent_id | receipt_hash | artifact_id — the idempotency key
    Origin       bytes       // sender endpoint id (VM/role/sidecar/provider)
    Nonce        bytes32     // per-message anti-replay nonce
    Timestamp    uint64      // sender clock, advisory only — NEVER a consensus input
    Payload      bytes       // procedure-specific body
    Auth         bytes       // transport authentication tag (§5)
}
```

Binding constraints:

- `Timestamp` is advisory transport metadata. It MUST NOT be read into any
  consensus-relevant computation (wall-clock is not a consensus input).
- `ContentID` MUST equal the content identifier of the payload it carries
  (`intent_id` for an intent, `receipt_hash` for a receipt, `artifact_id` for an
  agent/operator artifact). A receiver MUST drop a message whose `ContentID` does
  not match a recomputation over its payload.
- `Payload` for a receipt-kind message carries the receipt AND its Merkle proof
  against `receipt_root`; the receiver verifies the proof before acting (Pattern B).
  The proof is what certifies; ZAP merely delivered it.

### 4. Cognitive procedure set

ZAP cognitive procedures follow the existing dot-prefixed convention. The
authoritative handlers live in the VM/sidecar; ZAP procedures dispatch to them.

| Procedure | Kind | Direction | Carries (and what certifies it) |
|-----------|------|-----------|---------------------------------|
| `cog.SubmitIntent` | intent | C-role → A-Chain runtime | an inference intent (`intent_id`); certified by the committed outbox entry, not by ZAP |
| `cog.DeliverReceipt` | receipt | A-Chain runtime → C/G-role | a settled PoT receipt + Merkle proof vs committed `receipt_root`; certified by the proof |
| `cog.AgentArtifact` | agent | Cognitive Sidecar → signer firewall | a typed artifact (HIP-0113 §5.2: `ProposalDraft`, `VoteRecommendation`, `RiskReport`, …); certified only when the signer enacts it under policy |
| `cog.OperatorAction` | operator | Cognitive Sidecar → signer firewall | a bounded `OperatorAction` / `ConfigPatch`; certified by signer policy (HIP-0113 §6) |
| `cog.BridgeHealth` | alert | bridge monitor → operators / sidecar | a `BridgeHealthAlert` (intent backlog, proof failure); evidence only, never a consensus input |
| `cog.SimRequest` / `cog.SimResult` | agent | sidecar ↔ S-role | a `SimulationRequest` and its result; evidence informing a recommendation |

A procedure MUST NOT exist on ZAP that mutates consensus directly. The only path
from a `cog.AgentArtifact` / `cog.OperatorAction` message to the chain is through
the HIP-0113 signer firewall: ZAP delivers the artifact to the firewall's inbound
queue; the firewall, not ZAP, decides whether it becomes a transaction.

### 5. Framing and authentication

- **Framing.** Each message is length-prefixed and ordered within an endpoint pair;
  the channel is reliable and at-least-once. (On the existing Hanzo transport this
  is the native ZAP RPC framing that parallels the HTTP routes; on a local socket it
  is the same envelope over a length-delimited stream.)
- **Transport authentication.** The `Auth` tag authenticates sender and integrity at
  the transport layer (consensus-native, mnemonic-derived authorization as used
  elsewhere in the Hanzo ZAP stack). Transport auth proves *who sent the bytes*; it
  does NOT make the content a proof. A receipt is trusted because its Merkle proof
  verifies against a committed root, not because the ZAP frame authenticated.
- **Anti-replay.** `(Origin, Nonce)` is unique per message; a receiver drops a
  repeat. Idempotency by `ContentID` makes a re-delivered-but-distinct-nonce message
  a no-op as well.

### 6. Determinism and ordering

ZAP delivery order, timing, and duplication MUST NOT affect any consensus-relevant
result. Concretely:

- Two intents delivered in either order produce the same committed outbox state
  (each is keyed by its own `intent_id`).
- A receipt delivered twice settles once (once-only consumption by `intent_id` per
  the PoT receipt ZIP).
- An agent artifact delivered late, early, or twice changes nothing until the signer
  firewall enacts it under policy — and enactment is itself rate- and value-bounded
  (HIP-0113 §6).

This is what "transport only" buys: the messaging layer can be lossy-but-retrying,
reordered, and duplicated, and the chain is still deterministic, because authority
lives in the committed proofs, not in the wire.

## Rationale

**Why a separate HIP for the transport.** Braiding transport with proof is the exact
mistake the Bridge Law forbids. Specifying ZAP on its own — and stating in one place
that it is non-authoritative — lets the proof/receipt layer (HIP-0113, the PoT
receipt ZIP) be audited for soundness without anyone having to reason about delivery
semantics, and lets the transport be hardened (auth, replay, framing) without
anyone fearing a wire change alters consensus. One concern per artifact.

**Why reuse the existing ZAP surface.** Hanzo already speaks ZAP service-to-service
with a dot-prefixed procedure convention and consensus-native authorization. Adding
a `cog.*` procedure set is the smallest change that gives the Thinking Chain its
messaging layer; inventing a second transport would violate "exactly one way to do
everything."

**Why timestamps are advisory.** Wall-clock is not reproducible across nodes; the
only nondeterminism a Thinking Chain tolerates is block height. Forbidding
`Timestamp` from any consensus path keeps ZAP honest about being a transport.

## Security Considerations

### Transport compromise cannot forge consensus

An attacker who fully controls the ZAP channel can drop, delay, duplicate, or inject
messages. None of this forges a consensus result: a fabricated receipt fails Merkle
verification against the committed `receipt_root` (Pattern B); a fabricated intent is
only acted on after it is committed to an outbox under the originating consensus
(Pattern A); a fabricated agent artifact is inert until the signer firewall enacts it
under policy (HIP-0113). The worst transport-level attack is denial of delivery,
which the at-least-once + retry semantics and `BridgeHealthAlert` monitoring surface.

### Authentication vs. certification

Transport auth (`Auth` tag) answers "who sent these bytes," not "is this content
true." Conflating the two would re-introduce an oracle. A receiver MUST gate every
consensus-relevant action on an independent committed proof/receipt, never on the
transport auth alone.

### Replay and idempotency

`(Origin, Nonce)` uniqueness plus `ContentID` idempotency make duplicate or replayed
delivery a no-op. Receipt replay is additionally blocked by once-only consumption by
`intent_id` in the settlement layer.

### Artifact channel isolation

`cog.AgentArtifact` / `cog.OperatorAction` deliver into the signer firewall's inbound
queue only; ZAP has no procedure that hands the agent a signing capability or mutates
consensus. The firewall's `[ai.forbidden]` / `[human_required]` policy (HIP-0113 §6)
governs whether an artifact ever becomes a transaction, independent of how it arrived.

## Reference Implementation

| Component | Path | Role |
|-----------|------|------|
| ZAP RPC surface (existing) | `hanzo/notify/internal/zaprpc` and the Hanzo ZAP service-to-service stack | dot-prefixed procedures, native RPC paralleling HTTP routes (default `:9999`) |
| Cognitive procedures (this HIP) | dispatch to the VM / Cognitive Sidecar handlers (HIP-0113) | `cog.SubmitIntent` / `cog.DeliverReceipt` / `cog.AgentArtifact` / … |
| Proof / receipt layer (certifies content) | `hanzo/chains/hanzo-evm/precompile/aiquorum`; the Zoo PoT receipt ZIP | the committed artifacts ZAP carries but never replaces |
| Signer firewall (artifact → tx) | HIP-0113 §5 | the only path from a `cog.*` artifact to a transaction |

## References

- [HIP-0113: Cognitive Sidecar & Hanzo Engine Provider Runtime for Thinking Chains](./hip-0113-cognitive-sidecar-and-hanzo-engine-provider-runtime.md)
- *Thinking Chains* (Lux Proposal) — the L0/consensus-layer primitive and the C→A
  bridge precompiles ZAP carries between.
- *Beluga L3 Thinking-Chain Architecture* (Zoo ZIP) — the first deployment; states
  the same bridge-law slogan and the two-pattern bridge ZAP rides on.
- *Proof-of-Thought Receipts on Zoo* (Zoo ZIP) — the settlement object delivered by
  `cog.DeliverReceipt` and certified by Merkle proof, not by ZAP.
- *Thinking Chains* (Zoo paper) — the conceptual treatment and Subsampled Cognitive
  Consensus analysis.

## Copyright

Copyright and related rights waived via [CC0](https://creativecommons.org/publicdomain/zero/1.0/).
