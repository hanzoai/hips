---
hip: 1141
title: Pref — One Document Per Person
author: Hanzo AI
type: Standards Track
category: Interface
capability: pref
status: Final
created: 2026-08-20
requires: HIP-0026, HIP-0106, HIP-0139
---

# HIP-1141: Pref — One Document Per Person

## Abstract

`/v1/pref` is the signed-in user's own UI state — theme, density, pinned nav —
one JSON document per person, following them across every Hanzo surface. It is
implemented in `hanzoai/cloud` at `apps/pref`. This HIP states the two facts
that define it: the tenancy key is the USER, not the org, and the write is a
shallow merge so no surface can delete another surface's keys.

## Motivation

Each app keeping its own copy of a person's settings in its own localStorage
makes the same person look like two different users depending on which tab they
are in (`apps/pref/prefs.go:7-11`). One store behind the user menu ends that.
It is deliberately NOT `settings`: settings is per-org, per-product
configuration with KMS custody for secret fields; collapsing the two would put
one user's theme under an org key and make an org admin the owner of everyone's
UI (`apps/pref/prefs.go:31-35`).

## Specification

The key words MUST, MUST NOT and SHOULD are to be interpreted as in RFC 2119.

### The store

One system-namespace SQLite file, `prefs.db`, opened through `sqlpool.Open` —
born encrypted under the cek-derived key, single-connection
(`apps/pref/store.go:47-58`). One row per subject, holding an opaque JSON
document the server bounds but never interprets. It MUST hold no secret: a
preference that needs custody does not belong in this table.

### Addresses

Two operations at one path:

- `GET /v1/pref` — a typed op. A caller who has never saved anything gets an
  empty document at 200, never a 404, so the user menu always renders.
- `PATCH /v1/pref` — an untyped handler declared with prose
  (`apps/pref/prefs.go:115-128`), because three of its wire facts are
  unreachable from a typed op (`apps/pref/prefs.go:148-165`): a 16 KiB
  request-byte cap answering 413, an empty or literal-`null` body answering 400
  where zip's decode would make both a successful no-op, and an OPEN key space
  whose only carrier — `map[string]any` — publishes no request body at all.

PATCH, not PUT: a surface saves the keys it owns without having to send back
keys it does not know about. The merge is shallow, a named key is replaced
whole, a `null` value deletes its key, and the merge runs inside one store
transaction so two tabs saving different keys both survive
(`apps/pref/store.go:93-101`). A document over 16 KiB or 128 keys is refused.

### Tenancy

The subject is the canonical `<owner>/<name>` identity built from values the
identity boundary minted from a validated credential (HIP-0026), and it is the
mandatory predicate on every store statement (`apps/pref/prefs.go:202-215`).
The bare user name is not unique across orgs — `hanzo/z` and `admin/z` are two
people — which is why the org qualifies the key. There is deliberately NO path
to another user's preferences: not for an org admin, not for a platform
SuperAdmin, because no operational task requires reading someone's theme. An
unvalidated principal is 403.

### Money, events, telemetry

Free, said in those words: `plugin/pref/main.go` declares `cloud.Free` and the
app appears in no metered list. It publishes nothing to the bus, so a
customer's webhooks receive nothing from it. It emits nothing beyond the
request span every route gets.

### Stage

`ga`: the personal half of the identity core — every signed-in surface reads
it — and its manifest row (`manifest/apps.go:362`) declares no stage.

### Upstream

Derives from none. The store is the platform's own encrypted SQLite through the
one shared opener; nothing external is forked, embedded or mirrored.

## Rationale

The alternative tenancy key is the org, which every sibling store uses, and it
is wrong here in a way that matters: preferences are personal, and an org key
makes the org's admin their reader. Keying on the qualified user and refusing
every cross-read — rather than gating cross-reads behind admin-ness — removes
the check that could be forgotten. The alternative to server-side merge is
client-side read-modify-write, which is a lost update the moment two tabs save
different keys.

## Security Considerations

The wrong implementation is an identity fold. Key on the bare user name and two
users named `z` in different orgs read and overwrite each other's documents —
which is why the subject is `<owner>/<name>` and both halves are length-bounded
before use, so an oversized forged header cannot become a giant primary key
(`apps/pref/prefs.go:199-214`). The document bound is the other exposure: an
unbounded personal, unaudited row becomes free general-purpose storage, so the
16 KiB / 128-key caps are enforced on the raw bytes before any parse.

## References

- HIP-0026 — Identity and Access Management
- HIP-0106 — The Hanzo Plugin Contract
- HIP-0139 — Capability

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
