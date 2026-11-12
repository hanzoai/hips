---
hip: "0145"
title: Go Repository Layout
author: Hanzo AI Team
type: Standards Track
category: Infrastructure
status: Draft
implementation-go: none
created: 2026-11-11
requires: HIP-0106, HIP-0119, HIP-0139
---

# HIP-0145: Go Repository Layout

## Abstract

A Go package is a unit of responsibility and reuse. Lay a repository out so
its packages, their owners and their dependencies are obvious, and add a
directory only when it is a real package boundary. This follows Go's own
guidance (<https://go.dev/doc/modules/layout>) and adds two things: a reading
order for people and agents, and a short list of names to avoid.

## Motivation

Measured 2026-11-11, no two repositories agree:

- iam: `pkg/`, `internal/`, `server/`
- kms: `pkg/`
- commerce: 46 top-level directories, including `pkg/`, `util/`, `types/`,
  `models/`, `thirdparty/`
- ai: `router/` beside `routers/`, `log/` beside `logs/`
- cloud: `client/`, `clients/` and `types/` for one concern; a root package of
  92 files

## Specification

### §1 Reading order

1. **Repository**: the root listing and `README.md` (purpose, build, package
   map). `LLM.md` is an optional short guide for agents.
2. **Package**: `go doc`.
3. **Implementation**: source, tests, examples.

Write each fact once, at the narrowest scope where it holds.

### §2 Layout

| path | use |
|---|---|
| root | a root package when there is a public API; a small single-command repository may be root `package main` |
| `cmd/<name>/` | several commands, or a command with real supporting code; `main` stays thin |
| `internal/<name>/` | the default for implementation packages |
| `<name>/` | public packages with a supported API |
| `<group>/<name>/` | a family of related packages (`apps/<name>`, `plugin/<name>`) |

Keep paths shallow, but nest when a package has its own purpose, owner or
dependencies (`internal/billing/store`). A large file is not a reason for a new
package.

### §3 Names

Short, lowercase, read well at the call site: `billing.Service`, not
`billing.BillingService`. HIP-0139 §2 names cloud capabilities.

Avoid catchalls: `util`, `common`, `misc`, `shared`, `types`, `models`, and a
`pkg/` container. `server`, `client`, `service` and `handler` are fine for a
package with one job.

One concept, one package: no `client` beside `clients` unless they are
different things.

### §4 Dependencies

- No cycles.
- Pass dependencies explicitly; no hidden globals.
- Define an interface where it is consumed, and only when needed.
- Keep entry points and transport wiring apart from domain code.
- A small capability must not drag in a large application package.

### §5 Versions

Go's rule holds: a `v2.0.0` or later release carries `/v2` (or higher) in its
module path. A published v1 API stays compatible; a breaking release of a module
with outside consumers takes the next major path.

Code whose consumers are all in the estate changes in lockstep: callers are
updated in the same change, with no alias or deprecated copy left behind. No
major version for an internal refactor.

### §6 Migration

Incremental. Before moving a package, know its consumers, API, init behavior and
dependencies. Each change is small, keeps behavior, and leaves the branch
building and green.

### §7 Conformance

CI checks facts, not taste:

```sh
gofmt -l .                # prints nothing
go vet ./...
go build ./...
go test ./...
# catchall directories; each hit is new or an approved exception
find . -type d \( -name pkg -o -name util -o -name utils -o -name common \
  -o -name misc -o -name shared -o -name types -o -name models \) \
  -not -path '*/node_modules/*' -not -path './.git/*'
# a package beside its plural
find . -type d -not -path './.git/*' | sed -n 's/s$//p' | sort -u | \
  while read d; do [ -d "$d" ] && echo "$d ${d}s"; done
```

`go build` also catches import cycles and broken paths.

## The cloud, first

Measured 2026-11-11:

- root package: 92 non-test files, 25,362 lines, imported by 1,774 files;
  672-package dependency graph (233 standard library)
- 488 packages; 9 outside the generated plugin mains lack a doc comment
- `client/`, `clients/`, `types/`: the wire, the implementations and the
  interfaces of one concern

Split by responsibility, not by filename or layer. Nearly every app reaches the
root through `Listen`, which wires most of the runtime, so moving code into
directories helps reading but does not shrink the build on its own. What matters
is direction: the orchestration layer imports focused packages, and focused
packages never import `Listen` or the root.

A likely end state, not a required tree:

```
cloud/
├── cloud.go          small public facade
├── doc.go
├── cmd/cloud/        the host
├── internal/
│   ├── app/
│   ├── audit/
│   ├── billing/
│   ├── metrics/
│   ├── middleware/
│   └── org/store/
├── apps/
└── plugin/
```

Done means: behavior unchanged, every caller updated in the same change, and no
dependency added without a reason.

## References

- <https://go.dev/doc/modules/layout>
- <https://go.dev/doc/modules/version-numbers>
- HIP-0106 Hanzo Plugin Contract
- HIP-0119 Hanzo Service Conventions
- HIP-0139 Capability
