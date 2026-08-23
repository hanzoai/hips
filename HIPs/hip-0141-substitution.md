---
hip: 0141
title: Substitution
author: Hanzo AI
type: Standards Track
category: Core
status: Draft
created: 2026-08-20
requires: HIP-0026, HIP-0106, HIP-0137, HIP-0139
---

# HIP-0141: Substitution

## Abstract

A capability is a name, an address and a set of typed operations. The engine
behind them is a separate fact, and most of it is somebody else's open source.
This HIP states the relationship between the two: what an operator may replace,
what a replacement owes before it counts as one, and the two boundaries nothing
may replace.

HIP-0139 §6 already requires every capability to declare the upstream it derives
from. This is the contract for exchanging it.

## Motivation

Everything ships as a plugin, so the unit an operator can exchange already
exists: one manifest row, one package, one binary, one process, started on the
first request that reaches its prefix and reclaimed after fifteen minutes idle
(`manifest/plugin.go`). A better component appearing in the open should cost an
operator one binary — the one for that capability — and leave the other 122 as
they were.

The estate has the loader (HIP-0106 §11 and §14) and it has the declaration
(HIP-0139 §6). What sits between them is unwritten: once the engine is
different, what makes it the same capability. Absent that sentence there are two
outcomes and both are bad. Either every exchange is a fork, and an operator who
wanted one component stops receiving work on every other; or an exchange lands
quietly, moves a schema, and the generated clients, tool descriptions and
commands built from that capability's document are all wrong with nothing red.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted
as in RFC 2119.

### §1 What a substitution is

1. The contract is the capability's ADDRESS and its typed OPERATIONS. The engine
   behind them is not in it. A substitution exchanges the engine and keeps both.
2. A substitute MUST answer at `/v1/<name>` and MUST NOT claim any other
   top-level address (HIP-0139 §3). Moving the address makes a second
   capability, never an alias.
3. A substitute MUST serve every operation id the capability publishes, with the
   same input and output shapes and the same success statuses. Reproducing the
   behaviour under different ids is a new surface wearing an old name.
4. The unit of exchange is one plugin: one manifest row, one binary, one process
   (HIP-0106 §9). Half a capability is not substitutable, and that is a property
   of the boundary rather than a rule laid on top of it.
5. Substitution needs no new mechanism and this HIP adds none. A host resolves an
   app's binary from its name down one ladder — an address an operator points it
   at, a path an operator names, the file beside the host, then a published
   artifact keyed by name, os and arch — and an operator substitutes by naming a
   different one at whichever rung they own (`manifest/plugin.go`). An index
   entry carries a digest or is dropped, and the artifact is verified against it
   before it is executed.
6. A substitution is a deployment's decision. It amends no HIP, because a
   capability HIP specifies the reference implementation (§7).

### §2 The conformance surface

1. A capability MUST be able to state what a substitute has to reproduce. That
   statement is its **conformance surface**, and it has two halves.
2. The first half is DERIVED and MUST NOT be written by hand: the capability's
   own published document, projected from its own live router by its own binary
   (`<binary> describe`, one artifact per capability, `plugin/<name>/openapi.json`
   — 123 of them today). Operation ids, path parameters, request and response
   schemas, statuses. A hand-written copy is the defect HIP-0139 §1 names.
3. The second half is the wire facts a document cannot hold, and those MUST be
   stated in prose in the capability's HIP, beside the operations they belong to:
   a body that is raw bytes rather than JSON, two success shapes at one address,
   a response that is a stream, a size bound the caller meets as a status, and
   the ORDER refusals are decided in. Error precedence is wire — a caller
   answered 413 by one engine and 400 by the next has been handed a different
   API, whatever the schemas say.
4. A substitute DEMONSTRATES conformance the way the original produces the claim:
   it runs standalone (HIP-0106 §10), emits its own document, and that document
   matches. The projection is taken from the binary that will run, because a
   projection off a stale binary is a lie.
5. A substitute MUST NOT publish fewer operations than the capability's floor
   without the change that lowers it saying so (HIP-0139 §5.4), and MUST NOT
   introduce a schema name that already means something else in the fleet: the
   schema namespace is flat, and the weave refuses one name with two shapes
   because every generated client would bind whichever it read last.
6. **A capability that cannot state its conformance surface MUST NOT be
   substituted.** Without the statement, "the same capability" is an opinion, and
   an operator acting on one has forked without being told.

### §3 Licenses

HIP-0137 says what a license is, that its text is never edited, and that a
fork's is not ours to change. It stands unaltered. This section answers the one
question it does not: what may be linked into a plugin binary.

1. **Embedding and running are different acts, and the line is CONVEYANCE rather
   than the socket.** A plugin binary is one artifact; whoever hands it to
   someone else hands over everything linked into it, under the union of what
   those terms require. An engine the operator obtains for themselves and the
   plugin reaches over a protocol is a separate program that nobody here conveys.
   Two processes shipped in one artifact are one conveyance; two processes where
   the operator fetches the second are two.
2. A capability MAY embed an upstream whose conditions a distributed binary can
   satisfy without changing the terms of the code beside it — the notice and
   attribution family, carried per HIP-0137 §2 and §5.
3. A capability MUST NOT embed an upstream whose license conditions distribution
   of the binary on conveying the whole binary under that license (the GPL
   family), or extends that condition to serving the binary over a network (the
   AGPL family). Such an engine runs as its own program, addressed by the plugin
   over its own protocol; the plugin binary then carries none of its terms.
4. A file-scoped reciprocal upstream (the EPL family) MAY be embedded, declared
   as the split HIP-0137 §6 states: those files keep their license, ours keep
   ours, and NOTICE says which paths are which.
5. **The reach is one binary, and that is worth stating positively.** Every
   plugin binary links the shared request tier — 594 packages — as well as its
   own graph, so an embedded engine's terms reach that copy of the core as
   conveyed in that binary, and reach no sibling binary at all, because a
   sibling is a separate artifact built from separate sources. A capability with
   an unusual upstream is a fact about that capability and not about the fleet.
6. **The obligation follows the act, so read the terms of what you link.** Rules
   2 and 3 are about conveyance, and an operator who builds a substitute for
   their own deployment and hands it to nobody conveys nothing. The
   network-reciprocal family is the case that shows why the rule cannot stop at
   conveyance: its condition attaches to serving users, which an operator who
   distributes nothing still does.
7. A substitution changes what the deployment's terms are, so the declaration in
   §7 moves with it. A record still naming the replaced project states terms the
   running binary is not under.

### §4 Data

1. A capability owns one store or none (HIP-0139 §6). The store's SHAPE belongs
   to the engine and is not part of §1's contract — nobody stated it, so nothing
   may rely on it.
2. Data therefore does not travel by itself. **The substitute owns the migration
   and the operator owns running it.** The platform migrates nothing across a
   substitution: it would be translating between two schemas, neither of which it
   was told.
3. What the platform does hold across a substitution is WHERE rows live and WHO
   may open them. The path is built from the validated org through the one
   injective encoder, so a distinct org is a distinct file; the key is derived
   from the deployment master, that namespace and the store's own name, so a file
   is born encrypted. A substitute inherits both by opening its store the one way
   (`cloud.OrgDB`), whether or not it inherits a single row.
4. A substitute that cannot read its store MUST answer an error and MUST NOT
   answer empty. A populated store reporting `total: 0` is indistinguishable from
   an empty one, so absence reported as data is the one failure nothing
   downstream can catch.
5. **Data survives an exchange when the capability states the RECORD instead of
   the store.** `kms` is the worked example. Its envelope is `luxfi/kms`'s — Seal
   and Open run in the client, so plaintext never reaches persistence — while the
   sealed records sit one file per org in the fleet's own encrypted SQLite rather
   than in the upstream's embedded ZapDB. The record is what makes that possible:
   the primary key `(path, env, name)` is the exact coordinate the upstream's key
   encodes, so a listing answers the same question, and the seal binds the full
   store path as associated data, so a record moved into another org's file does
   not open. The engine decides only where the row sits.

### §5 What the platform holds, whatever the engine

These hold because they are decided outside the plugin. An operator receives
them without asking, and a substitute cannot weaken them.

1. **Tenancy.** The org a request acts as is minted at the identity boundary from
   a validated claim and arrives as identity the plugin did not choose. A plugin
   reading a tenant from a request field is reading a value the caller authored
   (HIP-0026). Isolation is then physical, per §4.3.
2. **Admission.** Audience is decided by ADDRESS, so a substitute inherits it:
   the operator's `/v1/admin/<name>` family is dropped from the public document
   by its address, and a `beta` or `alpha` prefix answers 404 — never 403 — to an
   org that does not hold the flag (HIP-0139 §3.2, §8). Neither is a property of
   the engine.
3. **Credentials.** A plugin receives the credentials of the app it was started
   as, over a private socket, from the one process holding the deployment root
   key. The scope is derived from the name the launcher stamped, so a substitute
   can present the token it was handed and cannot spell a sibling's path.
4. **Audit and integrity.** A plugin lifecycle change is recorded before it is
   made, and a deployment with no durable audit store refuses the change rather
   than performing an unrecorded one (`apps/plugin/fleet.go`). Across hosts it is
   applied one at a time and stops at the first failure, and a replacement is
   proven listening before traffic moves — so a substitute that will not come up
   reaches one host, which keeps serving the binary it has.
5. **Availability.** A capability switched off keeps its routes registered and
   answers 503 (HIP-0106 §11.4). The address still exists and the caller is told
   to retry, rather than being sent to look for a spelling mistake.

### §6 What an operator takes on

1. The platform verifies a digest, never a behaviour. A digest says which bytes
   run. It says nothing about what those bytes do with the credentials and the
   data of the capability they were installed as.
2. The substitute's own upstreams become the operator's chain. HIP-0139 §6's
   declaration is a statement by whoever wrote it, and a substitute's is a
   statement by its author.
3. Every capability HIP states what an attacker gets from the wrong
   implementation (HIP-0139 §6). **That paragraph is the security half of the
   conformance surface**, and satisfying it is the operator's, because §2's
   document cannot express it: an engine can answer every operation with the
   right schema and be wrong in exactly the way that paragraph names.
4. The deployment answers for its own compliance claims about that capability,
   because a claim is about a deployment.

### §7 The record

1. HIP-0139 §6 requires a capability HIP to name the upstream it derives from —
   every project it forks, embeds or mirrors, each with its license and what of
   it survives. That declaration is about the reference implementation.
2. A deployment running a substitute MUST keep its own declaration, naming what
   it actually runs on the same three points. An operator's record is the
   operator's; a substitution does not amend anybody else's HIP.
3. When the reference implementation itself exchanges an engine, the
   capability's HIP is amended in the change that lands the code, spec first
   (HIP-0139 §6).

## Rationale

The alternative to substitution is the fork, and its cost is not the merge. A
fork of the host taken to change one capability stops receiving every other
capability's work: the operator pays for the one component they wanted with the
hundred they did not.

The alternative to exchanging a BINARY is a driver interface inside each
capability — a declared seam an engine plugs into. That is one interface per
capability, each an extra shape to keep in agreement with the single thing it
abstracts, and each one has to be predicted before anybody knows what will be
worth exchanging. The binary is already the seam, it needs no prediction, and it
is the only form that also bounds the license reach (§3.5): an in-process driver
puts the engine's terms back inside the shared binary.

Conformance is defined on the DOCUMENT rather than on a suite because the
document is a projection of the router, while a suite is a second artifact
somebody maintains. A suite that has only ever passed has not been shown to
work; a projection that disagrees with what is served cannot be produced.

## Security Considerations

Substitution puts code that holds a tenant's data into the deployment, and the
only automatic check is the digest. That is the residual risk, stated plainly:
the platform can prove which bytes run, where they may read (§4.3) and what
credentials they may hold (§5.3), and it cannot prove what they do. The reviewer
is the operator, which §6 says rather than implying a guarantee that is not
there.

Two boundaries MUST NOT be substituted, and the argument in both cases is that
conformance cannot see the failure.

**The code that mints a claim other capabilities trust.** Every other
capability's tenancy is a consequence of identity rather than a peer of it: the
store path, the audit row and the meter are all keyed on an org that arrived as a
validated claim, and no downstream capability holds a second source to check it
against. An identity engine that answers every operation with the right schema
and mints whichever org a caller asked for is fully conformant and fully
compromised — the failure is invisible to the only test substitution has. An
operator who wants a different identity provider reaches it through the protocol
the identity capability already speaks at `/.well-known` (HIP-0139 §3.2); that is
configuration, and it is the substitution that remains available.

**The code that holds key material in the clear.** Custody's property is what is
NOT observable, and conformance is observational: an engine that seals correctly
and also keeps a copy answers every test the platform can run exactly as one that
does not. Its reach is also more than one binary — one process holds the
deployment root key and hands every other its scoped bundle (§5.3), so
substituting that process substitutes where every capability's credentials come
from.

Both are properties rather than names, and that is what keeps the rule narrow.
What may not be substituted is the minting and the custody. Everything strictly
behind them is an engine like any other, which is why `kms` persisting sealed
records in a store that is not its upstream's is conformant: the sealing did not
move (§4.5).

## References

- HIP-0026 — Identity & Access Management Standard
- HIP-0106 — The Hanzo Plugin Contract
- HIP-0137 — One License
- HIP-0139 — Capability

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
