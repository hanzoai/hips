---
hip: 1331
title: Patrol — Standing Watch Over an Estate
author: Hanzo AI
type: Standards Track
category: Application
capability: patrol
status: Final
implementation-go: shipped
created: 2026-09-18
requires: HIP-0026, HIP-0106, HIP-0139, HIP-1126
---

# HIP-1331: Patrol — Standing Watch Over an Estate

## Abstract

`/v1/patrol` is a guarding operation's own surface: the sites it watches, the
units on the ground, the tours they walk, the keys they hold, the cameras they
open, and the incidents that interrupt all of it. The records are documents on
the engine (HIP-1126) in module `patrol`, so editing a site or registering a
camera needs no code of its own. This prefix serves the four things that generic
surface cannot: the reads shaped for one screen, the incident state machine,
alarm intake, and the live feed. It is implemented in `hanzoai/cloud` at
`apps/patrol`, and it opens no store.

Twenty-nine operations, twenty-seven of them typed.

## Motivation

A control room is a screen that has to be right. A controller watching an
activation arrive needs the site, its tier, the nearest unit, the keys for that
premises and the last hour of events in one read, at the moment the alarm lands —
and then has to move the incident through nine states with an audit trail nobody
can edit afterwards. None of that is CRUD, and all of it is what the job is.

The generic document surface is where the same operation's *records* belong, and
it already serves them: eighteen DocTypes, per-org isolation, role-gated reads and
writes, one renderer. Building a second CRUD plane here would have bought a second
copy of every one of those properties. So the question this HIP answers is not
whether an estate needs documents — it has them — but what a prefix of its own is
for, and the answer is narrow enough to list.

Two facts make the narrow answer necessary rather than a convenience.

An incident's order is the record. `verified` before `dispatched`, `onsite`
before `checked`, a filed report before a close: if any surface can write the
state field directly then the trail is a suggestion, and a guarding company's
trail is the thing a client, an insurer and a court read. A document write cannot
hold that rule; a transition table can.

An activation is never dropped. A panel fires, a receiving centre posts it, and
whatever the payload says, something has to be recorded — because the failure
mode of alarm intake is silence, and silence is indistinguishable from a quiet
night.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted
as in RFC 2119.

### §1 The store is the engine's

patrol opens no store. Eighteen DocTypes carry the module tag `patrol` — tenant,
client, zone, hazard, unit, site, fix, tour, point, key, movement, camera,
incident, alarm, step, event, note, report — and the engine holds them: one
SQLite file per org, every call taking the org as an argument. There is no tenant
column, because the tenant boundary is the storage boundary.

Every read and write on this prefix goes through the engine's in-process API. A
second store here would be a second answer to where a unit is, and the whole
product is that there is one.

Geography is plain: latitude and longitude are floats and distance is a
haversine. The engine holds no geo index and answers no range query, so
nearest-unit is a linear scan — correct for an estate of hundreds of sites and
dozens of units, and the reason every list route is bounded rather than paged.

### §2 The addresses

Twenty-nine operations under `/v1/patrol`, composed from the module name so the
prefix and the tag cannot disagree.

Twenty-seven are typed ops, each one registry entry carrying its route, its
schema, its MCP tool, its CLI command and its generated SDK method. Two are not,
and the ledger of exemptions is closed with the wire fact for each:

- `GET /v1/patrol/feed` is an open Server-Sent Events response written by a loop
  that outlives the handler. A typed op answers one marshalled value, and a feed
  has no such value.
- `GET /v1/patrol/report/{name}` is bytes under a filename — a PDF, or plain text
  when the caller asks for it. No input and output pair describes either.

The shape of the surface:

    /tenant/:org                the public face of one operation
    /snapshot                   the whole screen, in one read
    /site  /site/:name          the estate, and one premises
    /unit  /unit/near           who is out, and who is closest
    /unit/:name/fix             a position report
    /unit/:name/state           on shift, on break, off
    /tour  /point/:name/confirm the walk, and a point confirmed on it
    /key   /key/:name/move      the key register, and custody moving
    /camera                     what can be opened
    /camera/:name/stream        mint an address for one camera
    /incident  /incident/:name  the interruptions, and one of them
    /incident/:name/step        an act against the state machine
    /event  /note               the trail, and what someone wrote on it
    /alarm                      intake
    /report                     file one

`GET /tenant/:org` is the one anonymous route, so the group carries no blanket
scope and admission is asked per route. The org on it is a name a stranger
supplied, and resolving a store creates one — so the read checks that the
deployment already holds that tenant before it opens anything, and answers
absence otherwise. Without that check a caller naming a fresh org per request
would leave a database per name they invented.

### §3 The incident state machine

Nine states, forward only:

    received → verified → dispatched → enroute → onsite → checked → secured → filed → closed

Nine acts move between them — VERIFY, DISPATCH, ROLL, ARRIVE, CHECK, SECURE,
FILE, CLOSE, ESCALATE — and one table decides all of it: the states an act
leaves, the state it lands in, the timestamp it stamps, and the roles admitted to
it. Nothing else MAY decide what an incident does next.

- An act from a state it does not leave is refused with 409 naming the state the
  incident is in. Not 400: the request was well formed and the answer is about
  the record.
- ESCALATE stamps without moving, which is why the table carries the landing
  state rather than inferring it from the act.
- CLOSE leaves `secured` or `filed`, and only the supervisor and above hold it.
- Every act appends one step. An incident and its first step are written
  together, because an incident whose trail does not say it was opened is not a
  record — a failed step takes the incident with it.

One act holds an incident under a short lease. The lease is the crash net and
nothing more: an act is a handful of writes, so a holder that has not finished
within its life is gone, and a caller that has waited its turn is told the
incident is busy.

### §4 Alarm intake

One intake, `POST /v1/patrol/alarm`, and two callers: the receiving centre's own
machine credential, and a controller keying an activation in by hand. A DC-09
receiver, where there is one, normalizes into this same body and calls this same
path.

An activation is never dropped, and the two answers say which happened. A body
that matches a site opens an incident in `received` carrying that site's tier and
SLA, and answers 201. A body that matches no site is still recorded, raises an
amber event, and answers 202 — so an unmatched panel is visible in the trail
instead of absent from it.

The body is capped: a reference, a zone, a trigger phrase and the panel's own
payload, each bounded, because anything longer is noise and the caller is a panel.

### §5 The feed

A write publishes one frame on the org's own bus subject. `GET /v1/patrol/feed`
subscribes to that subject and nothing else, and writes each frame as a
Server-Sent Events record.

The bus rather than a map of subscribers in this process, because a control room
runs behind more than one replica: an officer's position posted to one pod has to
reach a controller watching from another. Delivery is best effort — the GET
routes are the truth, and a dropped frame costs one refresh.

A stream costs a goroutine, a subscription and a socket for as long as it is
held, so it is counted twice. A reader is bounded by what that reader holds, and
the tenant's ceiling sits above it. One bound would be paid by the wrong caller:
counted against the org alone, a customer opening tabs in their portal closes the
control room's wall, and the count has no term that could tell them apart.

### §6 Roles

Seven roles, each an IAM role in the tenant's own org: owner, manager,
supervisor, controller, officer, client, and centre. The last is the receiving
centre's machine credential — a third party whose whole business with the
operation is one POST, and which reads nothing.

Admission is asked in one place, and it asks two questions: is there a validated
principal with an org, and does it hold one of the roles this route admits. The
org is the identity boundary's (HIP-0026) and MUST NOT come from a path, query or
body. A principal holding a set of orgs that does not include the resolved one is
refused. The engine's System Manager passes every route, which is how an owner
configures the operation before any role is assigned.

The role sets are named for what they do rather than listed per route — everyone,
staff, control, crew, shift, intake, audience — and the same values build the
document permissions, so who may do a thing is answered once.

The role read is bounded. A slower answer than its deadline denies, because that
is the direction to fail.

### §7 Camera streams

A camera's credential is not a field on the camera. It is a path in KMS, and the
stream address is minted rather than stored: `GET /camera/:name/stream` answers an
address carrying a ticket, and `GET /camera/:name/stream/:ticket` is what the
player opens.

The ticket names the tenant it was minted in and carries a tag over that tenant,
that camera and one expiry, signed under a key kept in the org's own KMS
namespace and minted the first time that org mints a ticket. So a ticket verifies
in exactly one org, for one camera, for a few minutes, and a made-up one verifies
nowhere.

A deployment with no KMS serves no stream, and says so. It does not serve one
without a credential.

### §8 Money, events, telemetry

Free, said in those words: the plugin declares `Price: cloud.Free`. No meter runs
behind any route.

It publishes no events on the platform bus, so a customer's webhooks (HIP-1310)
receive no `patrol.*` event. The `event` in §2 is a document in this module's own
trail, read through this prefix, and the frames in §5 are the org's bus subject
for screens — neither is an outbound platform event.

Notifications leave through `notify` (HIP-0061): a filed report tells the
controllers, and an amber intake raises against the trail. Beyond the request
span every route gets, it emits nothing to observability.

### §9 Stage

`ga`. The manifest row declares no stage, and absent is `ga` (HIP-0139 §8).

### §10 Upstream

It forks nothing. The PDF renderer is `pdfcpu` (Apache 2.0), used to set a filed
report's stored body; the body is composed at file time and the PDF produced on
read, so a report reads the same a month later as it did the minute it was filed.
Three kinds — shift, incident, client — through one renderer.

## Rationale

**Why a prefix at all, when `crm` gets none.** The test is whether the capability
has behaviour the generic document surface cannot express. crm has records and a
lifecycle field, so it is a module and nothing more (HIP-1120). patrol has a
transition table, an anonymous intake with two answers, a minted stream
credential and an open feed. Those are four things a DocType cannot hold, and
they are exactly what this prefix serves — the records stayed where they were.

**Why the state machine is a table and not a set of routes.** One route per
transition would put the order in the router, where it is read by no one and
enforced nine times. The single `step` operation takes the act and the table
answers whether it is legal, so adding a state is one row and the audit trail is
uniform by construction.

**Why nearest-unit is a scan.** The engine has no geo index. An estate is
hundreds of sites; the scan is bounded and measured, and a spatial index here
would be a second store with a second answer about where a unit is. If an estate
ever outgrows the scan, the index belongs in the engine, once, for every module.

**Why intake answers 202 rather than 404.** A panel is not a caller that can be
told to try again. An unmatched activation is a real event with an unknown
subject, and the useful record is the activation plus an amber flag a controller
will see — not a refusal at the door and nothing written down.

## Security Considerations

The wrong implementation opens another company's premises. Three things stand in
the way, and each is a construction rather than a check.

The store is per-org and the org is the identity boundary's verdict, so there is
no query a caller can shape that reaches another tenant's estate. Admission asks
for a role as well as an org, so a client reading their own sites cannot read the
key register. And the stream ticket is bound to one org, one camera and one
expiry under a key that lives in that org's own KMS namespace, so a leaked
address ages out and a forged one verifies nowhere.

The anonymous route is the deliberate hole, and it is one document: the public
face an operation chooses to publish — brand, company, the terminology its
screens use. It answers only for a tenant the deployment already holds, and
absence for everything else, so it is not an oracle for which orgs exist beyond
those that published a face on purpose.

The remaining exposure is the receiving centre's credential. It is a machine
identity in the tenant's org holding one role that may post an activation and
read nothing, so a compromised centre can raise false alarms — which a controller
verifies before dispatching, and which the trail records either way — and cannot
read a site, a key or a camera.

## References

- HIP-0026 — Identity and Access Management
- HIP-0061 — Notification and Messaging
- HIP-0106 — The Hanzo Plugin Contract
- HIP-0139 — Capability
- HIP-1120 — CRM: a module that needs no prefix
- HIP-1126 — Framework: the document engine behind the records
- HIP-1310 — Webhooks: outbound delivery

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
