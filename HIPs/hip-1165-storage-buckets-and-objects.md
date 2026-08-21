---
hip: 1165
title: Storage — Buckets and Objects
author: Hanzo AI
type: Standards Track
category: Core
capability: storage
status: Draft
created: 2026-08-20
requires: HIP-0026, HIP-0106, HIP-0139
---

# HIP-1165: Storage — Buckets and Objects

## Abstract

`/v1/s3` is object storage: your buckets and the files in them, with signed URLs
for upload and download. It is the DATA plane over the shared object store —
`provisioning` (HIP-1164) is the control plane that allocates the bucket
resource, and both derive a bucket's real name from the caller's org the same
way. It is implemented in `hanzoai/cloud` at `apps/storage` (HIP-0106).

## Motivation

Bytes should not travel through the API. A browser that uploads a file through
this binary spends the binary's memory and the proxy's timeout on a body nobody
here reads; a browser that follows a signed URL spends neither, and the admin
credential never leaves the server. So the surface is small on purpose: it lists
and names, and it mints a short-lived capability for the transfer itself.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted
as in RFC 2119.

### §1 The store it owns

None. There is no database here. The only durable state is the buckets and the
objects themselves, in the shared object store, named by a derivation that is a
pure function of the caller's org and the friendly name they used — so there is
nothing to reconcile and nothing that can disagree with the store about what
exists. The control-plane row for an allocated bucket lives with `provisioning`,
and this capability neither reads nor needs it.

### §2 The address

Six operations at `/v1/s3`: list the caller's buckets, create one, delete an
empty one, browse one level of a bucket, mint an upload URL for one object key,
and the readiness probe. The full route set registers unconditionally, even
where the store is unconfigured, so this capability always OWNS its route space
and answers 503 under its own name rather than falling through to a neighbour's
handler with a different error.

Every operation is declared with prose beside its route rather than typed, and
each refusal is a wire this stack cannot yet describe:

1. **The money wire.** Each data-plane operation gates on balance, and
   `cloud.DenyResource` writes the fleet's nested `{"error":{"code","message"}}`
   at 402 or 503 in band. A typed op's only refusal channel is a returned error,
   rendered as zip's flat shape — the same denial in a different body for every
   metered client that reads `error.code`. Writing the nested body from inside a
   typed op does not help: zip stamps its own status over the 402 after a nil
   `Out`.
2. **The trailing key.** Presigned download and object delete take the object
   key as the rest of the path, and a rest-of-path parameter has no typed-op
   spelling: zip leaves the wildcard in the op path while the translation
   renders the route as a named parameter, so the fold finds no live route for
   the op. Those two are served and are not in the document for that reason.
3. **Two statuses, one object.** The probe answers the same object at 200 and at
   503, and a typed op declares exactly one success status.

All three clear on one change: an error that can carry a body, and a second
declarable success status.

The pair `/v1/s3 storage` is carried by cloud's `openapi/misfiled.txt` and
closes by rename (HIP-0139 §7.3), never by alias or by fold: `s3` is a name
HIP-0139 §2.5 admits and is the word people say for the thing, and the rest of
the corpus already addresses object storage there (HIP-1060, HIP-1061). Rename
is the resolution that leaves every existing reference correct.

### §3 Tenancy

Every data-plane operation runs behind `cloud.Member` — a validated principal —
before the org is read at all, so the forgeable path is closed before anything
is resolved. The tenant is then the org the edge minted from the validated
bearer owner claim (HIP-0026), folded to a DNS slug; no principal is a refusal,
and an empty org reaches the literal `admin` bucket for a SuperAdmin and for no
one else.

The client speaks FRIENDLY names. The server derives the real bucket from the
caller's org and never trusts a client-supplied physical name: listing filters
to the caller's own prefix and strips it, and create, delete and every object
operation re-derive from the org. One tenant cannot address another's bucket
because there is no field in which to name it.

The derivation is `provisioning`'s exported one, folded to a name the object
store accepts. The two capabilities MUST derive it identically — a control plane
and a data plane that disagree about a tenant's physical name is a boundary that
drifts between allocate and operate.

### §4 Money

Metered. Object storage has no live-size source in this plane, so it is billed
per OPERATION: the fee is `cloud.ResourceFeeCents("CLOUD_S3_FEE_CENTS", "op")`,
an operator knob over `cloud.DefaultResourceFeeCents`. The gate runs before the
handler — an unfunded org 402, an unreachable ledger 503 in the fail-closed
posture, and nothing touched either way — and the debit lands after the handler
SUCCEEDS, through the one shared `cloud.ResourceMeter` under the product label
`s3`. A failed handler is surfaced and not billed. A fee of 0 makes the surface
free and therefore un-gated. The readiness probe is not gated and not billed.

When a live-size source exists, the recurring footprint reuses that same meter
with a usage-derived amount. There is no second metering path.

### §5 Events

It publishes nothing on the bus; a customer's webhooks receive no `storage.*`
events.

### §6 Observability

Beyond the request span every route gets, structured log lines only — the mount
line, which says whether presigning is configured, and the fail-closed warning
when the admin credential is absent. It emits no metric of its own. A minted URL
is not logged: the URL is the capability.

### §7 Stage

`ga`. The manifest row declares no stage, and absent is `ga` (HIP-0139 §8).

### §8 Upstream

It derives from `github.com/hanzos3/go` v1.0.2 (Apache-2.0), the Hanzo storage
client built on the MinIO Go client; the S3 request signing, the bucket and
object calls and the presigner survive in HEAD, and the app adds the tenancy
derivation, the gate and the route set rather than a fork of the client's
internals. The connection itself is built once in `apps/s3admin`, the one place
the shared admin credential is read. The bytes land in the SeaweedFS S3 gateway,
which speaks the S3 API and is dialled, not embedded.

### §9 The boundary

Against `provisioning` (HIP-1164): allocate versus operate. Creating the bucket
RESOURCE — the row, the fee, the record that an org holds it — is
`POST /v1/instances/s3`. Listing what is in it, putting a file in it and taking
one out is here. A bucket created here is a valid resource there and vice
versa, because the physical name is one derivation exported from one place.

Against the other capabilities that keep blobs: the deploy blobs, the static
site content and the team files all reach the same object store through the same
admin client, and none of them is this capability's address. `/v1/s3` is the
customer's own file surface. A capability that stores blobs as an implementation
detail MUST NOT publish a second object door — objects are `/v1/s3` (HIP-1060).

## Rationale

The alternative to presigning is proxying the bytes, which puts every upload
through this process's memory and every download through its timeout, and puts
the admin credential one bug away from the response. The alternative to
friendly-versus-physical names is letting the client name the bucket, which
makes the tenant boundary a string comparison in a handler instead of a
derivation with no input.

Registering the routes even when the store is unconfigured looks like waste and
is the opposite: an unregistered route falls through to whatever matches next,
and a neighbour's 404 for a store that is merely unconfigured is a worse answer
than an honest 503 under this capability's own name.

## Security Considerations

What a wrong implementation here gives an attacker is every tenant's files,
from one request.

The object layer does not enforce the boundary: the gateway holds ONE admin
identity for the binary, so isolation is entirely the org-derived naming plus
the member gate. That is stated rather than assumed, and it is why the
derivation lives below the handlers where none of them can skip it, and why
listing filters by the caller's prefix instead of by a flag a handler sets.
Defence in depth is a per-request session policy scoped to the org's prefix, so
the store independently refuses what the naming already refuses; until that
lands, this plane's two facts are the whole boundary.

A presigned URL has no server-side revocation, so its lifetime IS the revocation
window: five minutes, short enough that a minted capability barely outlives a
revoked session and long enough for a browser to finish an ordinary transfer. A
caller who needs a fresh window re-mints. Minting is not rate-limited, which is
a platform gap rather than one this capability can close, and it is why the TTL
is set where it is.

The object key is path-cleaned before it is signed, so a relative traversal
cannot escape the bucket the caller was scoped to.

## References

- HIP-0026 — Identity and Access Management
- HIP-0106 — Hanzo Plugin Contract
- HIP-0139 — Capability
- HIP-1060 — Pubsub — The Tenant Door on the Bus
- HIP-1061 — MQ — Queues and Streams
- HIP-1164 — Provisioning — Stores on Demand

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
