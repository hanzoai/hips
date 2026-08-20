---
hip: 1047
title: Security Scanning
author: Hanzo AI
type: Standards Track
category: Security
status: Draft
created: 2026-08-20
capability: security
requires: HIP-0106
---

# HIP-1047: Security Scanning

## Abstract

`/v1/security` scans submitted source for hardcoded secrets and keeps the
findings. It is served by `apps/security` in `hanzoai/cloud`.

One rule shapes everything else: the submitted content is NEVER stored, and a
finding never carries the secret it found. What persists is a masked preview and
the digest of the raw secret — enough to recognise and to triage, not enough to
use.

## Motivation

A scanner that stores what it scanned is a repository of every secret its users
ever leaked, held by a service whose whole purpose is telling them not to do that.
The interesting design question is therefore not detection; it is what a finding
is allowed to remember.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted as
in RFC 2119.

### 1. Content is read, never kept

Submitted files are scanned IN MEMORY. A finding persists its rule, its path and
line, a MASKED preview — first and last characters kept, the middle starred — and
the SHA-256 of the raw secret (`apps/security/security.go:336`,
`apps/security/detect/detect.go:190-199`).

The digest is what makes the same secret recognisable across scans and after
rotation WITHOUT the secret ever being written down. It is a correlation key, not
a recovery path.

### 2. Everything stored is org-scoped, and every miss is a 404

A scan and every finding on it are filed under the caller's validated org, and a
caller with no org is refused. An identifier belonging to another org is the SAME
404 as an identifier that never existed
(`apps/security/security.go:451`), so the surface cannot be used to learn what
exists elsewhere.

### 3. Bounded submissions

One submission is bounded in file count and in total content
(`apps/security/security.go:44-45`). A caller with more source splits it across
scans. The bound is on the REQUEST, so a single call can neither exhaust the
process nor wedge the engine.

### 4. Prepaid, at a resolved fee

A scan is one metered unit. The caller's balance MUST cover it BEFORE the engine
runs (`apps/security/security.go:373`): a check downstream of the work is a bill
for compute already spent.

The fee resolves through the platform's own policy default, never a number
invented by this subsystem. This is stated because the failure is quiet: the
surface declared itself metered from the start and passed a literal zero as the
amount, and a zero debit posts no ledger entry — so the platform required standing
to scan and then charged for none of them.

The METERED amount MUST be the same value the balance was checked against, read
once, so a charge can never exceed what was authorized.

Off the request path there is no payer, and that is a refusal rather than an
unbilled scan.

### 5. The audit record carries the tally, not the findings

A scan is recorded as an audited action with who ran it and what it found by
count. The redacted findings are the evidence and live in the store; the tally is
the outcome the audit log carries (AU-3).

### 6. Unauthenticated reads are the ones that disclose nothing

Liveness and the detection catalog take no org: the first measures this process
and answers while any tenant state is cold, and the second is the same for
everyone. Everything that touches stored results requires a validated org.

### 7. Every operation is typed

Each operation is a typed input and answer, so the schema, the prose, the tool,
the CLI command and every generated SDK method are projections of the handler
itself. `apps/security/typed_wire_test.go` holds the exceptions as a CLOSED list
that is currently EMPTY, and fails on an operation that is neither typed nor named
there — so the next route added is typed by default and dropping one out takes a
deliberate edit with a reason.

A filter value outside its vocabulary is REFUSED rather than ignored, so a typo in
a severity filter cannot read as "no findings".

## Rationale

The alternative to masking is storing the match and encrypting it, which turns
every finding into a key-management problem and makes the blast radius of this
store the union of its users' secrets. A digest plus a mask supports the two things
a reviewer actually does — recognise which secret this is, and confirm it stopped
appearing — with nothing to steal.

Gating before the engine rather than after costs a balance read on every
submission and removes the case where an unfunded caller consumes the compute and
then learns they could not pay for it.

## Security Considerations

The threat this capability creates is itself: a service that receives source code
containing live credentials. The mitigations are that the content is not persisted,
the finding cannot reconstruct the secret, and the store is partitioned by org with
denials that disclose nothing.

The digest deserves care. SHA-256 of a raw secret is reversible by guessing when
the secret is low-entropy — a short password, a well-known test key — so the
digest MUST be treated as sensitive within the tenant's own scope, and MUST NOT be
published across tenants as a shared correlation key.

Submission bounds are a denial-of-service control, not tidiness: the engine runs
regular expressions over caller-supplied text, so the size of that text is the
size of the work a single request can buy.

## References

- HIP-0106 — The Hanzo Plugin Contract
- HIP-0027 — Secrets Management Standard

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
