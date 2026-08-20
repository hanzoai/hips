---
hip: 1065
title: Connectors — A User's Own Credentials
author: Hanzo AI
type: Standards Track
category: Security
capability: connectors
status: Draft
created: 2026-08-20
requires: HIP-0026, HIP-0027, HIP-0126
---

# HIP-1065: Connectors — A User's Own Credentials

## Abstract

`/v1/connectors` is the per-**user** credential plane: a person links their own
accounts — by device sign-in, by pasting a token, or by handing over a bundle
obtained elsewhere — and the platform holds those credentials in custody on their
behalf. It is the sibling of the org-scoped integrations surface and shares its
registry, its store file and its custody client; only the key differs.

This HIP specifies the ownership model, the single custody exit, and the rotation
rule that keeps a refresh from destroying the credential it refreshes. The
implementation is `hanzoai/cloud` `apps/integrations/connectors.go`.

## Motivation

Two different questions look alike and must not share an answer. "Which accounts
has this **organization** connected?" is an administrative fact: an admin
connects, everyone in the org benefits, and disconnecting is an org decision.
"Which accounts has **this person** linked?" is not administrative at all — it is
the user's own property, invisible to their colleagues, and no admin gate belongs
on it.

Collapsing the two would mean either an admin gate on a user's private links or an
org's shared credential readable by anyone who can authenticate. Both are wrong in
the same direction.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted as
in RFC 2119.

### The pair is the key

Every read and write is bound to the (org, user) pair from the validated caller
(HIP-0026), and that pair **is** the row key. Another user's connector id is
therefore simply no row, answered 404.

There is no admin gate on this surface, by decision: a user owns their own
connectors, and an org admin who could read them could read their colleagues'
credentials.

A connector's id is its provider and its label. One user may hold several
connections per provider — a work account and a personal one — and the label is
what tells them apart.

### Custody

Customer credentials live only in the key store, sealed, under a path built from
the org, the user, the provider and the label
(`apps/integrations/integrations.go:1564`). The row holds non-secret metadata
only: external id, account label, granted scopes, expiry.

Intake is ordered, and the order is normative
(`apps/integrations/integrations.go:1662`):

1. Sanitize the provider's result.
2. Verify the credential live, before anything is stored. An unverifiable
   credential MUST NOT create a row.
3. Seal the secret. A custody failure is a 503 and MUST NOT fall through to a
   row.
4. Upsert the metadata row, then read it back.

Seal-before-row means there is no window in which a row claims a credential that
custody does not hold.

Pending device-sign-in state is not a secret in the key store: it lives encrypted
in the store's own grants table. It is short-lived, single-user material, and
giving it a custody path would put an unauthenticated flow's state in the same
namespace as verified credentials.

### One exit

Exactly one operation returns a secret: the token read for one connector, and only
to the same validated (org, user). No other response, row or log line may contain
a credential. Errors on the refresh path are token-free end to end.

### Rotation is single-flight, and adopts

A refresh runs when the access token is inside the expiry skew or when a caller
forces one. It MUST be single-flight per connection, keyed on the custody path,
and after acquiring the flight it MUST re-read the row and **adopt** a rotation
another flight already completed rather than refreshing again
(`apps/integrations/refresh.go:20`).

The reason is not efficiency. Providers invalidate the previous refresh token on
rotation, so a second concurrent refresh does not waste a call — it destroys the
credential. Adoption is what stops a burst of concurrent reads from logging a user
out of their own linked account.

A provider with static credentials, and a token still inside its lifetime,
degenerate to a plain custody read, so every provider presents the same operation
shape.

### One framework, N providers

A provider self-registers into the package registry, declaring how to begin
sign-in, exchange, verify, refresh and revoke. Handlers are provider-blind: they
resolve the provider from the path and apply the same ownership, custody and
validation to all of them. **Adding a provider is a new file, never a new route.**

## Rationale

The alternative to a per-user plane is to let a user's links ride the org's
connection row with a user column bolted on. It saves a surface and costs the
distinction that matters: every org-scoped read would have to remember to filter
by user, and the one that forgot would return a colleague's credential. Two
surfaces over one registry keeps the key explicit in the address.

## Security Considerations

This capability is credential custody, so the exposures are stated plainly.

- **Ownership.** The (org, user) pair is the row key rather than a filter applied
  after the fact, so a foreign id cannot be read by a query that forgot a clause.
  A foreign id and an unknown id give the same answer.
- **The single exit.** One operation returns secret material. Any second path
  that returned a token — a list that included it, a log line, an error message —
  would be a defect, not a convenience.
- **Path construction.** The custody path is validated before use, so a label or
  user id cannot smuggle structure into it.
- **Rotation.** Single-flight with adoption is a correctness requirement of the
  provider protocol, not an optimization; without it a concurrent read storm
  revokes the user's credential.
- **Intake.** Live verification before storage means the platform never holds and
  presents material it has never seen work.

## References

- HIP-0026 — Identity and Access Management
- HIP-0027 — Secrets Management
- HIP-0126 — Integrations, Connectors and the Extension Runtime

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
