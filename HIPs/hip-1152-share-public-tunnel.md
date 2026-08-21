---
hip: 1152
title: Share — A Public URL for a Local Service
author: Hanzo AI
type: Standards Track
category: Infrastructure
capability: share
status: Draft
created: 2026-08-20
requires: HIP-0026, HIP-0106, HIP-0139
---

# HIP-1152: Share — A Public URL for a Local Service

## Abstract

`/v1/share` publishes a service on your own machine to a public
`https://<token>.share.hanzo.ai` URL, and lists what you have open. It is
implemented in `hanzoai/cloud` at `apps/share` as the thin, org-scoped control
surface over a zrok controller: it provisions a per-org tunnel account from the
caller's validated identity and hands the CLI the credential it needs, so
`hanzo share 3000` needs zero manual setup. The heavy data plane — the ziti
fabric and the public frontend proxy — stays a separate runtime by design.

## Motivation

A tunnel needs an account, and an account is exactly the kind of manual setup
that makes a developer tool go unused. Folding the control surface into the one
cloud binary means the account is derived from the identity the caller already
holds; the alternative — each developer registering against the controller by
hand — puts a second credential system beside IAM for no property in return.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted as
in RFC 2119.

### It owns no store

Provisioning is stateless: the per-org account is keyed deterministically off the
org slug — email `share+<org>@hanzo.ai`, password
`HMAC(SHARE_ACCOUNT_SECRET, org)` — so ensure-account plus login reconstruct the
same credential every time from the controller. The controller IS the store
(`apps/share/client.go`). Creating an existing account is ignored; login always
returns the current account token, so `enable` is idempotent and a repeat call
hands back the same account rather than creating a second one.

### The address

Two typed operations: `POST /v1/share/enable` (provision the caller org's tunnel
account and return the credential, controller endpoint, namespace and URL
template the CLI needs) and `GET /v1/share` (the org's active shares, for the CLI
and console). The list answers empty rather than absent when there are none.

### Tenancy

The org is resolved in one place before any handler touches the controller
(`gate`, `apps/share/share.go`), from `principal.Acting` — the typed-op reader of
the validated org — never from an input field, which is caller-supplied and would
make a tenant key the caller's to assert. A caller can only ever provision or
list its OWN org's account.

### Fail-closed

Absent the controller admin credential (`ZROK_ADMIN_TOKEN`, KMS-injected into the
environment), every operation MUST answer an honest 503; the surface never
fabricates a share or a token. An unreachable controller is 502.

### Money, events, observability, stage

It is metered (`plugin/share/main.go:28`, `Price: cloud.Metered`;
`spend.go:313`), and the billed act is the provision: `enable` creates one
tunnel account on the fabric using the platform's credential, authorized
before the fabric is asked and debited once at `SHARE_FEE_CENTS`
(`apps/share/meter.go`). The unit is the account, once per org — enable is
idempotent, so a repeat call hands back the same credential unbilled, and
reading shares back is free whatever the balance. The bytes themselves never
cross this process, so there is no traffic here to meter. It publishes
nothing on the bus and emits nothing beyond the request span every route
gets. The stage is `beta`: the manifest row declares it
(`manifest/apps.go:335`, `Stage: Beta`); it is developer tooling in the core
loop, the server half of the `hanzo share` command, reached by flag while
the fabric deployment settles.

### Upstream

It fronts the zrok controller (github.com/openziti/zrok, Apache-2.0), run as its
own deployment together with the ziti fabric it rides on. None of zrok's code is
linked into cloud — the control client here is hand-written against the
controller's REST API, and the API base is env-selectable so the fork's move of
that API under `/v1` is a config edit, not a rebuild
(`apps/share/client.go:53-62`).

## Rationale

The alternative to a thin control surface is folding the whole tunnel stack into
the cloud binary. The data plane is long-lived connections and a public proxy —
a different failure domain and a different scaling shape from a request-scoped
API — so the split keeps the binary's blast radius out of every open tunnel. The
deterministic account derivation is the price of owning no store: it trades a
table of per-org credentials for one HMAC secret, which concentrates custody in
KMS where it already is.

## Security Considerations

Three secrets, three consequences. The admin token is control of every org's
tunnels, which is why it arrives from KMS and its absence turns the surface off
rather than open. The HMAC secret derives every org's controller password, so its
compromise is impersonation of any org at the controller — same custody, same
rule. The account token returned by `enable` is the caller's own tunnel
credential and is treated as a secret in transit. The wrong implementation of
tenancy — reading the org from the request — would let one tenant enumerate and
enable another's tunnels; the org is therefore never an input.

## References

- HIP-0026 — Identity and Access Management
- HIP-0106 — The Hanzo Plugin Contract
- HIP-0139 — Capability

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
