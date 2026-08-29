---
hip: 0140
title: Proposing a Capability
author: Hanzo AI
type: Meta
category: Core
status: Living
created: 2026-08-20
requires: HIP-0139
---

# HIP-0140: Proposing a Capability

## Abstract

HIP-0139 says what a capability is. This says how one comes to exist, and how
one that exists grows.

A capability is proposed as a HIP, numbered at 1000 or above, before any of it
is served. The HIP names the thing, the address, the boundary it owns and what a
customer is promised. It enters at `alpha` behind a flag, reaches `beta` when a
customer can be let in, and is promoted to `ga` when its surface is published to
every generated client, tool, command and page. Every step is proved by a gate
that already runs, and the two judgements a person actually makes — is this one
capability, and may it be published — are the only two this document hands to
anyone.

## Motivation

Every projection of a capability is generated (HIP-0139 §1), so the expensive
part of adding one is never the code. It is the name, the address and the
boundary. A name that is not the word people say is carried into nine places at
once. An address that belongs to another capability inherits that capability's
audience. Both cost a paragraph to fix before the first commit and a coordinated
rename after a client has been generated against them.

So the review happens where it is cheap: on a document with a name in it. The
grounds for refusing one are short enough to check in a sitting.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted
as in RFC 2119.

### §1 The number

Numbers are allocated in two ranges.

1. **0000–0999** — how we work and what the platform is: the process, the
   conventions, the principles, the service standards, the operator's resources.
2. **1000 and above** — one HIP per capability. A HIP in this range specifies
   exactly one capability and declares it in front matter, `capability: <name>`,
   from the moment the cloud serves that name (§2.7).

A new capability HIP takes the next free number at 1000 or above, chosen so the
capability sits beside the ones it is read with. A number is never reused and a
HIP is never renumbered: the number is how a reader cites the document. A
capability HIP that already holds a number below 1000 keeps it — the range
decides where a new one goes, not where an existing one lives.

How many capabilities there are, and how many carry a HIP, are measured and not
written down. `python3 scripts/coverage.py --report` prints both against the
release it is run on.

### §2 From a gap to a served capability

The order is spec first (HIP-0139 §6): write the HIP, land the code that
implements it, let every projection regenerate. Each step is proved by a gate
that already runs.

1. **Name it.** HIP-0139 §2 decides the name and nobody else does. A name that
   fails it is refused here, at the title, rather than at the directory.
2. **Check nobody owns it.** A capability that already answers for the thing is
   its owner, and what is being proposed is an expansion of theirs (§6). The
   served document is the authority for what is answered; `python3
   scripts/coverage.py --report` is the authority for which HIP covers which
   name.
3. **Write the HIP.** A number from §1, `requires: HIP-0139`, and each thing
   HIP-0139 §6 requires. While nothing is served the front matter carries no
   `capability:` key — that key declares a name the cloud answers, and
   `coverage.py` CV006 refuses a declaration nothing serves — and the Abstract
   says, in those words, that the capability is proposed and serves nothing
   today.
4. **Merge it.** `python3 scripts/lint-hips.py` and `python3 scripts/coverage.py`
   both pass. From here the document is the specification and the code is what
   disagrees with it.
5. **Land the code.** `apps/<name>` in `hanzoai/cloud` returning a `*zip.App`,
   `plugin/<name>/main.go`, and one manifest row naming `/v1/<name>`.
   `plugin/gen-app-cmds` proves the bijection. `openapi/misfiled.txt` proves the
   address, and it may not gain a line, so a new capability's address is right in
   its first commit or the commit does not land.
6. **Group it.** The name joins one of the nine domains in `hanzoai/openapi`
   `capabilities.yaml`. `publish.py` refuses a served name grouped nowhere and a
   grouped name nothing serves.
7. **Declare it.** The change that puts the name in the taxonomy is matched by a
   change here that adds `capability: <name>` to the HIP. Both halves of
   `coverage.py` then agree: a served name with exactly one HIP, and a
   declaration of a name that is served.

Steps 5 to 7 leave the capability at `alpha` (§4). No line is ever added to
`capability-coverage.txt` on this path (§5).

### §3 What a proposal must contain

A proposal is reviewable when a reader can check every claim in it without
asking the author a question. It states:

1. the name, and why it is the word people say (HIP-0139 §2);
2. the address `/v1/<name>` and the operations under it — each typed, or
   declared with prose and the reason the response cannot be a value;
3. the boundary: the one store it owns, or that it owns none;
4. the nearest capability that already exists, and why this surface is not
   theirs;
5. everything HIP-0139 §6 requires of a capability HIP — tenancy, money, events,
   telemetry, stage, upstream, and what an attacker gets from the wrong
   implementation;
6. what is served today, honestly. A proposal that serves nothing says so. A
   surface written in the present tense is a claim a reviewer will check and a
   promise the corpus will carry.

It does not restate HIP-0139 §1–§5, and it names no count a gate measures.

### §4 Stage

Stage is a fact about the product; status is a fact about the text (HIP-0139
§8). They move independently: a `ga` capability may carry a `Draft` HIP, and a
`Final` HIP may specify an `alpha` one.

**alpha.** The entry. The manifest row declares it, the prefix answers 404 to
every org that does not hold the flag named for the capability (`/v1/flags`, key
`<name>`), and no generated client, tool list, command group or public page
carries it. Evidence to enter: the merged HIP, and one route that answers. What
`alpha` buys is that the shape of the surface may still change without breaking
a caller. It does not buy an unsettled address, and it does not suspend a gate —
HIP-0139 §3 and §8.4 bind at every stage.

**beta.** A customer may be let in. Evidence:

1. a request that carries no org is refused, and the store is opened by org, so
   a flag admits a tenant and never a reader of everyone's rows;
2. the price is declared in the surface — free, said in those words, or a priced
   route — because from the first admitted org the code bills whatever it says
   and the HIP is the promise it is measured against;
3. every event the HIP names is published on the bus, and every span, metric and
   log line it names is emitted. A promise nobody has watched fire is not
   evidence;
4. an org that did not build the thing holds the flag and has called it.

**ga.** The promotion publishes. It is one edit to the manifest row (HIP-0139
§8.4), and from the next release the operations are in the public document,
`<Name>Api` is in every generated client, the tool is listed at `/v1/mcp`,
`hanzo <name>` is a command group and `docs.hanzo.ai/<name>` is a page. Evidence:

1. no line in `openapi/misfiled.txt` names the capability — its address is its
   name;
2. every operation the public rule will publish is typed (HIP-0139 §4.2, §4.3):
   a generated client cannot express one that is not;
3. the name is grouped in `capabilities.yaml`;
4. `coverage.py` finds exactly one HIP declaring it, and that HIP states each
   thing HIP-0139 §6 requires — the price and the tenancy refusal above all,
   because at `ga` both become public promises;
5. `openapi/floor.json` carries the capability's operation count as of the
   promotion. From then on the surface may not shrink unless the commit that
   shrinks it says so.

At `ga` the flag named for the capability admits nobody in particular; the
prefix answers every org.

There is no demotion. Taking a published surface back is a removal — operations
leaving the document, generated clients losing methods — and `floor.json` is
what makes that removal something a commit has to say out loud.

### §5 The ratchet

`capability-coverage.txt` carries the capabilities that have no HIP. It exists
for one case: a capability reaches the taxonomy before its specification is
written. The name is added there in that same change, so `coverage.py` CV001
does not fire, and the line is deleted in the same commit as the HIP that
specifies it — CV002 fails on a line whose capability is now declared, so
neither half can rot.

The file may only shrink. A name that leaves it never returns, because what
removed it was the HIP that specifies it, and a name enters it exactly once. A
capability proposed by §2 never appears in the file at all: its HIP is merged
before its first route answers, and the declaration lands with the name.

### §6 Expanding a capability that exists

The HIP is amended first, in the order §2 states: amend, land, regenerate.

1. **A new operation.** Amend the capability's address section to name it and
   its type, then land it. `floor.json` rises. `misfiled.txt` may not gain a
   line, so the route is under `/v1/<name>`. The operation is typed, or declared
   with the prose HIP-0139 §4.3 requires.
2. **A new address.** There is none. A capability answers at `/v1/<name>` for
   its whole life (HIP-0139 §3.1) and what grows is the tree beneath it. A
   proposal for a second top-level address is a proposal for a second
   capability, and is written as one: §2 from the top, its own name, its own
   number, its own HIP.
3. **A widened surface.** An operation entering the public document, a price
   changing, an event name being published, a store gaining rows a customer can
   read back: each is a promise, and the promise is written in the HIP before it
   is made. A stage promotion is the widest of them and takes the evidence in
   §4.
4. **A capability carved out of one that exists.** Permitted along a store
   boundary and nowhere else (HIP-0139 §7.2). The new capability gets its own
   HIP; the amendment that gives up the surface lands with it, so no interval
   exists in which two HIPs claim one address.

An amendment never needs a new HIP. A capability's HIP is the living document
for that capability: it is amended in place, and its `status:` says how settled
the text is.

### §7 Grounds for refusal

A proposal is refused, and the refusal names which of these it is:

1. **The name breaks HIP-0139 §2** — a compound word, a hyphen, an underscore,
   the plural of a capability that already exists in the singular, or an
   abbreviation that is not the word people say.
2. **The surface is already owned.** Another capability answers for the thing
   proposed. The remedy is §6.1: an operation under the owner's address.
3. **There is no boundary.** The proposal owns no store and does nothing another
   capability's routes do not already do. A handful of routes over somebody
   else's store is that capability's routes.
4. **It wants a second top-level address** (§6.2).
5. **It is two capabilities.** One HIP declares one capability; `coverage.py`
   CV005 refuses the second declaration, and two specifications in one file are
   unreadable well before a gate sees them.
6. **It is written in the present tense about something that serves nothing.** A
   reviewer weighs a claim by checking it. This one is refused for being
   uncheckable, not for being wrong.

Refusals 1, 4 and 5 are mechanical, and the gates would catch each of them.
Catching them in the paragraph is cheaper than catching them in a commit that
has to be reverted across nine projections.

### §8 Who decides

Two things are decided by no one. The name is decided by HIP-0139 §2 and the
address by HIP-0139 §3, and the gates HIP-0139 §5 lists refuse a projection that
disagrees. There is no exception to grant, because an exception would have to be
a line in a ratchet and every ratchet here only shrinks.

Everything else is decided by the HIP editors, on the merge: whether the
proposal is one capability, whether its boundary is real, and whether the corpus
already covers it. The states are the corpus's — Draft, Review, Last Call,
Final — and a status says how settled the text is, never whether a customer is
shown the thing.

The author may enter `alpha` alone. It costs a directory, a manifest row and a
flag, and no customer who does not hold the flag can tell it exists.

`ga` is the editors', on the evidence in §4. It is the one decision that
publishes: afterwards the surface is in every generated client and held by
`floor.json`, which makes it the one decision that is expensive to take back.

## Rationale

The alternative is to let a capability arrive as code and write its HIP
afterwards. That case has a file — `capability-coverage.txt` — and the file is
the argument against it: every line is a name already living in nine projections
whose specification is still owed, and the name is the part that was free to
change before the first commit. Spec first is not ceremony. It moves the
irreversible decision to the one moment it is still reversible.

The alternative to a declared stage is a flag and a convention about what the
flag means. Then every reader has to ask what a route is for, and the answer
lives with whoever remembers. A stage in the manifest row is an answer the
public rule can read.

## Security Considerations

Two steps here are the security boundary; the rest is bookkeeping.

The address decides the audience. A route admitted under another capability's
prefix inherits that capability's audience and its public rule — an operator's
view offered as a customer method is the concrete case (HIP-0139 Security
Considerations). §2's ordering closes it: the address is proved by
`misfiled.txt` before any projection publishes the operation.

The stage decides who learns the capability exists. HIP-0139 §8.2 fixes that
answer at 404 and never 403, because 403 tells an outsider the name is real. A
capability that reaches `beta` without the tenancy refusal in §4 is worse than
one that never shipped: the flag admits an org, and then the store decides
nothing.

## References

- HIP-0000 — Hanzo AI Architecture & Framework
- HIP-0026 — Identity and Access Management
- HIP-0106 — The Hanzo Plugin Contract
- HIP-0135 — What Is Public
- HIP-0139 — Capability

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
