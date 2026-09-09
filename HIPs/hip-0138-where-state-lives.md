---
hip: 0138
title: Where State Lives
author: Hanzo AI Team
type: Standards Track
category: Infrastructure
status: Final
implementation-go: partial
created: 2026-09-09
requires: HIP-0119, HIP-0136
---

# HIP-0138: Where State Lives

## Abstract

An application does not choose a database. It chooses a **rank**: a per-tenant
file first, the column store for event data, and — only when a server is
genuinely required — the one shared SQL and the one shared KV that serve the
whole fleet. There is no per-app instance and no per-app database, and the
engines are ours: `hanzoai/sql`, `hanzoai/kv`, `hanzoai/datastore`. A HIP that
gives its service a `postgres`, a `redis` or a `mongo` of its own is specifying
something that is not deployed and will not be provisioned.

This HIP is the one statement of that rank. Where another HIP names a private
database, an instance of its own, or an upstream engine by vendor name, this one
is normative.

## Motivation

The rank is not a preference. It was settled by measurement, and the measurement
is that the per-app databases were nearly all empty.

Surveyed in `hanzoai/universe` on 2026-07-31, the shared SQL instance held five
application databases beyond the default. Three of them — `bootnode` (10
tables), `bothub` (32 tables), and the record half of `sign` (48 tables) — were
being actively queried, with hundreds of sequential scans between them, and held
**zero rows** of application data. `sign`'s 6,405 rows were 6,191 rows of a
transient job queue, 151 rows of migration bookkeeping, and roughly 63 rows of
org and team configuration; every document, recipient, field, signature and
envelope table was empty.

What those databases cost was not storage. It was that each one is a connection
string somebody must hold, a credential somebody must rotate, a backup somebody
must verify, and a restore path somebody must rehearse — for a schema with
nothing in it. A separate instance multiplies that by an operator, a
StatefulSet, a volume and a recovery time.

The recovery time is the part that is not theoretical. Measured on the running
forge on 2026-09-08 (HIP-1328), a Postgres crash-recovery took about eleven
minutes to fsync its data directory before it accepted a single connection.
During that window the service answered `424` on its health route, never became
Ready, and the edge returned `503`. No data was at risk; availability was, and
the recovery time is a function of how much a service insists on holding.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted
as in RFC 2119.

### 1. The rank

An application MUST take the first of these that fits, and MUST justify each
step down in its own HIP:

1. **A per-tenant file.** Base's per-org, per-user, per-project SQLite
   (`hanzoai/base`), reached through the org-store seam. This is the answer
   unless something below genuinely applies. It has no server to run, no
   credential to rotate, and its blast radius is one tenant.
2. **The column store, for event and analytic data.** `hanzoai/datastore`,
   database `hanzo`. Almost all of what an application wants a server for is
   event data, and event data belongs here rather than in a relational table it
   will outgrow. A per-tenant file with rolled-up aggregates in the column store
   is one design, not two.
3. **The one shared SQL, or the one shared KV.** `hanzoai/sql` and `hanzoai/kv`,
   one instance each for the whole ecosystem, when a service truly requires a
   server — a foreign extension, a concurrent writer set a file cannot carry, an
   upstream that speaks only one wire.

"It is what we had" is not a reason to be at rank 3. A service already there that
is not using what rank 3 provides SHOULD move up.

### 2. One instance, one database, and the tenant is a row

The shared SQL is a **single** StatefulSet, `sql`, serving `sql.hanzo.svc:5432`.
The shared KV is likewise one. Every application is a tenant of the one database
`hanzo` — not a database of its own inside the shared instance, which recreates
every cost of a private instance except the machine.

- An application MUST NOT declare a `Datastore`, `SQL`, `KV` or `DocDB` CR of its
  own (HIP-0401 through HIP-0404). Those CRs describe the fleet's shared
  instances; they are not a per-app primitive.
- An application MUST NOT be provisioned a database inside the shared instance.
  Tenancy is a column and a predicate, on the server-trusted org from the
  validated identity — never a client-supplied value. HIP-0305 is the worked
  example of that boundary and its compensating controls.
- `postgres.hanzo.svc` is a legacy Service alias selecting `app=sql`, kept so
  existing connection strings resolve. New configuration MUST name
  `sql.hanzo.svc`.

### 3. The names are ours, and so are the images

The service is `sql`; it is not "postgres" and not "postgresql". The service is
`kv`; it is not "redis". The service is `datastore`.

| service | repository | image | what it speaks |
|---|---|---|---|
| `sql` | `hanzoai/sql` | `ghcr.io/hanzoai/sql` | the PostgreSQL wire protocol |
| `kv` | `hanzoai/kv` | `ghcr.io/hanzoai/kv` | RESP2 and RESP3 |
| `datastore` | `hanzoai/datastore` | `ghcr.io/hanzoai/datastore` | the column store's HTTP and native protocols |

Naming the wire protocol is a fact about interoperation and is correct. Naming
the upstream vendor as the thing we run is not: it sends a reader to the wrong
repository, the wrong image and the wrong issue tracker. A `pg_*` catalog query
in our own code is a sign the caller still believes it is talking to the thing
being migrated away from.

There is no MongoDB and no DocumentDB in the fleet. A HIP that specifies one is
specifying an engine nothing runs.

### 4. No application holds a database password

A service reaches the shared SQL through `egress` (HIP-0143), which presents the
caller's **validated org** as the database role and connects on the trust between
egress and the base. The connection URL carries an IAM access token in the
password field, because a Postgres client has exactly one field for a secret; it
does not carry a database password, because the service does not have one.

Two consequences follow and MUST be designed for:

- A session ends when the token does. Build the URL where the pool opens a
  connection — `pgxpool`'s `BeforeConnect`, or a `database/sql` connector — not
  once at boot.
- A `DATABASE_URL` a service reads from its own environment is the pattern this
  replaces. Where one still exists it is a KMS reference resolved at sync time
  (HIP-0136), never a literal in a manifest, and it is a migration item.

### 5. Exceptions

An exception is a HIP, not a decision taken while writing a chart. It MUST state
which rank it is declining, why the ranks above it do not fit, and what would
have to change for it to move up. Exactly one shape of exception has been
accepted so far: an upstream that supports a single engine, has live consumers,
and holds derived data that can be rebuilt from its source.

## Rationale

The obvious alternative is per-service isolation: a database per application, so
a compromised service cannot read its neighbours' rows. That is a real property
and this HIP gives it up at rank 3, so it should be said plainly rather than
argued away.

It is given up because the isolation was not being bought. A database per
application inside one instance shares the instance's credential, its network
reachability and its backup; what it adds is a namespace, and a namespace is not
an authorization boundary. The isolation that would be worth the cost is one
identity per application — a change to identity topology, addressed where
identity is addressed (HIP-0136 §Security Considerations), not by multiplying
schemas.

Rank 1 gives the same property for free and at a finer grain: a per-tenant file
cannot leak to another tenant because there is no query that reaches it. That is
why the rank is ordered rather than presented as three peers a team may choose
between.

## Security Considerations

**The shared instance is one credential.** Everything at rank 3 is reachable by
whatever holds it, which is why §4 removes it from applications entirely: a
service that never holds a database password cannot leak one, and a token that
expires bounds what a leak is worth.

**A shared database makes tenancy a code property.** At rank 1 a forgotten
predicate reads an empty file; at rank 3 it reads another tenant's rows. A
service at rank 3 MUST funnel every cross-tenant read through one predicate keyed
on the server-trusted org, and SHOULD carry the compensating controls HIP-0305
demonstrates — a codec that fails closed on malformed data, and database-level
constraints that make a fabricated privilege value unable to persist.

**Consolidation is where credentials get destroyed.** Moving an application off
its own database is copy, verify, repoint, delete, in that order, and a read that
returns nothing STOPS the move. HIP-0136 records why: an empty read followed by a
write of that empty value, then a read-back comparing empty to empty, reports
success for a migration that moved nothing, and the delete that follows removes
the only real copy.

## References

- HIP-0119 — Hanzo Service Conventions
- HIP-0136 — One Secret, One Path
- HIP-0143 — Egress — The Outbound Trust Boundary
- HIP-0305 — esign: shared-DB tenancy via team-where, not file-per-tenant
- HIP-0401 — Datastore CRD; HIP-0402 — SQL CRD; HIP-0403 — KV CRD
- HIP-0407 — Base CRD
- HIP-1328 — Forge — The Meta Code Host (the measured recovery time)

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
