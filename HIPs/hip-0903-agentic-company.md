---
hip: 0903
title: The Agentic Company — Autonomous Firms on Hanzo
author: Hanzo AI Team
type: Informational
category: Meta
status: Draft
created: 2026-07-26
requires: HIP-0902, HIP-1312
---



# HIP-0903: The Agentic Company — Autonomous Firms on Hanzo

## Preamble

A company is not a building, a headcount, or a logo. Strip it down and a company
is a **state machine with a bank account**: it comes into existence by filing,
it holds property, it signs agreements, it takes money in and pays money out, it
ships something, and it distributes the surplus to holders of record.

Every one of those states is already an API call. Not aspirationally — on this
cluster, today, under `api.hanzo.ai/v1`.

Once every transition is an API call, the question of who makes the call is an
implementation detail. It has been a human for four hundred years because the
transitions were paper and paper needs hands. They are not paper anymore.

This document is the argument that **autonomous companies are a build, not a
research problem**, an account of which organs Hanzo already provides, and an
honest ledger of what still requires a person and why.

## 1. The thesis: guards, not permissions

The instinct when handing work to agents is to reach for permissions — to
enumerate what the agent may do and trust it inside the fence. That is the wrong
primitive, and it fails the same way every time: the fence is a list, lists have
gaps, and an agent that is confused or captured walks through the gap.

The right primitive is a **guarded state machine**. The illegal move does not
exist. It is not forbidden, it is *unrepresentable*.

This is already how formation works in `apps/company/machine.go`:

```go
var transitions = []transition{
	{StageStructure, StageFounders, guardStructureChosen},
	{StageFounders,  StagePayment,  guardKYCVerified},
	{StagePayment,   StageDocuments, guardPaid},
	{StageDocuments, StageEsign,    guardDocumentsGenerated},
	{StageEsign,     StageGenesis,  guardSigned},
	{StageGenesis,   StageCompany,  guardGenesisRecorded},

	{StageStructure, StageImport,   guardSkipRequested},
	{StageImport,    StageCompany,  guardImported},
}
```

Its own comment says it plainly: *there is no edge that is not listed here, so
an illegal jump is refused by construction.* An agent cannot pay before KYC
clears. Not because it lacks a scope — because `{StageStructure, StagePayment}`
is not in the table. An agent driving this machine has exactly the authority the
machine grants, and no prompt, jailbreak, or misunderstanding widens it.

This is the same shape as HIP-0902's tier ladder, and the repetition is the
point. **Agents propose; machines accept.** Separate those two powers and
autonomy stops being a leap of faith and becomes ordinary engineering.

## 2. The organs

What an autonomous firm actually requires, and where it lives:

| Organ | What it must do | Hanzo |
|---|---|---|
| **Formation** | Exist in law | `/v1/company` |
| **Identity** | Prove who acts | `/v1/iam`, `/v1/idv` |
| **Legal** | Hold and sign agreements | `/v1/legal` |
| **Ownership** | Record who owns what | `/v1/captable` |
| **Capital** | Raise | `/v1/company/fundraise` |
| **Money** | Hold, move, settle | `/v1/finance`, `/v1/x402`, `/v1/wallet` |
| **Commerce** | Charge for things | `/v1/commerce`, `/v1/billing`, `/v1/pricing` |
| **Product** | Build and run software | `/v1/git`, `/v1/deploy`, `/v1/paas`, `/v1/functions` |
| **Demand** | Find and keep customers | `/v1/guide`, `/v1/crm`, `/v1/campaign` |
| **Observation** | Know its own state | `/v1/o11y`, `/v1/event`, `/v1/usage` |
| **Compliance** | Stay legal | `/v1/compliance`, `/v1/audit`, `/v1/sbom` |
| **Custody** | Hold secrets | `/v1/kms` |

Twelve organs. All mounted. That inventory is the actual claim of this document —
not that autonomous companies are coming, but that the surface a company runs on
already exists and is one identity model deep.

## 3. Formation — `/v1/company`

Two paths through the same machine.

**Incorporate.** `structure → founders → payment → documents → esign → genesis →
company`. Choose entity and jurisdiction (`c-corp`, `llc`, `dao-llc`), add
founders, clear KYC, pay the one-time formation fee, generate documents, sign
them, record the equity genesis, and terminate as an incorporated company.

**Import.** `structure → import → company`. An existing company brings its own
cap table and documents (`/import/captable`, `/import/documents`) and skips
straight to terminal. Companies that already exist are not second-class.

The endpoints are the machine's edges: `PUT /structure`, `/genesis`,
`/founders`, `/kyc`, `/kyc/decision`, `/kyc/refresh`, `/payment`,
`/documents`, `/esign`, `/esign/complete`, `/advance`, `/skip`, plus the
import pair (`/import/captable`, `/import/documents`), the fundraise trio
(`/fundraise/safe`, `/fundraise/round`, `/fundraise/deck`, section 6), the
platform register (`/register`, `/register/summary`, `/review`) and the
`GET|POST /v1/company` root — twenty-one paths, every one under `/v1/company`
(`manifest/apps.go:426`), published in `plugin/company/openapi.json`.

### The capability contract

The formation surface's contract — its store, its typed and declared operations,
its tenant, its meter, its stage and what an attacker gets from the wrong
implementation — is HIP-1312. What follows here is the argument, not the
specification.

### The genesis anchor

`StageGenesis` deserves attention, because it is the moment a company becomes a
machine-readable object rather than a filing cabinet.

The founding allocation — entity plus founders, sorted deterministically — is
hashed to a keccak root and committed to the Hanzo L1 (chain `36963`) by a
KMS-signed transaction, either an `EquityGenesis` contract call or a zero-value
self-transaction carrying `"HZEG"+root`. The chain is the source of truth;
`clients/graph` projects the anchored root for reads.

Two properties worth naming. First, **ownership becomes verifiable without
trusting Hanzo** — the root is on a public chain, and anyone holding the
allocation can recompute it. Second, and more carefully: when the RPC or signer
is not configured, the root is computed and returned with an honest `pending`
status. No fabricated transaction hash is ever recorded, and incorporation is
never blocked on an unconfigured chain. A system that will lie about anchoring
is worse than one that does not anchor, and this one refuses the lie.

### Two surfaces, one machine

Formation is operated from two places, and the split follows the admin-org
predicate rather than convenience.

**Founder-facing** — `cloud.hanzo.ai`. `console/src/components/products/
CompanyModule.tsx` drives the wizard against `lib/api/company.ts`, whose step
list mirrors the Go machine edge for edge. A founder advances their own
formation and nothing else.

**Platform-facing** — `POST /v1/company/kyc/decision`. This is a **SuperAdmin
operation**, not a gate on the founder's path, and the distinction is the whole
design.

A gate is a predicate over someone else's action. This is not that. Hanzo forms
the entity, so Hanzo carries the formation KYC/AML obligation — the reviewer
decision is *Hanzo's own act*, discharging *Hanzo's own duty*. `IsSuperAdmin` is
not a check bolted onto the tenant flow; it is the authority scope the operation
inherently has, because the obligation belongs to the platform and the platform
is the only cross-tenant scope.

The two planes stay orthogonal:

```
SuperAdmin operation   →  produces a fact   (founder.KYCStatus, founder.DecidedBy)
tenant machine guard   →  reads that fact   (guardKYCVerified)
```

The operation never advances the formation. The guard never calls SuperAdmin.
One writes a value, the other reads it, and neither knows the other exists —
which is why an agent driving the machine cannot reach the review, and a
reviewer cannot accidentally advance a tenant.

Two details are worth preserving because they are easy to get wrong:

- The reviewer path produces a **distinct** `KYCReviewerConfirmed`, never a
  provider `verified`. The manual route does not launder itself into looking
  like the automated one. Downstream, "a human confirmed this" and "a provider
  verified this" remain different facts forever, which is what an auditor
  actually needs.
- The decision is **attributed** — `DecidedBy = reviewer` — satisfying
  individual accountability for a privileged act.

The authority model is therefore already right. What does not exist yet is the
**UI**: `admin/apps` carries `operator`, `admin-base`, `admin-commerce`,
`admin-bot`, `admin-tasks`, `analytics`, `insights` — and no formation review
queue. A reviewer today calls the endpoint directly.

That is one missing admin app following the established `admin-*` pattern: a
queue of founders pending KYC, the provider payload, approve/reject posting to
`/kyc/decision`. Small, and worth naming rather than glossing, because a
back-office whose only interface is `curl` is a back-office that will not be
used consistently. And the review is not a formality Hanzo performs for a
customer — it is how Hanzo discharges its own KYC/AML obligation, so performing
it inconsistently is a compliance failure of the platform, not a degraded
experience for the tenant.

### Tracking formations platform-side

If the obligation is Hanzo's, the **record** must be Hanzo's.

`apps/company/store.go` answers two questions under two keys. `Get(ctx, org)` is
one tenant's formation. `List`, `Count` and `Pending` read across the whole book,
which is what answers "how many founders are awaiting review", "which formations
have been sitting at `documents` for three weeks", and "show me every entity we
formed this quarter" — the question a regulator asks.

That book is `/v1/company/register`, its shape in one read is
`/register/summary`, and the founders whose KYC is unsettled are `/review`,
oldest first, so the queue drains in the order they have waited. All three are
platform operations over the same table: a caller who is not a platform reviewer
gets 403, and none of them advances a stage. The register reads, the machine
runs, and the orthogonality above survives the register existing.

### Two clocks

The deeper structural point, and the reason this is not just a missing `SELECT`.

The formation machine models **what Hanzo controls**: choose a structure, collect
founders, take payment, generate documents, route signature, anchor genesis.
Every one of those completes on Hanzo's own clock.

Incorporation does not. The State of Delaware responds when it responds. So does
the IRS for an EIN, the registered agent, and the bank. These are third parties
with human latency measured in days, and no guard can make them faster.

Conflating the two clocks fails in one of two ways: either the machine blocks on
an external party — a tenant stuck at a stage nobody at Hanzo can advance — or it
advances optimistically and **lies**, reporting a company as formed before the
state has said so. The genesis anchor already refuses that second failure by
returning honest `pending` rather than a fabricated hash; the filing track needs
the same discipline.

So they stay separate. The formation machine runs Hanzo's path. A parallel
**filing record** tracks each external obligation on its own clock:

```
struct Filing
  namespace  Text
  kind       Kind      # jurisdiction, ein, agent, bank
  authority  Text      # "delaware-sos", "irs"
  status     Status
  submitted  Int64
  responded  Int64
  reference  Text      # the authority's file number
  updatedBy  Text      # the reviewer who last touched it
  note       Text

enum Status
  todo
  submitted
  pending     # with the authority, awaiting response
  action      # they responded, we must do something
  done
  rejected
```

`/v1/legal/filings` already exists as the surface. What it needs is binding to
the formation and an honest **manual** update path — because a human at Hanzo
reading an email from Delaware and typing the file number *is* the correct
implementation. There is no API to poll. Pretending otherwise would produce a
system that quietly reports stale state, which is worse than one that plainly
says "waiting on Delaware since the 12th".

This is the shape of the whole back office: automate Hanzo's clock completely,
track the third party's clock honestly, and make the waiting visible rather than
hiding it behind a spinner. `status: pending` with a `submitted` date is a real
answer. A progress bar is not.

Two steps in the founder wizard are still marked `stub: true` — KYC and e-sign —
meaning the provider integrations are surfaced but not fully wired. Those are
the same two gates section 8 identifies as human by law, which is not a
coincidence: they are where the machine hands off to a person, and handoffs are
the last thing to get built.

## 4. Legal — `/v1/legal`

Templates, documents, signature, filings: `/templates`, `/documents`,
`/documents/:id/sign`, `/documents/:id/sign/complete`, `/filings`.

An agent drafts from a template, routes for signature, and tracks the filing.
What it cannot do is *be* the signatory — section 8.

## 5. Ownership — `/v1/captable`

The full instrument set, not a toy: `/stakeholders`, `/share-classes`, `/shares`,
`/shares/transfer`, `/options`, `/equity-plans`, `/safes`, `/convertibles`,
`/rounds`, `/rounds/:id/close`, `/rounds/:id/investments`, `/summary`.

This is the organ most often hand-waved in "AI company" pitches, and it is the
one that determines whether the entity is real. A company that cannot issue a
share class, grant options against a plan, and close a priced round is a
storefront. This one can.

## 6. Capital — `/v1/company/fundraise`

`/fundraise/safe`, `/fundraise/round`, `/fundraise/deck`.

A SAFE is a document plus a cap-table entry — both organs already present, so
the endpoint is composition rather than new machinery. `/fundraise/deck`
generates the narrative from state the company already holds: its metrics live
in `/v1/event` and `/v1/usage`, its ownership in `/v1/captable`, its revenue
in `/v1/commerce`. A deck assembled from live state instead of a founder's
recollection is strictly more honest, which is an underrated argument for
automating it.

## 7. Money, commerce, product

**Money.** `/v1/finance/accounts`, `/v1/finance/treasury`, with admin sweep,
policy, and anchoring under `/v1/admin/treasury`. Ledger discipline through
`apps/treasury/ledger`. On-chain settlement via `/v1/wallet` and
`/v1/smart-wallets`. And `/v1/x402` — HTTP-native payment, where a request
carrying insufficient funds gets `402` and a settlement path rather than a
rejection. That matters more than it sounds: **x402 is how one agent pays
another without either holding a card.** It is the payment rail that does not
assume a human at the checkout.

The payer is one value in one place — `hanzoai/account.Payer` — because the
alternative was four copies disagreeing and `402`-ing funded customers.

**Commerce.** `/v1/commerce`, `/v1/billing`, `/v1/pricing`, `/v1/plans`,
`/v1/entitlement`, `/v1/marketplace`, `/v1/referral`, `/v1/affiliate`. Price,
meter, invoice, collect, gate on entitlement, pay partners.

**Product.** `/v1/git` (native, no forge dependency), `/v1/builds`, `/v1/deploy`,
`/v1/paas`, `/v1/sites`, `/v1/functions`, `/v1/clusters`, `/v1/machines`. Code
enters at `/v1/git` and leaves as something serving traffic, with no vendor in
the path.

**Demand.** `/v1/guide` — the GTM autopilot — plus `/v1/crm`, `/v1/campaign`,
`/v1/marketing`, `/v1/ad`, `/v1/social`, `/v1/content`.

**Observation.** `/v1/o11y`, `/v1/event`, `/v1/usage`, `/v1/costs`. A firm that cannot read its own state cannot govern itself, and
autonomy without self-observation is just an unattended process.

## 8. What still requires a human, and why

The honest section. Three gates are human by **law**, not by missing product:

1. **KYC.** `guardKYCVerified` runs against a natural person. Jurisdictions
   require an identifiable human behind an entity. This is the deepest gate and
   it is not going away.
2. **Signature.** Formation documents are executed by a person with capacity to
   contract.
3. **The formation fee.** Paid from an instrument belonging to someone.

An agent is not a legal person. It cannot be a director, cannot hold capacity to
contract, and cannot be liable. Any claim otherwise is false today in every
jurisdiction we would incorporate in.

So the accurate statement is narrower and, I think, more interesting than the
maximal one:

> **A human signs a company into existence. After genesis, agents can run it.**

The human is the root of trust, applied once, at the boundary where law demands
a person. Everything downstream — issuing shares, closing rounds, pricing,
billing, deploying, hiring vendors, paying invoices, filing — is a machine
transition an agent can drive under guards.

`StructureDAOLLC` is in the enum because Wyoming's DAO LLC is the closest legal
vehicle to on-chain governance: it permits the operating agreement to point at
code. It narrows the human surface. It does not eliminate it, and this document
will not pretend otherwise.

## 9. Autonomous development

An autonomous company must be able to change its own product, which is the
problem HIP-0902 exists to solve.

Agents propose ref updates. The tier ladder gates them: structure, novelty,
hermetic build with passing tests, a panel of model judges that may reject but
never approve, and human authority reserved for policy. A quorum accepts and the
ref moves. Merged code is code that independent machines built, independent
judges failed to fault, and a quorum signed.

That closes the loop. `/v1/company` gives the firm a legal body,
`/v1/commerce` gives it a metabolism, and HIP-0902 lets it change its own
substance without a person in the merge path. The firm can then observe itself
through `/v1/o11y`, decide through its agents, and act through the same API
surface a founder would use — because it is the same surface. There is no
separate "agent API." There is one control plane, and agents are ordinary
principals on it.

## 10. Per-namespace autonomy

No two companies want the same autonomy. Policy is keyed by `namespace` — one
value, one lookup, no `{type, id}` pair — and each organ declares how far it
runs unattended:

```
struct Autonomy
  namespace  Text
  organ      Text      # deploy, spend, hire, file, merge
  mode       Mode
  ceiling    Int64     # currency minor units, where money is involved
  approvers  List(Text)

enum Mode
  off        # humans only
  advise     # agent proposes, human accepts
  bounded    # agent acts under ceiling
  full       # agent acts
```

A company might run `merge: bounded`, `spend: bounded` with a ceiling,
`file: advise`, and `hire: off`. Autonomy becomes a dial per organ rather than a
single switch, and it ratchets on evidence: run `advise`, read the log, and
promote the organs that earned it.

## 11. Why this is worth building

Three reasons, in order of how much I believe them.

**Cost.** The floor cost of a company is currently a person's attention on a
dozen mechanical loops — invoicing, filing, renewals, reconciliation, dependency
bumps. None of it needs judgment. Pushing that floor toward zero changes which
businesses are worth starting, which is a larger effect than making existing
businesses cheaper.

**Honesty.** A machine-run company reads its numbers from its ledger. A deck
generated from `/v1/captable` and `/v1/commerce` cannot round in its own favor.
Automating the reporting path removes a whole category of well-intentioned
misstatement.

**Composability.** Once firms are machine-legible, they compose. Agent-to-agent
commerce via x402 needs no human at either end of the transaction, and a
counterparty that is an API rather than a sales cycle is a genuinely different
economic object.

The claim is not that companies should run without people. It is that the
mechanical fraction should run without people, so the human fraction is judgment
— which is the part people are actually good at.

## 12. Open problems

1. **Liability.** An autonomous company that causes harm has a responsible
   party, and that party is a human. Guards bound the damage; they do not
   relocate the responsibility.
2. **Ceilings are not intent.** `bounded` spend stops an agent exceeding a
   number, not an agent spending the number badly.
3. **Formation is human by law.** Section 8. Do not build as though this will
   change.
4. **Judges are attack surface.** HIP-0902 §6 — reject-only, never grant.
5. **Anchoring depends on chain liveness.** Genesis degrades to honest `pending`.
   Correct, and it means ownership verifiability is best-effort until confirmed.
6. **Autonomy needs an off switch that agents cannot reach.** `Mode` must be
   settable only by a human quorum, or the dial governs nothing.
7. **Third-party clocks are unautomatable.** Delaware, the IRS, agents and banks
   respond on their own schedule through human channels. Track them honestly;
   do not model them as guards.

## References

- HIP-1312 — Company — The Formation Machine, the capability this argues for
- HIP-0902 — Proof of Code, consensus over git refs
- HIP-0901 — Proof of AI, native execution proofs
- `apps/company/machine.go` — the formation machine, single source of truth
- `apps/company/genesis.go` — equity genesis anchor, Hanzo L1 `36963`
- `apps/captable`, `apps/legal`, `apps/treasury`, `apps/x402`
- `hanzoai/account.Payer` — one payer, one place
