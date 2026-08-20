---
hip: 1042
title: Avatar
author: Hanzo AI
type: Standards Track
category: Interface
status: Draft
created: 2026-08-20
capability: avatar
requires: HIP-0026
---

# HIP-1042: Avatar

## Abstract

`/v1/avatar` is a person's profile photo: one upload that stores the bytes and
records their address on the user's IAM row, and one credential-free read that
streams them back. It is served by `apps/account` in `hanzoai/cloud`
(`apps/account/avatar.go`).

The photo is CONTENT-ADDRESSED — the key ends in the SHA-256 of the bytes — and
the read takes no credentials, because the address IS the capability. Both are
deliberate, and this HIP is mostly the argument for the second.

## Motivation

IAM has always carried an `avatar` field on every user row and every surface
renders it, but the only writers were federation (a provider's picture claim) and
directory sync. Someone who signed up with a password therefore had a monogram
and no way to replace it, and the console's profile card sent them to an identity
service that could not do it either.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted as
in RFC 2119.

### 1. The subject is the caller

Org and user come from the VALIDATED identity, never from a request value, and
the digest is computed server-side. Every component of the key is therefore
server-chosen (`apps/account/avatar.go:147`). There is no way to name a different
subject, so this always sets your own photo.

### 2. The format is decided by the bytes

The stored type is sniffed from the CONTENT. A filename and a part's declared
content type are the client's to choose, so neither may decide what this origin
later serves. Exactly four raster formats are accepted — PNG, JPEG, GIF, WebP —
and everything else is refused (`apps/account/avatar.go:191`). An SVG MUST NOT be
storable as a picture and later served as a program.

The check is repeated on the READ (`apps/account/avatar.go:274`). It can only fire
on an object some other path wrote, and serving that under a guessed type is
precisely the injection the allow-list exists to prevent.

One upload is bounded at 8 MiB (`apps/account/avatar.go:56`) — generous for a
phone original, tight enough that this is not free object storage.

### 3. Identity components are refused, not sanitized

A path component that cannot be used verbatim in a key is REJECTED
(`apps/account/avatar.go:117`). It MUST NOT be folded into a safe form: folding
maps `a/b` and `a_b` onto one string, and a fold in a key is two tenants sharing
one address. These values arrive from validated claims, so a rejection means
something upstream is wrong and failing closed is the answer.

### 4. The address is the content

The key ends in the SHA-256 of the bytes. Two consequences are load-bearing:

- Replacing a photo yields a NEW address rather than a stale cache of the old
  face at a mutable one. This is the bug that cannot be fixed from the server
  once the address is `…/me.png`.
- The response caches for a year, immutable and `public`
  (`apps/account/avatar.go:283`), because an address that IS its content can
  never go stale.

A replaced photo MUST NOT be deleted. The previous address is already inside
issued tokens and rendered pages; an object store costs bytes where a broken face
costs a person their profile. Orphans are a collection concern, not a correctness
one.

### 5. The read is unauthenticated, and must be

The URL's whole job is to be an `<img src>` on a different origin from the API
host — which sends no cookies and cannot carry an Authorization header. So the
64 hex characters of the digest are the capability, producible only by someone who
already holds the image.

What the read MUST NOT become is a way to fetch anything else. The digest is
verified to BE a digest before the store is touched, the org and user are refused
unless they are plain identifiers, and the response is served only if the stored
bytes are one of the four formats. Every denial — malformed path, miss, an object
that is not an image — is the SAME 404, so nothing is disclosed about what
exists.

### 6. Storage and record are two writes, and the failure is reported

The bytes go to the shared blob seam under this subsystem's own prefix; the
address goes to the IAM row, which is the system of record every surface already
reads. If the bytes land and the record does not, the request MUST report that —
the photo is stored and not shown — rather than answering with a success the user
cannot see (`apps/account/avatar.go:147`).

### 7. Why these two operations are untyped

The upload's request is a multipart form and the read's response is raw bytes
under a content type derived from those bytes. Neither is a shape a typed
input/output can carry, and `apps/account/typed_wire_test.go` holds them as a
CLOSED list with that wire fact recorded — so every other route in the package is
typed by default and dropping one out takes a deliberate edit.

## Rationale

The alternative to content addressing is a mutable per-user URL, which is simpler
until the day a stale face is cached in a network nobody controls. The alternative
to the credential-free read is a signed URL with an expiry, which puts an expiring
value inside IAM rows and rendered pages and breaks them later; the digest never
expires because the content never changes.

The write reuses the existing blob seam and the existing IAM row. No new store, no
second blob path, no schema change.

## Security Considerations

The read is a public door by design, so its safety is entirely in what it can
address: a verified digest shape, refused-not-folded identity components, and a
content-type allow-list applied twice. Remove any one of them and the route
becomes a general reader of the blob bucket.

Serving user-supplied bytes from an API origin is the classic stored-injection
path. The four-format allow-list is enforced on the way in AND on the way out,
and `nosniff` accompanies the true type, so a browser cannot be talked into
executing a stored object in this origin.

The write shares the whole-row re-submit against IAM with HIP-1040, and inherits
its rule: refuse to write a row you could not read.

## References

- HIP-0026 — Identity & Access Management Standard
- HIP-1040 — Appearance
- HIP-0106 — The Hanzo Plugin Contract

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
