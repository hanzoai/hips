---
hip: 1001
title: Books — The Double-Entry Ledger
author: Hanzo AI
type: Standards Track
category: Application
status: Active
created: 2026-08-20
requires: HIP-0139
capability: books
---

# HIP-1001: Books — The Double-Entry Ledger

## Abstract

`/v1/books` is double-entry accounting for an org: a chart of accounts, an
append-only general ledger, bank feeds with reconciliation, receipt capture, and
the reports that prove the books balance. It is implemented in `hanzoai/cloud` at
`apps/books`. This HIP states the two properties that make it trustworthy — that
it records money it never moves, and that every posting balances or is refused.

## Motivation

The money plane holds balances and the customer-facing billing surface projects
them. Neither keeps books: a chart of accounts, a general ledger, revenue
recognition, a trial balance. Without those there is no statement anyone can audit
and no way to answer a question about last quarter that survives a restatement.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted as
in RFC 2119.

### The surface, and what stays untyped

Every address is under `/v1/books` — twenty-one prefixes enumerated in the
manifest row (`manifest/apps.go:412`), twenty-two paths published in the
capability's own subset (`plugin/books/openapi.json`). Twenty operations are
typed; five are untyped by design and each is named at its registration and held in a ledger
test (`apps/books/projection_test.go`): the three raw-byte uploads —
`POST /v1/books/scan`, `POST /v1/books/inbox` and `POST /v1/books/bank/import`
take the receipt or statement file ITSELF as the body, which no JSON `In` can
describe, so each declares its byte request through `openapi.Register` with
`openapi.Binary` — and two link stubs that answer an unconditional 501 and
deliberately declare nothing. The two ledgers must sum to the served surface,
so a route added untyped goes red rather than unlisted.

### Free, metered nowhere, publishing nothing

Every books route is **free** — the plugin declares `Price: cloud.Free`
(`plugin/books/main.go:21`) and no handler gates or meters spend. Books spends
no provider's money: it restates the ledger feed it reads. It publishes **no
events** on the bus, so a customer's webhooks receive nothing from this
capability, and it emits nothing to observability beyond the request span
every route already gets — there is no tracer, meter or log surface of books'
own in `apps/books`.

### Stage

Books is a vertical application, not the agentic-OS core: its stage is
**beta**, declared in the manifest row (`manifest/apps.go:412`, `Stage: Beta`;
HIP-0139 §8).

### Upstreams

One OSS library is embedded: `rsc.io/pdf` (BSD-3-Clause), which parses bank
statements on the PDF import path (`apps/books/import_pdf.go:46`) — the text
extraction survives in HEAD, nothing else of it does. The Plaid and Teller
bank connectors (`apps/books/plaid.go`, `apps/books/teller.go`) are
hand-written read-only clients to those services, not forks of anything.

### It records money; it never moves money

Three sources post into the ledger: the platform's own transaction feed, a
read-only bank connector, and a reviewed receipt capture. All three land through
one choke point, `store.post` (`apps/books/store.go:238`), and none of them can
mint a deposit, a credit or a payout (`apps/books/books.go:14-19`).

This is the invariant the whole capability rests on: **books can restate money,
never create it.** Any new posting source MUST arrive through the same choke point
and MUST carry no authority to move funds.

### A voucher balances or it is refused

A posting is a set of legs in exact integer minor units. Floating point is
forbidden: cents are exact under add, subtract and negate, which are the only
operations double-entry performs, so there is no rounding error to accumulate
(`apps/books/gl.go:11-14`).

The pipeline is pure and database-free (`apps/books/gl.go:55-65`): merge legs on
the same account, reduce each leg to a single non-negative side, absorb a residual
difference within the round-off allowance, then assert `Σdebit == Σcredit`. A
difference larger than the allowance MUST fail closed rather than be plugged
against equity (`apps/books/gl.go:17-21`). The allowance exists only to soak up a
one- or two-cent artifact of an upstream split.

Idempotency is `(sourceKind, sourceID)`: the same source event posts exactly once,
so replaying a feed is a no-op rather than a duplicate.

### Each org's books are physically separate

Every read resolves the caller's own org from the validated principal, and each
org's ledger is its own database file, with the sandbox ledger a second, separate
file (`apps/books/books.go:22-26`, `apps/books/books.go:44-47`). A test-mode row
therefore cannot reach real revenue, and one org cannot read another's ledger even
in the presence of a query defect, because the other org's rows are not in the
file being queried.

### The language surface may rephrase a figure; it may never source one

The plain-language question surface routes deterministically to metrics computed
from the ledger, and the model — when one is configured at all — rewrites prose
without touching a number (`apps/books/ask.go:4-16`). With the model absent or
down, the figures are identical. The brain is strictly read-only and MUST NOT
reach the posting path.

### Bank credentials live in the key service or the operation fails

Connector access tokens are stored and fetched through KMS and MUST NOT be
persisted in the ledger database. A deployment with no key service wired fails
every credentialed bank operation closed (`apps/books/books.go:55-59`).

### What this refuses

- **No manual journal door.** Postings come from the three declared sources.
- **No float.** An amount is integer cents or it does not enter.
- **No cross-org read.** The tenant is not an input.
- **No model-sourced figure.** Narration is prose only.

## Rationale

The alternative to a separate posting choke point is to let each source write its
own legs. It is easier and it is how the imbalance gets in: three writers means
three places where the balance assertion can be skipped, and the assertion is the
only thing that makes a trial balance mean anything.

The alternative to per-org database files is one database with a tenant column.
That works until one query forgets the predicate. Separate files make the
forgetting harmless, and the cost is bounded because the ledger is small.

## Security Considerations

What an attacker gets from the wrong implementation is one of two things: a
posting source that carries authority to move funds turns a bookkeeping bug
into minted money, which is why every source lands through the one choke point
that cannot mint (`apps/books/books.go:14-19`); and a tenancy defect here is
not a leak of preferences but of a company's finances.

A ledger is a disclosure surface: revenue, vendors, payroll shape. Tenancy is
therefore enforced by physical separation rather than by a filter, and the tenant
key is read from the validated principal rather than from any caller-supplied
field.

The bank connector is the one component holding a third-party credential. Keeping
those in the key service means a copy of an org's ledger file is not a copy of its
bank access.

The read-only posture of the question surface is a security property, not only a
correctness one: it is what makes it safe to hand a language model an ability to
answer questions about the ledger.

## References

- HIP-0135 — What Is Public

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
