---
hip: 1000
title: Authors — A Royalty on Deployed Open Source
author: Hanzo AI
type: Standards Track
category: Application
status: Active
created: 2026-08-20
requires: HIP-0139
capability: authors
---

# HIP-1000: Authors — A Royalty on Deployed Open Source

## Abstract

`/v1/authors` is a royalty program: an author proves control of a repository, and
every org that deploys a project built from that repository generates a royalty
against its own metered spend. It is implemented in `hanzoai/cloud` at
`apps/authors`. This HIP states the contract the program must hold to — how
attribution is proven, how a royalty amount comes to be, and the line between
recording money and moving it.

## Motivation

Open-source work already runs on the platform and already generates spend. There
was no edge connecting the two, so the spend had no author and the author had no
claim. `apps/authors` supplies that edge; this HIP supplies the rules it must not
break, because every one of them is about somebody else's money.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted as
in RFC 2119.

### Attribution proves control of code, not identity of a person

A repository earns only after a verification that demonstrates control over it:
either a forge token showing admin or push permission, or a file on the default
branch carrying the author's minted verify code (`apps/authors/authors.go:20-23`).
Both prove the same fact — that the claimant can change what that repository
deploys. Neither is a claim about who the claimant is, and the program MUST NOT
treat it as one.

A deploy edge is recorded per `(repo, project, deploying org)` and is idempotent
(`apps/authors/authors.go:24-26`). Without that edge nothing accrues, so an
unattributable deploy earns nothing rather than earning by default.

### The royalty is a latch, not a computation over history

Accrual is at most once per `(author, deploying org, period)`. The amount is that
org's metered spend for the period times the share stored on the author at that
moment: `earningCents = spendCents * shareBps / 10000`
(`apps/authors/basis.go:48`), evaluated in `accrueOne`
(`apps/authors/authors.go:336`).

The row written by the latch captures `share_bps`, `spend_cents` and
`earning_cents` in the same transaction as the balance increment. That row is a
**value**, and it MUST be served verbatim and never recomputed
(`apps/authors/basis.go:15-30`). A later rate change, a share renegotiation or a
restated spend figure therefore cannot rewrite what an author was already told
they earned.

The current rate card is a **model**, not a value, and MUST be served separately
and labelled with its `asOf`. Stamping a card onto a historical row would be a
fabrication by construction: one row's spend can span several cards' pricing
windows, and some of its components were never priced by a card at all.

An author's own org is excluded from the fold (`apps/authors/authors.go:311-313`),
so the program cannot pay a royalty on self-dealing.

A per-org spend read that fails is skipped and picked up on the next sweep
(`apps/authors/authors.go:320-323`). A partial answer that is correct beats a
whole answer that is wrong.

### Accrual records what is owed; payout records a disbursement; neither moves money

`accrued` only rises. `paid` rises only when a payout is recorded, and a payout
MUST NOT exceed `pending = accrued − paid`, reserved atomically before anything
else happens (`apps/authors/store.go:1058-1064`, refusal text at
`apps/authors/typed.go:113-117`). A recorded payout that the treasury cannot back
is voided rather than left standing (`apps/authors/store.go:1100`).

No route in this capability settles money. A human does that out of band. The
program is a ledger of obligation.

### Identity is never an input

The earning org is read from the validated principal, never from a request field.
The platform-wide operations are admitted only by a SuperAdmin bit that the
identity boundary mints and that the ordinary principal does not carry
(`apps/authors/typed.go:84`).

The support view of an author's basis MUST be produced by the same builder as the
author's own read (`apps/authors/typed.go:845`), so support and author can
never be looking at two numbers.

### Store, price, events, telemetry, stage, upstream

The capability owns one encrypted SQLite database, `authors`, opened through the
one opener (`sqlpool.Open("authors", dir)`, `apps/authors/store.go:177`). It is
free, in those words: `Price: cloud.Free` (`plugin/authors/main.go:21`) — it
records obligations and meters nothing. It publishes no events on the bus, so a
customer's webhooks receive nothing from it; money actions land best-effort
records on cloud's audit trail (`apps/authors/authors.go:133`, `:475-479`).
Beyond that and the request span it emits log lines only. Its stage is `beta` —
the manifest row declares it (`manifest/apps.go:388`, `Stage: Beta`; HIP-0139
§8). It derives from no forked, embedded or mirrored OSS project.

### What this refuses

- **No disbursement.** There is no address here that moves money, and adding one
  would put a mint authority behind an accrual sweep.
- **No recomputation.** There is no address that re-derives a historical row.
- **No per-row rate card.** The card is current or it is absent.
- **No 404 on "not enrolled".** A caller who has never enrolled gets an honest
  short answer, because 404 on that address answers "is this org an author" to
  anyone who asks (`apps/authors/typed.go:208-210`).

## Rationale

The obvious alternative is to compute the royalty on read: keep no ledger, and
derive the number from current spend and the current share whenever someone looks.
It costs auditability. The author's dashboard number would change when a rate
changed, without anything having happened, and no one could reconstruct what they
had been told last month. The latch buys immutability for the price of one row.

The second alternative is to settle automatically at sweep time. That braids a
disbursement authority into a scheduled job, which is the shape where a single
arithmetic defect becomes a fleet-wide payout. Splitting accrue from pay means the
worst outcome of a defect in the sweep is a wrong number on a screen.

## Security Considerations

Verification is the only thing standing between an arbitrary caller and another
project's earnings. The file method proves default-branch control, which is the
right property — someone who can change the default branch can already change what
deploys — but it does mean a repository whose default branch is writable by many
is claimable by any of them.

The share and status operations sit behind the SuperAdmin bit. That bit is a header
only the identity boundary can mint; any deployment that lets a client set it
directly hands over the ability to approve authors and record payouts.

The payout ceiling is the one arithmetic guard that stands between a recorded
obligation and an over-payment, and it is enforced by reservation rather than by a
read-then-write, because a read-then-write races.

## References

- HIP-0135 — What Is Public

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
