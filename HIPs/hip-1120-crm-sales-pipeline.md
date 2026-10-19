---
hip: 1120
title: CRM — The Sales Pipeline
author: Hanzo AI
type: Standards Track
category: Interface
status: Final
implementation-go: partial
created: 2026-08-20
requires: HIP-0026, HIP-0106, HIP-0139, HIP-1126
---

# HIP-1120: CRM — The Sales Pipeline

## Abstract

Sales is companies, people and opportunities, plus hiring and the programme
intake that lands as an application. Its records live in the org's own Base:
the `crm` module of `hanzoai/base` (`modules/crm`) is the collection set, an
org installs it into its Base, and the records are read and written through
Base's own `/v1/base` surface, rules and realtime.

This HIP declares no capability in front matter: a capability is one
`/v1/<name>` the cloud serves, and the CRM's records need none of their own.
What this HIP fixes is the record model, who reads and changes it, and the
boundary that keeps a prospect out of the user roster.

## Amendment: the store is the org's Base (2026-10-18)

The owner reversed §1 and §2 of this HIP as first written. They put the records
on the document engine (HIP-1126) as framework documents in module `crm`, served
at `/v1/framework`. That engine filters by equality alone, over a JSON column,
with no realtime, no files and no aggregates, and a CRM's views, segments,
pipeline sums and timeline need every one of those. Base has them, so the
records move there, one way per capability:

- **Schema.** The `crm` module (companies, people, opportunities, candidates,
  applications, lists, list_members, segments, activities, notes, tasks,
  attachments, views) is installed by an org admin with
  `POST /v1/base/modules/crm`, or by a sibling app with the plane op
  `base_import`. Installing grows a Base and never drops what an org added.
- **Field types.** Currency, emails, phones, links, address, full name, actor and
  rating are Base field types, with a label, description, icon and position on
  every field and a colour on every select value.
- **Reads.** Base's records API, its `where` structured filter (per-type
  operators, AND/OR groups, relative dates, `@me`, in-list and in-segment) and
  its aggregate route.
- **Writes from other apps.** The plane ops `base_upsert`, `base_get` and
  `base_list`, which act for the caller's org only.
- **History and events.** A collection that keeps history writes who changed
  what, in the record's own transaction; every record write is a fact on the
  event bus (`record_created`, `record_updated`, `record_deleted`).

What has not moved yet is the framework documents an org already holds. Until
their migration lands, `/v1/framework` keeps serving them; when it lands, the
`crm` DocTypes are retired and §1 and §2 below are history.

The roster boundary in §Security is unchanged: nothing resolves a notification
audience, a seat or an entitlement from these records.

## Motivation

A CRM contact is a prospect the org tracks, not a product user: the org's own
users live in IAM, and the marketing subsystem resolves audiences from that
roster, never from these documents. Without one place that owns the prospect
universe, prospect rows leak into user stores and the two contact universes join
by accident — which is a privacy defect, not a modelling choice.

The second question this settles is where sales records belong at all. A sales
pipeline is exactly what the document engine is for: a closed set of typed
records with a lifecycle field, per-org isolation, role-gated CRUD and one
renderer. Building it as its own app bought a second copy of CRUD, a second
store, a second permission model, and a name in the fleet for a thing the engine
already served.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted
as in RFC 2119.

### §1 The store is the engine's (reversed by the Amendment)

crm opens no store. A company, a contact, an opportunity and an application are
`framework.DocType` documents carrying the module tag `crm`
(`apps/crm/crm.go`), and the engine holds them: one SQLite file per org, opened
by the framework, with every call taking the org as an argument — so the tenant
boundary is the storage boundary and there is no `org` column to forget.

`apps/crm` declares the document set at init and exports nothing else
(`framework.RegisterModule`). Its own gates check that every DocType is valid,
every Link resolves to a DocType that exists, every Select is a closed set, and
that the module is registered (`apps/crm/crm_test.go`).

### §2 The addresses (reversed by the Amendment)

There is no `/v1/crm`, and no manifest row claims one. The surface is the
engine's generic, role-gated one under `/v1/framework`: list, read, write and
delete a document by `module.kind`, and the console's CRM screens are that same
DocType renderer scoped to this module. An org gets the lane by installing it —
`POST /v1/framework/modules/crm/install` — which ensures the four DocTypes exist
in that org.

A module that needs an operational read no generic surface can serve is what
earns a prefix of its own; `patrol` is the worked example (HIP-1331). crm needs
none, so it has none.

### §3 Tenancy and roles

The org is the validated principal's, resolved once by the engine (HIP-0026);
`apps/crm` never sees a request. Reads and writes admit two roles: the org's
System Manager, and `CRM User`, which the owner assigns through
`/v1/framework/roles`. Both are IAM roles in the tenant's own org, and the same
values appear in the document permissions, so who may touch a record is answered
in one place.

An application is the one record that arrives from outside the roster: it holds a
company name, a contact, a stage from a closed set, and the screen a reviewer
files against it. On acceptance it is promoted into a company and a contact, and
the promoted rows are Links back to it, so the trail from intake to customer is
one read.

### §4 Money, events, telemetry

Free. The documents ride the framework's plugin, which declares `cloud.Free`,
and no meter runs behind a document write. crm publishes no events of its own,
and emits nothing to observability beyond the request span every framework route
gets.

### §5 Stage

The engine's. crm is not a fleet app, so it carries no stage of its own; what a
caller is shown is `/v1/framework`'s (HIP-0139 §8).

### §6 Upstream

crm derives from no third-party code. The one third-party fact is schema
lineage: the entity model mirrors Twenty's standard objects — company, person,
opportunity — with composite fields flattened to scalar document fields, so a
migration is a column mapping. Nothing of Twenty's implementation is in the tree.

## Rationale

A module rather than an app, because nothing in a sales pipeline is unusual. The
records are records, the lifecycle is a field, the permissions are roles, and one
renderer draws all of it. An app would have bought a second CRUD plane, a second
store and a name in the fleet, and every one of those is a thing that can drift
from the engine that already did the work.

The cost is that CRM has no address a caller can guess, and that is the honest
consequence rather than a defect to paper over: a client reaches these records
the way it reaches any document, by naming `crm.company` at `/v1/framework`.

## Security Considerations

The wrong implementation leaks the pipeline: every prospect, every deal and its
amount, to any tenant that can name another's id. Here the control is the
engine's and is structural — one file per org, the org supplied by the identity
boundary as an argument to every call — so a cross-tenant read is not a query a
caller can shape.

The second exposure is the roster boundary in §Motivation. A prospect is not a
user: nothing may resolve a notification audience, a seat or an entitlement from
these documents, and a join between this module and IAM's roster is a privacy
defect whichever direction it is written in.

## References

- HIP-0026 — Identity and Access Management
- HIP-0106 — Hanzo Plugin Contract
- HIP-0139 — Capability
- HIP-1126 — Framework: the document engine that serves this module
- HIP-1331 — Patrol: a module that did earn a prefix, and why

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
