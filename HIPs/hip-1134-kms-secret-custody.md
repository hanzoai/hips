---
hip: 1134
title: KMS — Secret Custody
author: Hanzo AI
type: Standards Track
category: Infrastructure
capability: kms
status: Draft
created: 2026-08-20
requires: HIP-0026, HIP-0106, HIP-0139
---

# HIP-1134: KMS — Secret Custody

## Abstract

`/v1/kms` is secret custody: an org's secrets sealed at rest, read and written
over one REST surface, plus threshold signing through the MPC ring. It embeds
the `luxfi/kms` primitives in-process in the one cloud binary, implemented in
`hanzoai/cloud` at `apps/kms` (HIP-0106). This HIP states the custody
invariants: plaintext never touches disk, the master key exists only in the
environment, and with either one absent the capability fails closed rather than
degrading.

## Motivation

Cloud hosting the secret store is a chicken-and-egg: it cannot fetch its own
master key from the KMS it hosts. And a secrets manager that is a separate
process is a second auth stack, a second database and a second thing to leak.
Embedding the store gives every subsystem an in-process client and gives the
console one REST face, both backed by the same sealed store and gated by
cloud's one auth boundary — never a parallel JWT stack
(`apps/kms/kms.go:1-52`).

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted
as in RFC 2119.

### §1 The store: per-org files, two seals, one env key

Each org's secrets live in its own encrypted file,
`{DataDir}/orgs/{org}/kms.db`, opened through the canonical per-org store seam
(`apps/kms/store.go:59-68`) — per-org files carry no single-opener lock, which
is what lets different pods serve different tenants. Two layers of at-rest
protection root in the same key: each secret is sealed in an AES-256-GCM
envelope (a fresh per-secret DEK wrapped by the master key) BEFORE it reaches
SQLite, and the file itself is SQLCipher-encrypted under a per-db DEK
(`apps/kms/kms.go:20-33`).

The 32-byte master key is read ONLY from the environment
(`CLOUD_KMS_MASTER_KEY_REF`), injected by the operator — never from the store,
never logged, never persisted. Absent, the subsystem mounts health-only:
`/v1/kms/health` answers 503, every secret operation refuses with a clear
error, and the fallback store is ephemeral in-memory — never an unencrypted
on-disk one, so a later keyed boot opens clean (`apps/kms/kms.go:35-44`).
Signing is MPC-backed and MUST fail closed when the MPC backend is not
configured; a signature is never fabricated (`apps/kms/kms.go:46-49`).

### §2 The address

Seven REST operations (`apps/kms/mount.go:11-16`): health and the SPA config
are public; listing and reading secrets are member operations; writing and
deleting require org admin; and `auth/login` is a broker that exchanges a
client id and secret at IAM — with no IAM token URL configured it refuses 503,
because cloud is not a token issuer (`apps/kms/mount.go:50-58`). None is typed:
each handler answers an assembled map and two answer the same body under two
statuses, so the prose is declared beside the route table — written under one
rule for a credential broker: a description never implies secret material turns
up anywhere but the one response body that exists to carry it. The list
operation returns metadata only; the read returns a value; neither a log line
nor an error body carries either (`apps/kms/mount.go:64-80`).

### §3 The internal plane

Exactly one process holds the sealed store, so every other app asks it: four
typed operations — get, put, sign, delete — declared on the internal plane,
which listens only on this app's canonical socket, so there is no route from
the edge to any of them. The surface is the `KMSClient` interface and nothing
more, because a secret store's call surface is the one place where "while I'm
here, expose the rest" is how a tenant's material leaves its boundary
(`apps/kms/secret_rpc.go:15-55`).

### §4 Tenancy

The org is the caller's, read from the validated principal (HIP-0026), and
never named in the URL — it used to be a path segment that had to equal the
principal's org, which made the tenant caller-selectable; the segment is gone.
The org is folded into the store path as the isolation partition, the same role
the org column plays in every table (`apps/kms/mount.go:17-25`). On the plane,
a ref names its tenant and the authorize check binds the two
(`apps/kms/secret_rpc.go:156-168`).

### §5 Money, events, observability, stage

Free (`cloud.Free`, `plugin/kms/main.go`). It publishes nothing on the bus. It
emits nothing beyond the request span, and by the stated rule above its spans
and errors are value-free. Stage `ga`: secrets are identity-plane core.

### §6 Upstream

It embeds `github.com/luxfi/kms` v1.12.22 (Lux Ecosystem License 1.2): the
secret store and client primitives survive in HEAD as the library face behind
both the in-process client and the REST surface. HIP-0027 describes the earlier
standalone deployment of the same lineage; this HIP specifies the embedded
capability.

## Rationale

The alternative bootstrap is to seed the master key into the store itself,
which is circular, or into a peer secrets service, which reintroduces the
process this design deletes. Env-only injection is the smallest trusted input,
and the health-only mode makes its absence loud instead of silently insecure —
the design refuses the "temporary plaintext fallback" every outage invites.

## Security Considerations

The attacker's prize is another tenant's credentials, and the defenses are
structural: per-org files mean a tenancy bug must open the wrong file, not
merely forget a predicate; the caller-selectable org segment is gone; plane
operations are unreachable from the edge. The second prize is the master key,
which exists in exactly one place, the process environment. The residual
surface is disclosure by side channel — a value in a log line or error body —
and the surface's own rule is that the one response body is the only place a
value ever appears.

## References

- HIP-0026 — Identity and Access Management
- HIP-0027 — Secrets Management Standard
- HIP-0106 — Hanzo Plugin Contract
- HIP-0139 — Capability

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
