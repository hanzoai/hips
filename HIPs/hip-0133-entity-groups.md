---
hip: 0133
title: Entity Groups — Placement, Durability, Splitting and Promotion
author: Hanzo AI Team
type: Standards Track
category: Core
status: Final
created: 2026-07-28
requires: HIP-0120
---


# HIP-0133: Entity Groups — Placement, Durability, Splitting and Promotion

## Abstract

> **Organization = placement and security domain.**
> **Entity group = dynamically sized transactional locality within that organization.**

Most small organizations fit in one entity group. Larger ones split into many, rooted
around whatever aggregate is naturally independent: users, teams, projects,
conversations, repositories.

This HIP defines group identity, placement, durability, caching, splitting, promotion and
cross-group semantics. HIP-0120 §6 defines the local access plane (ZAP over UDS) this
rides on.

## Specification

### §1 The physical model

```text
Organization
├── Entity Group: org metadata, policy, billing
├── Entity Group: user_123 + private entities
├── Entity Group: user_456 + private entities
├── Entity Group: team_engineering
├── Entity Group: project_enso
└── Entity Group: conversation_xyz
```

The scheduler places an organization's ACTIVE groups, in order of preference:

1. the same process, when practical
2. otherwise the same node
3. otherwise the same availability zone
4. near the organization's object-storage and compute affinity

Locality without turning a million-user enterprise into one writer.

### §2 The unit is the manifest, not the file

A group is NOT "a SQLite file". It is a manifest:

```text
group identity          organization identity     schema/version
database files          WAL segments              object prefixes
cache footprint         placement lease           writer epoch
replication state       encryption keys           snapshot generation
backend type
```

A group may hold several related SQLite files, indexes, blobs and cached objects. They
warm, migrate, snapshot and evict **together**. That co-movement is the whole point: a
cache that evicts half a group's working set has not saved memory, it has added latency
and hidden the cause.

### §3 SQLite is the execution format, not the storage format

Billions of groups MUST NOT mean billions of permanently open files.

```text
cold state:      encrypted snapshots + WAL segments in Hanzo Storage
warm state:      local NVMe materialization
hot state:       open SQLite connection + page cache
very hot state:  promoted backend or partitioned groups
```

Only the working set materializes locally. A cold organization consumes object storage —
not file descriptors, not RAM, not resident disk.

### §4 The local access plane

Applications MUST NOT open paths or manage SQLite files themselves. They request a
logical entity group from the local datastore agent over ZAP/UDS (HIP-0120 §6):

```text
application
   │ ZAP over UDS
   ▼
local datastore agent
   ├── placement            ├── group cache
   ├── SQLite lifecycle     ├── WAL/snapshot management
   ├── object-storage sync  └── promotion/splitting
```

An application that opens its own file has bypassed placement, eviction, the writer lease
and the encryption boundary at once.

### §5 The `hanzoai/orm` surface

`orm` owns the group lifecycle, not file opening:

```go
type GroupKey struct {
    Organization string
    Namespace    string
    Entity       string
}

type GroupOptions struct {
    Backend      BackendKind
    MemoryBudget int64
    DiskBudget   int64
    IdleTTL      time.Duration
    Affinity     []GroupKey
}

type Group interface {
    DB() ORM
    Warm(context.Context) error
    Flush(context.Context) error
    Snapshot(context.Context) (Snapshot, error)
    Close(context.Context) error
}

type GroupManager interface {
    Open(context.Context, GroupKey, GroupOptions) (Group, error)
    Prefetch(context.Context, ...GroupKey) error
    Evict(context.Context, GroupKey) error
    PlaceTogether(context.Context, ...GroupKey) error
    Split(context.Context, GroupKey, SplitPolicy) error
    Promote(context.Context, GroupKey, BackendKind) error
}
```

**What exists today, measured — the logical model is DONE.** `orm` already carries the
Datastore ancestor model, generically: `Model[T any]` with `Namespace()`/`SetNamespace()`
for tenant isolation, `NewKey(kind, id, 0, parent)`, `key.Parent()`, and `WithParent[T]`
in `options.go` for declaring an entity's parent function. Plus the adapters
(`OpenSQLite`, `OpenZap`, `OpenKV`, `OpenDatastore`, `OpenDocumentDB`) and a cache layer.

So `GroupKey` above is NOT a third key type. `Organization` and `Namespace` map onto what
`Model[T]` already has; `Entity` is the existing ancestor path. Expressing it any other
way would create the second key model this HIP exists to prevent.

**ONE key, one namespace, one derivation.** `orm`'s `Model[T]` + `Namespace` + `WithParent`
is the sole key surface. Every physical name — SQLite path, S3 prefix, cache slot,
placement lease — is DERIVED from it and never independently authored. A subsystem that
builds its own path string has created a second way, and that is checkable: any storage
path not produced by the derivation is a defect.

`hanzoai/commerce` holds an older CONCRETE copy of the same model
(`datastore/key/key.go`, 423 lines; `models/mixin/model.go`, 566; 549 files importing it,
including `AllocateOrphanKey` — the explicit "starts its own group" case worth preserving
in the generic form). It is the duplicate, and it is deleted in favour of `orm`. It is
also prior art with production mileage: read it before changing the generic surface.

**What is genuinely absent is only the PHYSICAL layer** — the manifest, placement,
warm/evict at group granularity, writer lease, promotion. `GetCache()` is a package-level
singleton, and a global per-file cache cannot express "these files belong together",
cannot warm them as a set, and cannot evict at group granularity. Per-group budgets are
the specific change.

### §6 Invariants

The architecture is tractable only with these stated explicitly:

- **ACID transactions are entity-group-local.**
- A group has ONE active writer lease and monotonically increasing writer epochs.
- Cross-group operations use events, sagas, durable queues or derived projections.
- Organization-wide queries use secondary indexes or analytical projections — NEVER
  on-demand fan-out across every user database.
- Group affinity is advisory; transaction boundaries are authoritative.
- Eviction is permitted only after WAL durability and snapshot/object-store state are
  PROVEN.
- Partial eviction of a group is prohibited unless the storage engine explicitly supports
  it.

### §7 Splitting and promotion are policy, not a mode

SQL MUST NOT be a manually chosen "large customer mode". Selection is policy-driven.

Split thresholds: database bytes · working-set bytes · writes per second · writer queue
latency · snapshot duration · recovery duration · cache residency pressure · cross-entity
contention.

Promote when the workload needs concurrent writers, large relational joins, or sustained
throughput beyond the local model — **per group or namespace, not per organization**:

```text
Acme organization
├── identity groups       → SQLite
├── project groups        → SQLite
├── audit/event stream    → columnar/object storage
├── high-volume messages  → distributed SQL/SQL     
└── analytics             → derived warehouse
```

The cheap model is preserved for the majority of an organization while its hotspots scale
independently.

## The governing formulation

> Co-locate an organization's active entity groups as strongly as capacity permits, while
> preserving independently movable, independently evictable, and independently scalable
> transactional groups.

## References

HIP-0120 §6 (ZAP over UDS — the local access plane) · `hanzoai/orm` · `hanzoai/datastore`
