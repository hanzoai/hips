---
hip: 0505
title: AgentEscrow + ZAP Envelope as a Cloud Subsystem (Switchboard)
author: Abhishek Krishna <invokerkrishna@gmail.com>
type: Standards Track
category: Service
status: Draft
created: 2026-06-10
updated: 2026-06-12  # added Phase 5 Solana SPL rail
requires: HIP-0014, HIP-0026, HIP-0027, HIP-0106, HIP-0302
depends-on-external: lux LP-3031 (Agent Payment Standard)
---

# HIP-505: AgentEscrow + ZAP Envelope as a Cloud Subsystem (Switchboard)

## Abstract

This proposal defines `switchboard` — a subsystem for the unified
`hanzoai/cloud` binary (HIP-0106) that exposes agent-to-agent escrow
and ZAP-envelope settlement as a first-class cloud capability.
Switchboard ships the `Mount(*zip.App, cloud.Deps) error` contract from
HIP-0106, mounts the `/v1/escrow/*` route prefix, exports a `.zap`
schema for inter-subsystem RPC, and stores escrow ticket state in
per-tenant encrypted SQLite per HIP-0302.

The on-chain settlement primitive — `AgentEscrow.sol` at a well-known
genesis address plus the `ZAP envelope decode precompile` — is
specified independently as **lux LP-3031 (Agent Payment Standard)** in
the Lux LP corpus. This HIP specifies only the **in-cloud surface**:
how a Hanzo / Lux / Zoo / Osage / reseller deployment configures and
consumes that on-chain primitive through the unified binary.

**Reference implementation repository**: [github.com/kcolbchain/switchboard](https://github.com/kcolbchain/switchboard)
**Subsystem mount path**: `/v1/escrow/*`
**ZAP schema**: `switchboard/schema/switchboard.zap`
**Image (planned)**: `ghcr.io/hanzoai/cloud:vX.Y.Z` (linked as a Go
package; not a standalone container)

## Motivation

### The problem

Multi-agent systems need a payment substrate that is *neither* a
one-shot processor charge *nor* a long-lived account balance. Two
agents from different organizations need to negotiate a unit of work,
lock funds against it, perform the work, and release on completion —
with dispute resolution and audit trail. Today the workloads scatter
across three rails:

1. **Off-chain processor rails** (Stripe via HIP-0018 / Hyperswitch in
   `hanzoai/payments`) — built for one-shot human-initiated charges.
   Does not understand "hold funds pending a future deliverable",
   does not generate a cryptographic settlement receipt, does not
   scale to per-agent-call cost-of-cents economics.
2. **On-chain payment channels** (Coinbase x402, Lux LP-3031, Tempo MPP
   sessions) — each ships its own envelope format and on-chain
   contract surface. A cloud operator who wants to support agent
   payments today writes adapter code for every rail.
3. **In-protocol balance ledgers** (HIP-0026 IAM credit balance) —
   single-party, single-org. Cannot express "agent A escrows funds
   that resolve to agent B in a different org under condition C."

Switchboard collapses these into one cloud-resident object — the
**escrow ticket** — with a deterministic ZAP-RPC interface and three
configurable settlement modes (off-chain only, off-chain with
on-chain anchoring, full on-chain settlement). The on-chain side is
the Lux LP-3031 primitive, with which switchboard tickets share an ID
namespace.

### Why a subsystem and not a library

A Go library (`go get github.com/kcolbchain/switchboard`) handles
~80% of switchboard use, but does not solve:

- **Multi-tenancy**: each cloud tenant needs an isolated ticket store,
  isolated KMS-derived signing key, isolated audit log. The unified
  binary's per-tenant SQLite + KMS + IAM scope (HIP-0106 + HIP-0302)
  already solves this; switchboard inherits it for free as a
  subsystem.
- **Inter-subsystem typed RPC**: other subsystems (commerce, ai,
  agents, mcp) need to *call* switchboard to escrow funds before
  invoking a paid action. ZAP-typed in-process method calls cost
  nothing; HTTP roundtrips from inside the same process cost JSON
  marshal + transport overhead, both of which HIP-0106 explicitly
  forbids ("JSON happens at most ONCE per request").
- **White-label reseller surface**: `api.lux.cloud`, `api.zoo.cloud`,
  `api.osage.cloud`, and downstream resellers want to expose
  switchboard under their own brand without operating a separate
  service. The HIP-0106 binary serves all of them already; switchboard
  enabling/disabling is a `--enable=switchboard` flag away.

### Why a separate HIP from HIP-0018 and HIP-0025

HIP-0018 specifies *payment processing* — converting USD into IAM
credit balance via Stripe webhooks. HIP-0025 specifies *bot agent
wallet RPC billing* — credit-based billing for agent runtime.
Switchboard sits *between* them and a third position: **escrow for
agent-to-agent work units that may settle off-chain, on-chain, or
both**. Folding switchboard into commerce conflates orchestration
(commerce, light router, CDE-connected) with escrow lifecycle (state
machine, dispute resolution, on-chain anchoring). PCI scope and code
ownership both want them separate. See "Rationale" below.

## Specification

### Mount contract

Switchboard implements the canonical HIP-0106 mount contract verbatim:

```go
package switchboard

import (
    "github.com/hanzoai/zip"
    "github.com/hanzoai/cloud"
)

// Mount registers switchboard's HTTP routes and ZAP services
// on the provided zip.App, using the cloud.Deps clients for
// inter-subsystem calls.
//
// Canonical signature per HIP-0106 "Subsystem boundaries".
func Mount(app *zip.App, deps cloud.Deps) error
```

`cloud`'s `main.go` (per HIP-0106 §"Subsystem boundaries") gains one
line:

```go
if cfg.Enabled("switchboard") { switchboard.Mount(app, deps) }
```

The mount order priority is **130** — after commerce (100), licensing
(110), plansvc (111), pricingsvc (112), but before ai (150) and
mcp (160). Rationale: switchboard consumes commerce (for invoicing
hooks) and licensing (for ticket-issuance authorization), and is
consumed by ai/mcp/agents (for escrowing agent-to-agent work). The
mount-order priority falls between its providers and its consumers.

### Subsystem dependencies (cloud.Deps consumption)

Switchboard reads from `cloud.Deps` but never *writes* into another
subsystem's state directly. Per HIP-0106, deps clients resolve to
in-process method calls when co-resident, ZAP RPC when split.

| Dep client | Used for | Resolution mode |
|---|---|---|
| `deps.IAM` | JWT validation, `(app, org)` resolution, actor identity for audit log | in-process when co-resident, RPC otherwise |
| `deps.KMS` | derive `switchboard:<orgSlug>:tickets` signing key via HKDF; sign ticket-commitment hashes | in-process when co-resident, RPC otherwise |
| `deps.Base` | per-tenant SQLite handle for ticket storage (per HIP-0302) | in-process always (storage is co-resident) |
| `deps.O11y` | metric emission (`switchboard.tickets_created`, `switchboard.disputes_opened`, `switchboard.settlement_latency_ms`) | in-process when co-resident, RPC otherwise |
| `deps.Commerce` | optional — invoice line item when a ticket settles for a paying tenant | in-process when co-resident, RPC otherwise, fail-closed stub when no endpoint |
| `deps.Gateway` | none — switchboard is consumed *via* gateway, not the reverse | n/a |

Switchboard is **never** in the PCI-CDE-connected blast radius
(per HIP-0106 §"Solo-vault CDE"). It does not handle PANs; it does
not call payments or vault directly. When a ticket settles via fiat
rail, switchboard emits a settlement event that commerce consumes;
commerce then calls payments+vault on its own.

### Configuration

Switchboard reads its configuration from cloud's startup config under
the `switchboard:` key. Brand and domain are inherited from `cloud.Deps`
(per HIP-0106 brand-neutrality requirement); switchboard-specific
fields:

```yaml
switchboard:
  # Settlement mode — one of three.
  settlement_mode: "off-chain"  # | "anchored" | "on-chain"

  # When mode != off-chain, the `chains:` map is keyed by rail name and
  # holds the RPC endpoint + chain-specific anchors for each supported
  # on-chain rail. The top-level `settlement_mode` choice (`off-chain |
  # anchored | on-chain`) selects whether ANY chain is involved; the
  # per-ticket `rail` field (e.g. `LP182` vs `SOLANA_SPL`) decides which
  # `chains:` block applies for that ticket.
  chains:
    lux_lp182:
      rpc_url: "https://rpc.lux.network"
      chain_id: 96369
      escrow_contract_address: "0x000000000000000000000000000000000000A002"  # well-known genesis address
      zap_decode_precompile: "0x000000000000000000000000000000000000000c"
      confirmations_required: 6  # >=$1K; 1 confirmation for <$1K

    solana_spl:
      rpc_url: "https://api.mainnet-beta.solana.com"
      cluster: "mainnet-beta"           # | "devnet"
      program_id: "<switchboard agent_escrow program id, base58>"
      usdc_mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
      commitment: "confirmed"           # | "finalized"
      max_amount_base_units: 100000000  # $100 USDC at 6 decimals — pilot cap

  # Per-ticket lifecycle parameters.
  ticket:
    max_amount_usd: 10000        # ceiling per ticket
    default_expiry_hours: 168    # 7 days default; max 30 days
    retention_days: 2555         # 7-year audit retention (financial regulatory floor)
    idempotency_window_hours: 72 # idempotency-key dedupe window

  # Dispute resolution parameters.
  dispute:
    auto_resolve_after_days: 30
    multi_party_threshold: 2  # of 3 signers required to force-resolve on-chain

  # Subsystem mode — controls whether tickets created in-process can
  # be served from a separate switchboard process via ZAP RPC.
  serve_mode: "embedded"  # | "remote"
  remote_rpc_url: ""      # used when serve_mode = "remote"
```

Tenant-scoped overrides (commerce-tier-aware) live in the per-tenant
SQLite under the `switchboard_tenant_config` table; the startup config
is the default fallback.

### Storage

Per HIP-0302 / HIP-0106, switchboard stores all per-tenant state in
the tenant's encrypted SQLite file at
`{data-dir}/orgs/{orgSlug}/switchboard.db`. The per-org HKDF-derived
DEK applies; switchboard adds no separate encryption layer at the
storage tier (it does sign ticket commitments at the application
tier — see Security).

#### Schema (DDL sketch)

```sql
-- Each ticket is the unit of work being escrowed.
CREATE TABLE tickets (
  id              TEXT PRIMARY KEY,                -- ULID, switchboard-issued
  org_slug        TEXT NOT NULL,                   -- tenant scope (HIP-0026)
  state           TEXT NOT NULL,                   -- created | funded | released | disputed | resolved | expired | cancelled
  payer_did       TEXT NOT NULL,                   -- DID of the agent funding the ticket
  payee_did       TEXT NOT NULL,                   -- DID of the agent doing the work
  amount_cents    INTEGER NOT NULL,                -- amount in minor units
  currency        TEXT NOT NULL,                   -- ISO 4217 (USD, EUR) or asset code (USDC, MUSD)
  rail            TEXT NOT NULL,                   -- off-chain | x402 | zap | lp182 | mpp | solana_spl
  settlement_mode TEXT NOT NULL,                   -- off-chain | anchored | on-chain
  zap_envelope    BLOB,                            -- raw ZAP-encoded PaymentOffer (LP-3031 §4.2)
  lp182_ticket_id TEXT,                            -- on-chain ticket ID when settlement_mode != off-chain (LP182 rail canonical)
  chain_specific_ticket_ref JSON,                  -- generalized chain-side ticket reference (PDA for Solana, ticket-id u256 for EVM); populated for any rail with on-chain anchor
  commitment_sig  BLOB NOT NULL,                   -- ML-DSA-65 over canonical ticket digest
  idempotency_key TEXT NOT NULL UNIQUE,            -- client-supplied; 72h dedupe window
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at      TIMESTAMP NOT NULL,
  released_at     TIMESTAMP,
  metadata        JSON                             -- caller-supplied opaque
);

CREATE INDEX idx_tickets_org_state ON tickets(org_slug, state);
CREATE INDEX idx_tickets_payee     ON tickets(payee_did, state);
CREATE INDEX idx_tickets_expires   ON tickets(state, expires_at) WHERE state IN ('created','funded');

-- Disputes are first-class. A ticket may have at most one open dispute.
CREATE TABLE disputes (
  id              TEXT PRIMARY KEY,                -- ULID
  ticket_id       TEXT NOT NULL REFERENCES tickets(id),
  state           TEXT NOT NULL,                   -- opened | evidence | arbitrating | resolved_payer | resolved_payee | resolved_split
  opened_by_did   TEXT NOT NULL,
  reason_code     TEXT NOT NULL,                   -- nondelivery | quality | mismatch | other
  evidence_blob   BLOB,                            -- caller-supplied; vfs blob ref for large payloads
  resolution_sig  BLOB,                            -- ML-DSA-65 over canonical resolution digest, when state in resolved_*
  resolution_split JSON,                           -- {"payer_cents": N, "payee_cents": M} when state=resolved_split
  opened_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at     TIMESTAMP,
  UNIQUE(ticket_id) WHERE state IN ('opened','evidence','arbitrating')
);

-- Settlements record the actual movement of funds. May be off-chain
-- (commerce invoice line) or on-chain (lp182 tx receipt).
CREATE TABLE settlements (
  id              TEXT PRIMARY KEY,                -- ULID
  ticket_id       TEXT NOT NULL REFERENCES tickets(id),
  kind            TEXT NOT NULL,                   -- offchain_release | onchain_release | dispute_payout | refund
  rail            TEXT NOT NULL,                   -- off-chain | x402 | zap | lp182 | mpp | solana_spl
  amount_cents    INTEGER NOT NULL,
  destination_did TEXT NOT NULL,
  external_ref    TEXT,                            -- tx hash, commerce invoice id, etc.
  receipt_blob    BLOB,                            -- ZAP-encoded PaymentProof (LP-3031 §4.3) when on-chain
  settled_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_settlements_ticket ON settlements(ticket_id);

-- Tamper-evident audit log; append-only.
CREATE TABLE audit_log (
  seq             INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id       TEXT,                            -- may be NULL for config events
  actor_did       TEXT NOT NULL,
  actor_iam_user  TEXT,                            -- mapped through deps.IAM when actor is a human
  action          TEXT NOT NULL,                   -- create | fund | release | dispute_open | dispute_resolve | settle | expire
  payload_hash    BLOB NOT NULL,                   -- SHA-256 over canonical action payload
  prev_hash       BLOB NOT NULL,                   -- SHA-256 hash chain over (prev_hash || payload_hash)
  occurred_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_audit_ticket ON audit_log(ticket_id, seq);

-- Tenant-scoped config overrides.
CREATE TABLE switchboard_tenant_config (
  org_slug                TEXT PRIMARY KEY,
  max_amount_usd          INTEGER,
  default_expiry_hours    INTEGER,
  dispute_auto_resolve_d  INTEGER,
  settlement_mode_default TEXT,
  updated_at              TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

For the `LP182` rail, `lp182_ticket_id` is the canonical column (kept
for spec stability); for other on-chain rails (including `SOLANA_SPL`),
use `chain_specific_ticket_ref`.

Retention: rows in `tickets`, `disputes`, `settlements`, and
`audit_log` are retained for `ticket.retention_days` (default 7 years
per financial regulatory floor). A nightly job in the tasks subsystem
(referenced via `deps.Tasks` when available, falling back to a
switchboard-internal cron) marks rows older than retention for purge;
encrypted-blob columns are zeroed before row deletion.

### HTTP API

All endpoints mount under `/v1/escrow/*` on the cloud `zip.App`. JSON
in, JSON out, JWT-authenticated through `deps.IAM` per HIP-0026.

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/v1/escrow/tickets` | bearer | Create a new escrow ticket |
| `GET` | `/v1/escrow/tickets/{id}` | bearer | Fetch a ticket by id |
| `GET` | `/v1/escrow/tickets` | bearer | List tickets (cursor-paginated) |
| `POST` | `/v1/escrow/tickets/{id}/fund` | bearer | Mark a ticket funded (off-chain) or attach on-chain proof |
| `POST` | `/v1/escrow/tickets/{id}/release` | bearer | Release escrowed funds to payee |
| `POST` | `/v1/escrow/tickets/{id}/cancel` | bearer | Cancel before fund (payer only) |
| `POST` | `/v1/escrow/disputes` | bearer | Open a dispute on a ticket |
| `GET` | `/v1/escrow/disputes/{id}` | bearer | Fetch a dispute |
| `POST` | `/v1/escrow/disputes/{id}/evidence` | bearer | Attach evidence to an open dispute |
| `POST` | `/v1/escrow/disputes/{id}/resolve` | bearer + arb role | Resolve a dispute (payer / payee / split) |
| `GET` | `/v1/escrow/settlements/{id}` | bearer | Fetch a settlement record |
| `GET` | `/v1/escrow/audit/{ticket_id}` | bearer | Stream audit log for a ticket |
| `GET` | `/v1/escrow/healthz` | none | Subsystem liveness probe (per HIP-0106 health surface) |

#### Example: create a ticket

```
POST /v1/escrow/tickets
Authorization: Bearer <jwt>
Idempotency-Key: ik_01H...ABCD
Content-Type: application/json

{
  "payer_did":    "did:agent:0xA1...",
  "payee_did":    "did:agent:0xB2...",
  "amount_cents": 5000,
  "currency":     "USDC",
  "rail":         "zap",
  "settlement_mode": "anchored",
  "expires_in_hours": 72,
  "zap_envelope_b64": "WkFwAQECAAAAA....",
  "metadata": { "task": "embedding_batch_v3", "agent_run_id": "ar_abc" }
}
```

Response `201 Created`:

```json
{
  "id": "tk_01H8M3...XYZ",
  "state": "created",
  "amount_cents": 5000,
  "currency": "USDC",
  "rail": "zap",
  "settlement_mode": "anchored",
  "commitment_sig": "MEUCIQ...K2c=",
  "lp182_ticket_id": null,
  "created_at": "2026-06-10T18:24:01Z",
  "expires_at": "2026-06-13T18:24:01Z",
  "links": {
    "self":    "/v1/escrow/tickets/tk_01H8M3...XYZ",
    "fund":    "/v1/escrow/tickets/tk_01H8M3...XYZ/fund",
    "release": "/v1/escrow/tickets/tk_01H8M3...XYZ/release",
    "audit":   "/v1/escrow/audit/tk_01H8M3...XYZ"
  }
}
```

#### Example: release on completion

```
POST /v1/escrow/tickets/tk_01H8M3...XYZ/release
Authorization: Bearer <jwt>
Content-Type: application/json

{
  "release_reason":   "delivery_acknowledged",
  "payment_proof_b64": "WkFwAQIBAAAAA....",
  "destination_did":   "did:agent:0xB2..."
}
```

Response `200 OK`:

```json
{
  "ticket_id":     "tk_01H8M3...XYZ",
  "state":         "released",
  "settlement_id": "st_01H8N1...PQR",
  "rail":          "zap",
  "external_ref":  "0xab12cd34...",     // on-chain tx hash when anchored/on-chain
  "released_at":   "2026-06-10T19:01:33Z"
}
```

#### Example: open a dispute

```
POST /v1/escrow/disputes
Authorization: Bearer <jwt>
Content-Type: application/json

{
  "ticket_id":    "tk_01H8M3...XYZ",
  "reason_code":  "nondelivery",
  "evidence_b64": "..."
}
```

Response `201 Created`:

```json
{
  "id":            "dp_01H8N2...DEF",
  "ticket_id":     "tk_01H8M3...XYZ",
  "state":         "opened",
  "reason_code":   "nondelivery",
  "opened_at":     "2026-06-10T19:30:00Z",
  "auto_resolve_at": "2026-07-10T19:30:00Z"
}
```

All endpoints emit standard HIP-0017 analytics events under the
`switchboard.*` namespace via `deps.O11y`.

### ZAP API

Switchboard ships `switchboard/schema/switchboard.zap`. The schema is
the canonical contract for in-process and over-wire calls; the HTTP
API above is a thin JSON shim that delegates to the same ZAP-typed
methods.

```
// switchboard.zap (excerpt — abbreviated for readability)
@version 1.0.0
@namespace hanzoai.switchboard

enum SettlementMode { OFF_CHAIN; ANCHORED; ON_CHAIN }
enum TicketState   { CREATED; FUNDED; RELEASED; DISPUTED; RESOLVED; EXPIRED; CANCELLED }
enum DisputeState  { OPENED; EVIDENCE; ARBITRATING; RESOLVED_PAYER; RESOLVED_PAYEE; RESOLVED_SPLIT }
enum Rail          { OFF_CHAIN; X402; ZAP; LP182; MPP; SOLANA_SPL }

struct Ticket {
  string         id;
  string         org_slug;
  TicketState    state;
  string         payer_did;
  string         payee_did;
  uint64         amount_cents;
  string         currency;
  Rail           rail;
  SettlementMode settlement_mode;
  bytes          zap_envelope;
  optional<string> lp182_ticket_id;
  bytes          commitment_sig;
  timestamp      created_at;
  timestamp      expires_at;
  optional<timestamp> released_at;
  optional<json> metadata;
}

struct CreateTicketReq {
  string         payer_did;
  string         payee_did;
  uint64         amount_cents;
  string         currency;
  Rail           rail;
  SettlementMode settlement_mode;
  uint32         expires_in_hours;
  bytes          zap_envelope;
  string         idempotency_key;
  optional<json> metadata;
}

service Switchboard {
  Ticket     CreateTicket   (CreateTicketReq);
  Ticket     GetTicket      (string id);
  Ticket     FundTicket     (string id, bytes funding_proof);
  Settlement ReleaseTicket  (string id, bytes payment_proof, string destination_did);
  Ticket     CancelTicket   (string id);
  Dispute    OpenDispute    (string ticket_id, string reason_code, bytes evidence);
  Dispute    ResolveDispute (string dispute_id, DisputeState target, optional<ResolutionSplit> split);
  Settlement GetSettlement  (string id);
  list<AuditEntry> AuditLog (string ticket_id, uint32 limit, optional<string> cursor);
}
```

`zapc generate switchboard.zap --lang go --out ./zap/gen/` produces:

- `switchboard/zap/gen/switchboard.go` — generated structs and enums
- `switchboard/zap/gen/switchboard_server.go` — server-side handlers
  registered against the local ZAP dispatcher in `Mount()`
- `switchboard/zap/gen/switchboard_client.go` — typed client surface
  exposed via `cloud.Deps.Switchboard`

Per HIP-0106, `deps.Switchboard` resolves to:

- a direct in-process method-call client when switchboard is enabled
  in the same `cloud` process
- a ZAP RPC client over `:9653` when switchboard is split-deployed
  with `CLOUD_SWITCHBOARD_ZAP_ADDR` set
- a fail-closed stub returning `clients.IsDisabled(err) == true` when
  switchboard is disabled and no endpoint is configured

Other subsystems consume switchboard via `deps.Switchboard.CreateTicket(...)`
without knowing the mode. The agents subsystem (HIP-0301 runtime) is
the primary in-process consumer: an agent tool-call that costs money
calls `deps.Switchboard.CreateTicket(...)` before dispatching the
work, and `deps.Switchboard.ReleaseTicket(...)` on success.

### Security

#### Tenant isolation

Per HIP-0106 §"Tenant isolation", every switchboard surface is scoped
by `X-Org-Id` minted by gateway from the validated JWT. Per-tenant
SQLite (HIP-0302) bounds the storage blast radius — a switchboard
bug that leaks state cannot cross tenants because the file boundary
is fundamental.

#### Commitment signing

When a ticket is created, switchboard computes a canonical digest
`H = SHA-256(canonical(ticket_fields))` and signs it with the
per-tenant signing key derived from KMS:

```
signing_key = HKDF-Expand(
    PRK   = HKDF-Extract(salt = "hanzo:switchboard:v1", IKM = kms.MasterKey),
    info  = "switchboard:" || orgSlug || ":tickets",
    L     = 32,
)
```

The signature uses **ML-DSA-65** (post-quantum, FIPS 204; consistent
with HIP-0085 wallet-PQ-account-type and HIP-0086 tx-auth-envelope).
The signature is persisted to `tickets.commitment_sig` and returned
in every ticket-fetch response. Any party with the public key portion
of the per-tenant key (published at `/v1/escrow/keys/{orgSlug}.pub`)
can verify that switchboard issued a given ticket.

In `settlement_mode = anchored | on-chain`, the commitment hash is
the same input that LP-3031's on-chain `AgentEscrow.commit(ticketId,
commitment)` accepts. The anchoring step is a single transaction
that posts `commitment` to the L1; the off-chain ticket and the
on-chain commit share an ID namespace by construction.

#### Idempotency

Every ticket-creation request requires a client-supplied
`Idempotency-Key`. The unique constraint on `tickets.idempotency_key`
plus a 72-hour dedupe window prevents accidental double-creation
under client retry. Release and dispute endpoints are idempotent on
the ticket-state machine — a `release` on an already-released ticket
returns the existing settlement, not a new one.

#### Dispute resolution

Disputes follow a three-state lifecycle (`opened → evidence →
arbitrating → resolved_*`). The default arbiter is the tenant org
admin (resolved via `deps.IAM` role check `switchboard:arbiter`).
When `settlement_mode = on-chain`, high-value disputes (configurable
threshold, default $1,000) require a **threshold-signature
multi-party flow**: 2-of-3 signers must co-sign the resolution
digest, with the third signer being the lux LP-3031 committee node
(per LP-3031 §6.4 multi-party dispute escalation). The threshold-sig
flow uses the MPC primitive (HIP-0497 `hanzo-mpc`) when available,
falling back to a sequential multi-sig collection over ZAP RPC.

#### Audit log integrity

The `audit_log` table is append-only at the application tier (no
`UPDATE` or `DELETE` statements in switchboard code touch it; only
the retention sweeper deletes rows past the retention horizon, and
only by row range, never by selective key). Each row carries a
SHA-256 hash of the previous row's `payload_hash || prev_hash`,
producing a hash chain rooted in a per-tenant genesis row written at
first switchboard mount on a tenant's database. Any tampering with
historical rows breaks the chain at the tamper point.

Per-tenant audit log root hashes are exported daily to the o11y
subsystem (HIP-0031) as `switchboard.audit_root.{orgSlug}` metrics,
giving operators a tamper-detection signal that does not require
re-reading every row.

### Integration with lux LP-3031

LP-3031 (Agent Payment Standard) is the on-chain primitive. Switchboard
is the in-cloud client. The relationship is intentionally one-way:
switchboard depends on LP-3031; LP-3031 does not depend on switchboard.

### Multi-chain settlement modes

LP-3031 is the canonical EVM/Lux on-chain primitive, but the `chain_specific_ticket_ref`
column and the `chains:` config map let a single switchboard deployment
anchor tickets on multiple rails simultaneously. The first non-EVM rail
specified is **Solana SPL** (Phase 5), backed by an Anchor program with
the same lifecycle semantics (`Created → Funded → Released | Refunded |
Disputed → Resolved`) but Ed25519 signatures, SPL token transfers via
CPI, and Solana's commitment-level confirmation semantics in place of
block-depth confirmations.

PQ posture: LP-3031 requires ML-DSA-65 envelopes and the Lux precompile
for full on-chain envelope verification. Solana has no native PQ syscall;
Solana SPL anchors only the **commitment hash** (32 bytes) on-chain. The
full PQ envelope is retained off-chain in the audit log. Operators with
PQ-mandated flows MUST route through LP-3031; operators choosing Solana
SPL accept the post-quantum gap as documented.

#### Mode `off-chain`

No on-chain interaction. `lp182_ticket_id` is `NULL`. The ticket
exists only in switchboard's per-tenant SQLite and as commitments in
the audit log. Settlement happens via commerce invoicing or
in-protocol IAM credit-balance debits (per HIP-0018 + HIP-0026).
Suitable for low-value, intra-tenant, or low-trust-required agent
flows.

#### Mode `anchored`

The ticket exists off-chain in switchboard's SQLite; the **commitment
hash** is posted on-chain via a single LP-3031 `AgentEscrow.commit()`
transaction at ticket-creation time. Funds are not held on-chain.
Release happens off-chain (commerce or credit-balance), but the
release event is also anchored via `AgentEscrow.attest()`. Suitable
when partners need a cryptographic record of the ticket's existence
and resolution but do not require on-chain custody.

#### Mode `on-chain`

The ticket is mirrored to LP-3031 in full. Funds are held in the
LP-3031 `AgentEscrow` contract at the well-known genesis address
(`0x000...A002` per LP-3031 §3.1) on the configured L1. Release calls
the on-chain `AgentEscrow.release()` method, which transfers funds
to the payee's address. Switchboard tracks the off-chain mirror for
audit and lifecycle hooks; the L1 is the source of truth for
custody.

#### Anchoring sequence (mode = anchored)

```
agent (payer)                cloud/switchboard           lux L1 (LP-3031)
     |                              |                            |
     | POST /v1/escrow/tickets      |                            |
     |----------------------------->|                            |
     |                              | sign commitment (ML-DSA-65)|
     |                              |--+                         |
     |                              |  | (KMS-derived key)       |
     |                              |<-+                         |
     |                              | AgentEscrow.commit(id, h)  |
     |                              |--------------------------->|
     |                              |                            | log event
     |                              |     tx receipt (hash)      |
     |                              |<---------------------------|
     | 201 Created (ticket + commit)|                            |
     |<-----------------------------|                            |
     |                              |                            |
     |  ...work happens off-chain ... |                          |
     |                              |                            |
     | POST /tickets/{id}/release   |                            |
     |----------------------------->|                            |
     |                              | AgentEscrow.attest(id,proof)|
     |                              |--------------------------->|
     |                              |     tx receipt (hash)      |
     |                              |<---------------------------|
     |                              | commerce invoice line item |
     |                              |---> deps.Commerce          |
     | 200 OK (settlement)          |                            |
     |<-----------------------------|                            |
```

#### Failure handling

If the LP-3031 RPC is unreachable or the on-chain anchor transaction
fails, switchboard:

1. Records the failure in the audit log.
2. Holds the ticket in `created` state (does not advance to `funded`).
3. Retries with exponential backoff up to 5 attempts over 30 minutes.
4. Surfaces a `switchboard.anchor_failed` metric and returns
   `503 Service Unavailable` to the original request with a
   `Retry-After` header.

Partial-anchor failures (commit succeeded, attest failed) are
recoverable: the off-chain ticket is the authoritative state until
the on-chain attest completes, and the audit log shows the gap.

## Rationale

### Why a separate subsystem instead of folding into commerce

Three reasons.

**(1) PCI scope.** HIP-0106 §"Solo-vault CDE" makes commerce
CDE-connected (it sees vault tokens). Switchboard does not handle
PANs, vault tokens, or processor connector logic — it handles
ticket state and commitment signing. Folding switchboard into
commerce would either expand commerce's PCI scope (bad) or fragment
commerce's responsibilities (also bad). Keeping them adjacent
subsystems lets switchboard sit *outside* CDE-connected.

**(2) Lifecycle shape.** Commerce's billing flows are one-shot
(`checkout.session.completed → add balance`) or periodic
(`invoice.paid → add subscription credits`). Switchboard tickets are
state machines (`created → funded → released | disputed →
resolved`) with multi-party participants, dispute resolution, and
multi-month retention windows. The code is structurally different;
sharing a subsystem boundary obscures the structural difference and
invites accidental coupling.

**(3) On-chain binding.** LP-3031's on-chain contract surface
(`AgentEscrow`) wants a 1:1 binding to a single in-cloud subsystem
so that schema changes coordinate cleanly. Commerce evolves at
commerce's pace (Stripe webhook changes, subscription tier
adjustments, etc.); switchboard evolves at LP-3031's pace (PQ
signature scheme changes, ZAP wire bumps, etc.). Two different
release cadences want two different subsystem boundaries.

### Why ZAP and not another inter-subsystem wire

HIP-0106 makes ZAP the canonical inter-subsystem wire ("No `.capnp`
files anywhere in Hanzo-authored code"). Switchboard is not in a
position to argue for a different wire — and doesn't want to. The
ZAP envelope format is also the on-chain LP-3031 envelope format; the
same `zapc`-generated codec serves both in-process RPC and on-chain
transaction payloads. One codec, one wire, two consumers.

### Alternative: switchboard as a HIP-0105 wasm extension

HIP-0105 (in-process extension runtime) supports user-supplied
modules in wasm / goja / pyvm / starlark. We considered shipping
switchboard as a wasm module loaded under `hz_routes/switchboard/`.

**Rejected** because:

- Switchboard needs deep IAM and KMS access — it would have to call
  back out of the wasm sandbox for every signing operation, which
  defeats the in-process-call performance argument.
- The audit-log hash chain requires append-only storage semantics,
  which the wasm sandbox cannot enforce without trusting the wasm
  module not to call `delete`.
- Multi-tenant SQLite handling and per-tenant DEK derivation are
  Go-side concerns that the wasm runtime cannot help with.

The Go subsystem path is correct. The wasm extension surface is
appropriate for user-supplied dispute-resolution policies (see
"Open questions" §1) but not for switchboard itself.

### Alternative: switchboard as a standalone microservice

Pre-HIP-0106, this is what switchboard would be. Post-HIP-0106,
shipping switchboard as a separate binary forces every reseller cloud
(`api.lux.cloud`, `api.zoo.cloud`, `api.osage.cloud`) to deploy a
second container, configure cross-binary auth, and pay JSON-marshal
overhead on every inter-subsystem call.

The HIP-0106 contract makes "same binary, different startup config"
the cheap default. Switchboard takes that default. Operators who
*want* to split switchboard out (because it churns at a different
release cadence, or because they want PCI isolation between
switchboard and the rest of the binary even though switchboard is
not CDE-connected) can do so via `CLOUD_SWITCHBOARD_ZAP_ADDR`; the
deps client is the same surface in either mode (per HIP-0106
§"Inter-subsystem client wiring").

### Alternative: fold into HIP-0025 (Bot Agent Wallet RPC Billing)

HIP-0025 specifies bot-agent wallet primitives for RPC billing. It
is a peer of switchboard, not a parent. HIP-0025 wallets *fund*
switchboard tickets; switchboard tickets *settle to* HIP-0025
wallets. A wallet is not an escrow ticket and vice versa. Trying to
merge them would either bloat HIP-0025 with state-machine logic that
does not belong in a wallet spec, or shrink switchboard into a
no-op pass-through. Two specs, one consuming the other, is the
right shape.

## Backwards Compatibility

No existing HIP-0106 subsystem mounts the `/v1/escrow/*` prefix.
There is no route conflict. The `Mount(*zip.App, cloud.Deps) error`
signature is the canonical HIP-0106 form; no breaking change to the
unified-binary contract is implied.

Existing switchboard consumers using the Python OSS library
(`pip install switchboard-agent`) keep working — the library can be
configured to point its escrow operations at either:

- a standalone switchboard service (legacy)
- a `hanzoai/cloud` deployment running the switchboard subsystem
  (this HIP)

Both surfaces expose the same `/v1/escrow/*` HTTP shape; the only
difference is the deployment topology. The OSS library version
0.5.0+ adds a `cloud_mode=True` configuration flag that activates
the HIP-0106 client semantics (JWT auth via deps.IAM, ZAP RPC
fallback, fail-closed stub behavior).

No on-chain primitive changes are implied by this HIP. LP-3031 is
specified independently in the Lux LP corpus and is the canonical
source for the on-chain surface; this HIP only documents how a
cloud deployment uses it.

## Reference Implementation

**Repository**: [github.com/kcolbchain/switchboard](https://github.com/kcolbchain/switchboard)

The reference implementation is being adapted from the existing
Python + Solidity codebase to add a Go-side subsystem package that
matches the HIP-0106 mount contract. Implementation phases:

- **Phase 1**: Go-side `Mount(*zip.App, cloud.Deps) error` package
  that wraps the existing HTTP API surface; in-process direct
  dispatch only. Target: 2026-07-01.
- **Phase 2**: ZAP schema published; `zapc generate` bindings
  produced; in-process ZAP-typed Deps client wired. Target:
  2026-07-15.
- **Phase 3**: LP-3031 anchored mode wired against Lux testnet
  precompile address `0x0c` (per LP-3031 §3). Target: 2026-08-01.
- **Phase 4**: LP-3031 full on-chain mode wired against the
  AgentEscrow genesis contract on Create Protocol testnet. Target:
  2026-09-01.
- **Phase 5**: Solana SPL rail. Anchor program (`agent_escrow`) deployed to
  Solana devnet; Python adapter (`switchboard.chains.solana`) merged into
  switchboard-agent; x402 `solana-spl` scheme draft published. Target:
  2026-12-01. In-progress reference: `internal/projects/switchboard/solana/`
  (Anchor program + Python adapter, DRAFT). Scheme draft:
  `internal/strategy/2026-06-12-x402-solana-spl-scheme-draft.md`.

**Demos and SOPs**: [https://switchboard.kcolbchain.com](https://switchboard.kcolbchain.com)
hosts the running demo lab, partner-facing economic-model SOP, and
the integration playbook (POC → Pilot → Retainer).

**Schema artifact**: `switchboard/schema/switchboard.zap` is the
source of truth for the ZAP-typed interface. Generated bindings
live under `switchboard/zap/gen/` and are not hand-edited.

## Security Considerations

### Threat model

The relevant adversaries:

**(T1) Malicious counterparty exfiltrating funds via fake dispute.**
A payee opens a dispute claiming non-delivery after the work has in
fact been delivered, hoping the dispute resolves in their favor and
they receive double payment. Mitigation: KMS-rooted commitment
signing means switchboard can prove cryptographically what state
the ticket was in at every transition; the audit log hash chain
makes after-the-fact tampering detectable; the dispute resolution
flow requires arbiter-role authorization (deps.IAM) and emits the
resolution as a signed event consumable by both parties.

**(T2) Operator collusion.** A cloud operator with switchboard
admin access tampers with ticket state to favor one party (e.g.,
silently marks a disputed ticket as `released` to the
operator-controlled payee). Mitigation: in `settlement_mode =
anchored | on-chain`, the on-chain LP-3031 record diverges from any
forged off-chain state, and the divergence is detectable by either
party reading the on-chain log. High-value tickets (configurable
threshold, default $1,000) require LP-3031 anchoring by policy.

**(T3) Replay.** A captured ticket-creation request is replayed
after the original was processed, with the goal of creating
duplicate tickets or causing double-funding. Mitigation:
mandatory client-supplied idempotency keys with a 72-hour dedupe
window plus a `UNIQUE` constraint on the storage tier; ML-DSA-65
signatures cover a canonical digest that includes the idempotency
key, so a replayed request hits the dedupe check before any state
change.

**(T4) Cross-tenant escalation.** A ticket in tenant A's namespace
is manipulated to release funds against tenant B's balance.
Mitigation: per HIP-0106 §"Tenant isolation", every switchboard
endpoint resolves `(app, org)` via deps.IAM from the JWT and refuses
to touch tickets outside the resolved org's SQLite file. The
per-tenant DEK plus the file boundary makes cross-tenant data access
structurally impossible.

**(T5) PQ adversary.** Forward-looking. ECDSA-based wallet sigs are
PQ-vulnerable. Mitigation: switchboard commitment signing uses
ML-DSA-65 (FIPS 204), aligned with HIP-0085 / HIP-0086 PQ wallet
standards. ZAP envelopes themselves carry ML-DSA-65 sigs per
LP-3031's PQ-only profile.

### Rate limiting

Per HIP-0044 (API Gateway), switchboard endpoints are rate-limited
at the gateway tier. Per-user limits (suggested defaults; tunable
per tenant):

| Endpoint | Limit | Window |
|---|---|---|
| `POST /v1/escrow/tickets` | 60 | per minute per user |
| `POST /v1/escrow/tickets/{id}/release` | 60 | per minute per user |
| `POST /v1/escrow/disputes` | 10 | per minute per user |
| `GET /v1/escrow/tickets` | 120 | per minute per user |
| `GET /v1/escrow/audit/*` | 30 | per minute per user |

### Key rotation

The per-tenant signing key is derived from the org's KMS master key
via HKDF. KMS master keys rotate per HIP-0027; switchboard caches
the derived signing key in memory for the lifetime of the
cloud-process replica and re-derives on KMS master-key version bumps.
Historical ticket commitments remain verifiable because each ticket
records the key version under which it was signed.

### Audit retention vs GDPR

Audit log retention is 7 years by default (financial regulatory
floor for transaction records). GDPR right-to-be-forgotten requests
are handled by zeroing the `actor_did` and `metadata` fields in
historical rows while preserving the hash chain integrity over the
remaining fields. The reference impl documents the redaction
procedure at `switchboard/docs/GDPR_REDACTION.md`.

## Test Cases

The reference implementation MUST pass at least the following
scenarios. Conformance suite at `switchboard/conformance/`.

1. **Happy path, off-chain.** Create ticket; fund; release. Audit
   log has 3 entries with valid hash chain. Settlement record
   created; commerce notified.

2. **Happy path, anchored.** Create ticket with
   `settlement_mode=anchored`; verify on-chain `AgentEscrow.commit()`
   tx hash recorded. Release; verify `AgentEscrow.attest()` tx hash
   recorded. Audit log carries both tx refs.

3. **Happy path, on-chain.** Create ticket with
   `settlement_mode=on-chain`; fund via on-chain `AgentEscrow.fund()`;
   release via on-chain `AgentEscrow.release()`. Off-chain mirror
   reflects on-chain state within 2 block confirmations.

4. **Double-create blocked by idempotency.** Same
   `Idempotency-Key` posted twice within 72 hours returns the same
   ticket id. After 72 hours, second request creates a new ticket
   (window expired by design).

5. **Dispute, resolved to payer.** Ticket funded; dispute opened;
   arbiter resolves to payer; funds return to payer; payee gets a
   `dispute_payout` settlement with amount 0; audit log shows full
   resolution path.

6. **Dispute, resolved to split.** Ticket funded; dispute opened;
   arbiter resolves with `{"payer_cents": 2000, "payee_cents": 3000}`
   on a 5000-cent ticket; two settlements emitted (one per party).

7. **Cross-tenant access refused.** Ticket created in tenant A;
   bearer-token request from tenant B for that ticket id returns
   `404 Not Found` (not 403, to avoid existence leakage).

8. **Anchor failure recovery.** LP-3031 RPC returns 500 on
   `AgentEscrow.commit()`; switchboard retries with backoff, holds
   ticket in `created` state, emits `switchboard.anchor_failed`
   metric. After RPC recovers, ticket advances to `funded`.

9. **Audit log tamper detection.** Tamper with a historical
   `audit_log.payload_hash` row; daily root-hash export shows
   divergence from the previous day's chain root; alert fires.

10. **PQ signature verification end-to-end.** Generate a ticket;
    fetch the per-tenant public key; verify
    `commitment_sig` against the canonical ticket digest using a
    third-party ML-DSA-65 verifier; pass.

## References

- HIP-0014 — Application Deployment Standard
- HIP-0018 — Payment Processing Standard (peer; switchboard sits
  alongside, not under)
- HIP-0025 — Bot Agent Wallet & RPC Billing Protocol (peer;
  consumed by switchboard tickets)
- HIP-0026 — Identity & Access Management Standard (auth boundary)
- HIP-0027 — Secrets Management Standard (KMS for derived signing
  key)
- HIP-0085 — Wallet PQ Account Type (ML-DSA-65 substrate)
- HIP-0086 — TX Auth Envelope (PQ envelope binding to ZAP)
- HIP-0106 — Cloud: Unified Hanzo Binary (mount contract verbatim)
- HIP-0302 — Encrypted SQLite + ZapDB Durability for Base Services
  (per-tenant storage substrate)
- HIP-0497 — hanzo-mpc (threshold-sig dispute resolution)
- **lux LP-3031 — Agent Payment Standard (on-chain primitive)** —
  `luxfi/LPs/LP-3031-agent-payment-standard.md` (external dependency)
- Switchboard repository — [github.com/kcolbchain/switchboard](https://github.com/kcolbchain/switchboard)
- Switchboard demo lab — [switchboard.kcolbchain.com](https://switchboard.kcolbchain.com)

## Open questions

1. **User-supplied dispute-resolution policies.** Some tenants want
   custom dispute-resolution logic (e.g., "auto-resolve to payer if
   payee unresponsive for 14 days"). HIP-0105 wasm modules are a
   natural fit. Should switchboard ship a built-in dispute-policy
   wasm host, or push that to a separate HIP? Suggest: defer to
   follow-up HIP; ship default policies hardcoded in Phase 1.

2. **Multi-chain LP-3031.** The Lux LP-3031 spec targets Lux subnets
   first. Should switchboard support LP-3031-equivalent contracts
   on Create Protocol L1, Ethereum mainnet, Base, Optimism? Suggest:
   yes via chain-id-keyed config (now formalized in the `chains:`
   map under §Configuration). The first non-EVM rail is Solana SPL (Phase
   5, 2026-12-01); EVM-compatible chains (Base, Optimism, Arbitrum, Create
   Protocol L1) reuse the LP182 rail with chain-specific RPC URLs. Cross-
   chain dispute resolution remains deferred to a separate HIP pending
   HIP-0101 bridge protocol maturity.

3. **Switchboard hosted-tier surface vs cloud-subsystem surface.**
   Switchboard sells a Hosted SaaS tier (per economic model SOP).
   Should the Hosted product run the cloud subsystem under the
   hood, or is the Hosted control plane a separate codebase that
   shares only the ZAP schema? Suggest: Hosted runs the cloud
   subsystem with `serve_mode=embedded`, gaining tenant isolation
   and operational unification automatically.

4. **Commerce settlement coupling.** When a ticket releases
   off-chain, switchboard emits a settlement event. Commerce can
   either treat it as an invoice line item (current draft) or as a
   credit-balance debit (per HIP-0018 + HIP-0026). Suggest: tenant
   chooses via config; default to invoice line item because it's
   the lower-trust mode (visible to the customer, reconcilable
   against on-chain anchors).

5. **MPP session adapter.** Tempo MPP sessions don't fit the
   one-ticket-one-work-unit shape — they're streaming micro-payments
   under a session cap. Should switchboard model them as a single
   parent ticket with sub-ticket children, or punt to a separate
   subsystem? Suggest: parent-ticket model with `metadata.session_id`
   on children; revisit if the implementation pressure suggests
   otherwise.

## Copyright

Copyright and related rights waived via [CC0](https://creativecommons.org/publicdomain/zero/1.0/).
