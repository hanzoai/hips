---
hip: 1040
title: Appearance
author: Hanzo AI
type: Standards Track
category: Interface
status: Final
created: 2026-08-20
requires: HIP-0026
---

# HIP-1040: Appearance

## Abstract

`/v1/account/appearance` is one person's reading of the design system — text
size, spacing density, one accent hue — held on their IAM account rather than
in a browser. It is a facet of the `account` capability (HIP-1200), served by
`apps/account` in `hanzoai/cloud` (`apps/account/appearance.go`); the router
still serves it at the bare root today, a pair `hanzoai/cloud`
`openapi/misfiled.txt` carries.

The whole claim is *where the value lives*. A preference kept in local storage is
a fact about a device; kept on the identity it is a fact about the person, so it
is the same in the console, in chat, on the desktop and on a phone that has never
seen any of them.

## Motivation

Every browser surface that could set this is either a static export or a separate
frontend, so none of them holds the confidential IAM credential needed to write a
user row. Each one growing its own writer would mean several read-merge-write
implementations against one row, and a row whose password hash a partial write
can blank. There is one writer, at the unified API host, acting as the
confidential console client against the already-validated caller's own record.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted as
in RFC 2119.

### 1. Subject

The subject is the validated caller and MUST NOT be nameable. There is no
parameter for whose appearance is read or written; an unauthenticated request is
refused rather than answered with a default
(`apps/account/appearance.go:83`, `:106`).

### 2. Storage

The preference is one JSON value in the IAM user row's `properties` map. Gaining
it changes no IAM schema.

A write MUST read the full row, change that one property, and submit the whole
row back (`apps/account/appearance.go:151`). IAM's update overwrites the default
column set, so a partial submission blanks every field the body did not restate —
including the password hash. A write that cannot first read its row MUST fail
rather than write a row it did not read.

### 3. Axes, and absence

Three axes, each OPTIONAL:

| axis | domain |
|---|---|
| type | text-size multiplier, clamped to [0.85, 1.4] |
| density | `compact`, `default` or `comfortable` |
| accent | one CSS colour token |

An unset axis is ABSENT and MUST NOT be stored as a neutral value. Absence and
"the published default" are the same state, so an empty preference cannot stamp a
scale over a brand that set its own.

A value outside its domain is DROPPED and the rest of the preference is stored:
one bad axis narrows the result, it never refuses the write
(`cleanAppearance`, `apps/account/appearance.go:61`).

### 4. The accent is validated as a colour

`accent` is rendered by surfaces into a `<style>` body, and its value is chosen by
its owner. It MUST therefore match a closed colour grammar before it is stored — a
hex literal, or a bounded functional-colour form — and anything carrying `;`,
`{`, `}`, `<` or `url(` cannot match (`apps/account/appearance.go:56`).
Validation is at the WRITE, so no reader has to be trusted to sanitize.

### 5. The read fails soft

A transient identity-service failure on READ answers the empty preference, not a
5xx (`apps/account/appearance.go:83`). A surface then applies its published
default, which is what it would have done for a person who never set one. A WRITE
does not fail soft: an unstored preference MUST be reported as unstored.

## Rationale

The obvious alternative is a per-application setting, filed with the rest of an
app's preferences. It is wrong by counting: there is one of these per identity and
not one per app, and a person who enlarges text does not mean "in this tab".

Reusing the IAM `properties` map rather than adding a column costs one JSON
decode per read and buys a preference that ships without a migration.

## Security Considerations

The stored accent reaches a stylesheet. Treating it as opaque text and validating
it only where it is rendered would put the check in as many places as there are
surfaces, and a new surface would default to unsafe; the grammar at the write is
the one place that cannot be skipped.

The whole-row re-submit is a footgun that has to be stated: the row carries
credential material, so the write path's correctness is the row's integrity. The
same read-merge-write serves the avatar (HIP-1042), and both MUST refuse to write
a row they could not read.

## References

- HIP-0026 — Identity & Access Management Standard
- HIP-0106 — The Hanzo Plugin Contract
- HIP-1042 — Avatar
- HIP-1200 — Account — The Caller's Own Surface

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
