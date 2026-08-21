---
hip: 1212
title: Exec — The Code Interpreter
author: Hanzo AI
type: Standards Track
category: Infrastructure
status: Draft
created: 2026-08-20
requires: HIP-0139, HIP-0106
capability: exec
---

# HIP-1212: Exec — The Code Interpreter

## Abstract

`/v1/exec` runs a snippet in a sandbox and moves files in and out of the session
that sandbox is. A session IS a sandbox: the id the reply hands back is the
sandbox's, its lease and its files are the session's, and nothing else exists —
no store, no session table, no lifetime of this capability's own
(`apps/exec/exec.go:1-23`). It is implemented in `hanzoai/cloud` at `apps/exec`,
composing over the sandboxes capability across the internal plane.

## Motivation

The previous implementation was a reverse proxy to an executor Service that had
zero endpoints for 33 days — `/v1/exec` answered 503 in production the whole
time, and pointing the proxy elsewhere was never the fix because the thing
pointed at did not exist (`apps/exec/exec.go:25-33`). The cloud already runs the
one compute primitive; this capability is the code-interpreter wire over it.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted
as in RFC 2119.

### The name

`exec` is not on HIP-0139 §2.5's list, so the abbreviation is argued here: it is
the word people say. It has been the shell builtin and the `execve(2)` family's
name for fifty years; "execute code" is what every code-interpreter tool schema
calls this act, and nobody says "executioner" or "execution service" — the
long form is not a word anyone uses for the thing. §2.5 admits an abbreviation
exactly when it is the spoken word, and this one is.

### The surface

Every address is under `/v1/exec`: the run itself, the file writes and reads
beside it, and one refusal. `POST /v1/exec` is the one typed operation — lease
the session's sandbox, write the program, run it, report what it printed and
what it wrote (`apps/exec/exec.go:734`). Four operations are untyped by design,
each declaring in prose why it cannot be a value (`apps/exec/exec.go:771-800`):
`/v1/exec/upload` takes multipart/form-data, and a typed body is decoded as
JSON; `/v1/exec/download/{session_id}/{fileId}` answers bytes, and a typed
operation always marshals a Go value; `/v1/exec/files/{sid}` answers a bare
JSON array because that is the wire the callers match on; and
`/v1/exec/programmatic` answers 501 in the open — it names a
suspend-and-resume protocol this capability does not implement.

Today's router serves upload, download and files at the root
(`manifest/apps.go:360`); each pair is a line in `hanzoai/cloud`
`openapi/misfiled.txt` until the fold lands. The wire is not ours — the shapes
are measured from the LibreChat code-interpreter clients, which compose these
paths off a configurable base URL, so the fold ships as one base-URL change in
lockstep with the route move (`apps/exec/exec.go:34-43`).

### Session lifetime is the sandbox's

This capability MUST NOT end a lease. The sandboxes reaper does, on the ttl the
lease was taken for and on idleness; a sandbox torn down at the end of a run
would 404 every download of the plot that run just made
(`apps/exec/exec.go:18-23`). The peer is reached over the internal plane and
never imported — an import would give this process a second sandbox service
racing the real reaper (`apps/exec/exec.go:98-104`).

### Tenancy

One function decides the tenant, and it never reads a header
(`apps/exec/exec.go:446-471`). A validated IAM bearer scopes the session to
that org. The service-key credential — an opaque key on `X-API-Key`, compared
in constant time against `CODE_EXEC_API_KEY`, failing closed when none is
configured (`apps/exec/exec.go:45-49`) — carries no tenant, so it scopes to
the deployment's own brand org: one tenant for one deployment, which is what a
shared key with no tenant in it actually means. A context carrying neither is
refused.

### Money, events, observability

Exec is free, in those words: the plugin declares `Price: cloud.Free`
(`plugin/exec/main.go:27`). The compute it consumes is the sandboxes
capability's account. It publishes no events on the bus, so a customer's
webhooks receive nothing from it, and it emits nothing to observability beyond
the request span every route already gets.

### Stage

`ga`. This surface serves live chat traffic through a client whose calls can
arrive on the service key alone, and HIP-0139 §8.2's flag-404 on a non-`ga`
prefix would break them in production; the credential settles through IAM
without hiding the door.

### Upstreams

It derives from none. The wire contract is measured from LibreChat's
code-interpreter clients (MIT) — a wire fact, not embedded code — including the
closed language set the tool schema advertises (`apps/exec/exec.go:112-119`).

## Rationale

The alternative to "a session is a sandbox" is a session table mapping ids to
sandboxes — a second store whose rows can disagree with the leases they name,
in exactly the way the dead executor's state disagreed with reality. Holding no
state means every answer is about a sandbox that verifiably exists.

## Security Considerations

This is an arbitrary-code-execution surface; the sandbox boundary is the
product. The two implementation wrongs that history has already shown: running
code with no key at all when the key was unset — the check now fails closed
(`apps/exec/exec.go:423`) — and trusting a caller-supplied org header, which
`tenantOf` now structurally refuses by reading only the admission marker on the
context (`apps/exec/exec.go:475-482`). The prefix list that routes admission is
fail-closed on drift: a stale entry is a 403 on a route that should work, never
a route that works without a credential (`apps/exec/exec.go:746-757`).

## References

- HIP-0106 — Hanzo Plugin Contract
- HIP-0139 — Capability

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
