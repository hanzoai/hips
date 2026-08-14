---
hip: 0116
title: Hanzo Plugin & VM Model
author: Hanzo AI Team
type: Standards Track
category: Infrastructure
status: Retired
created: 2026-07-07
updated: 2026-07-29
superseded-by: HIP-0106
requires: HIP-0105, HIP-0106, HIP-0114
---



# HIP-0116: Hanzo Plugin & VM Model

## Superseded by HIP-0106

**The plugin contract is HIP-0106, and only HIP-0106.** Read that document.

This HIP and HIP-0106 answered the same question — by what mechanism does a unit
of code join the cloud binary — which is one question too many for two documents.
HIP-0106 is the survivor: it is the document the code cites (`cloud/serve.go`,
`zip/module.go` and `zip/doc.go` all say "per HIP-0106"), it is `require`d by this
one, and the composition model shipped there rather than here.

**What survived, and is now stated in HIP-0106:**

- **No build tags.** A capability is a plugin — compiled once, loaded when asked.
  Build tags select code at compile time, so every enable/disable is a rebuild,
  the image matrix goes combinatorial, and the operator's knob becomes a CI
  parameter. Rejected then, rejected now (HIP-0106 §1.3).
- **Not `dlopen` either.** Go's `plugin` package couples host and plugin at the
  ABI level, cannot unload, and shares a fate domain. A supervised child releases
  every byte when it exits, which is why a host can reload one without dropping a
  request (HIP-0106 §2, §3.4).
- **A plugin is a supervised child process.** Crash isolation, independent
  versioning, independent memory. A broken plugin degrades to 503 on its own
  prefixes and the host keeps serving every sibling (HIP-0106 §3.4).
- **ZAP is only a transport.** Being reachable on a plugin socket confers no
  authority; identity stays with the assertion the front door minted
  (HIP-0106 §6, HIP-0114's Bridge Law).
- **One codebase, two shapes.** The same binary serves standalone and as a
  composed child, with no second code path — `zip.Addr` decides which
  (HIP-0106 §2).
- **An interop edge, second-class on purpose.** A foreign protocol is translated
  at the door and never appears between host and plugin. The adaptor's ceiling —
  no capability beyond the ZAP surface — is what makes the concession safe.

**What did not ship, and is replaced rather than carried:**

| Claimed here | What shipped | Where it is specified |
|---|---|---|
| `luxfi/lpm` install/enable distribution | `hanzo.yml` `binaries:` → `binaries.json` → digest-verified fetch, plus the on-disk sibling ladder | HIP-0106 §7, §3.3 |
| a `.zap` schema + `zapc`-generated plugin IDL per subsystem | `github.com/hanzoai/plane` — a Go leaf module of op-name constants and their In/Out types; addressing is the `operationId` | HIP-0106 §1.3(a), §4 |
| an "embedded subsystem" shape: `cloud.Register(name, order, mount)` plus a blank import in `cmd/cloud` | deleted with the fused binary; `cmd/cloud` links no subsystem, and a gate fails any import of one | HIP-0106 §1.1, §8.1 |
| per-VM Lux consensus (Quasar) + ZapDB as the plugin state substrate | a plugin owns its own store and receives its key at run time; no consensus is required to compose one | HIP-0106 §1.3(c) |
| the host holding its own table of each plugin's routes | the plugin declares them from its live router and the host discovers, gated by asking the composed router | HIP-0106 §3 |

**Orthogonality, restated once so each concern still has exactly one HIP:**
HIP-0105 is user code *inside* a service process; HIP-0106 is how a unit of code
becomes a composable binary and how a host composes it; HIP-0113 is the engine
provider runtime; HIP-0114 is the transport; HIP-0117 is where the result runs;
HIP-0119 is the shape of the running service; HIP-0123 is how the unit scales;
HIP-0126 is what runs in the extension engines.

Nothing in this file is normative. Amend HIP-0106.

## References

- HIP-0106 — The Hanzo Plugin Contract (the survivor)
- HIP-0119 — Hanzo Service Conventions (the service shape a plugin conforms to)
- HIP-0105 — In-Process Extension Runtime Standard
- HIP-0113 — Cognitive Sidecar & Hanzo Engine Provider Runtime
- HIP-0114 — ZAP — Inter-VM Cognitive Transport
- HIP-0117 — Cloud-in-a-Box — One Binary, Three Modes
- HIP-0122 — zip — The ZAP-Native Application Server Core
- HIP-0123 — Visor — Fleet & Fabric Autoscaling Across Any Provider
- HIP-0126 — Integrations, Connectors & the Extension Runtime
