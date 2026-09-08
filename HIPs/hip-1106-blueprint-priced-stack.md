---
hip: 1106
title: Blueprint — The Priced Stack
author: Hanzo AI
type: Standards Track
category: Interface
capability: blueprint
status: Final
implementation-go: shipped
created: 2026-08-20
requires: HIP-0106, HIP-0139
---

# HIP-1106: Blueprint — The Priced Stack

## Abstract

`/v1/blueprint` is what a template costs to run, worked out before you deploy.
Each deployable blueprint is a compose stack; this capability turns one into the
two things a deploying org and the console need — its SBOM, the bill of
container images the stack runs, and a compute-cost estimate, a per-hour rate
derived from the services' summed CPU and memory footprint through a documented
rate card. It is implemented in `hanzoai/cloud` at `apps/blueprint`.

## Motivation

A template economy needs a price that can be explained rather than merely
asserted. The rate this capability computes is what the platform shows as the
monthly cost per template AND the basis the deploy path meters the deploying org
on — which makes it the number the author royalty is taken from, so it has to
come from a real rate card, not a fabricated figure
(`apps/blueprint/blueprint.go:15-32`).

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted
as in RFC 2119.

### §1 Reference content, no store

The blueprints are embedded in the binary (`embed.FS`) and validated once at
mount — a malformed fixture fails the mount closed, because a broken blueprint
must never reach a deploy sizing or a price card (`apps/blueprint/blueprint.go`,
`build`). There is no per-tenant state and no database; the capability owns no
store.

### §2 Addresses

Three operations under `/v1/blueprint`. The list and health are typed.
`GET /v1/blueprint/sbom` is declared with prose beside the route instead: one
address answers two shapes at 200 — `?template=<id>` returns a bare estimate,
no parameter returns the batch — and a typed operation declares one Out, so
either shape would publish the other as a lie
(`apps/blueprint/blueprint.go:120-125`). Health is deliberately not JWT-gated,
because liveness must be probe-able; it also discloses the active rate card.

### §3 The rate card is disclosed, not implied

An estimate carries the basis its rates came from, and the live card — after
the operator's env overlay, applied once at mount — is itself readable, so a
client that must explain a published price can (`apps/blueprint/estimate.go`).
This is the distinction from the sbom capability: that one stores a dependency
SBOM keyed by image digest — the packages INSIDE one image — while this one
derives the bill of IMAGES a stack runs and prices the footprint. Different
granularity, kept orthogonal.

### §4 Tenancy, money, events, telemetry, stage, upstream

There is no tenant in the data: every caller reads the same embedded blueprints
and the same card. The capability is free (`plugin/blueprint/main.go`,
`cloud.Free`); the metering it feeds happens on the deploy path, against the
rate this capability computed. It publishes nothing to the bus. Beyond the
request span it emits structured log lines only. Stage `ga`: it is the platform
plane's pricing basis, part of the self-service core — the manifest row carries
no stage field yet, so the declaration here is what the row inherits when stage
lands in `manifest.App`. It derives from no OSS upstream; the blueprints it
embeds describe OSS stacks, which is data about them, not a fork of them.

## Rationale

The alternative is to price templates by hand, one number per template in a
catalog. That number cannot be explained, goes stale the day a stack adds a
service, and silently diverges from what the deploy path meters. Deriving the
price from the stack's own compose file through one disclosed card keeps the
shown price and the metered price the same computation.

## Security Considerations

The capability holds no secrets and no tenant data, so the exposure is
economic: a wrong implementation misprices compute. Understated, every deploy
of a template bills less than it costs and the author royalty is computed from
the wrong base; a tampered rate overlay does the same deliberately. The
controls are that the card is env-set by the operator, applied once at mount,
and disclosed on every estimate — a wrong price is at least a visible one, and
the fail-closed mount means a blueprint that cannot be parsed and priced is
never shown at all.

## References

- HIP-0106 — Hanzo Plugin Contract
- HIP-0139 — Capability

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
