---
hip: 1327
title: Public Channels — Finding a Room in Another Org
author: Hanzo AI
type: Standards Track
category: Core
capability: team
status: Draft
created: 2026-09-01
requires: HIP-0139, HIP-0523, HIP-1048
---

# HIP-1327: Public Channels — Finding a Room in Another Org

## Abstract

A room is already public or private (HIP-0523), and public is the default. But
public means *anyone in the org* — the list a person can browse stops at their
own tenant. This HIP specifies how a room becomes findable from outside the org
that owns it, and what it takes to join one.

It adds one platform-scoped **directory** and two addresses. It does not add a
second room store, a second message path, or federation between deployments. A
room joined from another org is the same room in the same store; what changes is
who its roster admits.

## Motivation

The ask is ordinary and the product does not answer it: *everyone should be able
to see and join the Hanzo channels, and browse orgs that have public ones.* An
open-source project's channel is worth nothing if only the company that owns the
org can find it.

What blocks it is not policy. `listRooms` (`apps/team/room.go:208`) resolves the
caller's org, asks `SpacesForOrg` for that org's spaces, and reads each with
`byClasses(org, space, …)`. That last call is `s.db(org, space)`
(`apps/team/store.go:198`) — **the org and space select a distinct database.**
Tenancy here is physical, which is the estate's rule and not this subsystem's
quirk: a distinct org is a distinct file.

So "list public rooms across orgs" cannot be a predicate added to that handler.
Answering it there would mean opening every tenant's database on an unauthenticated
person's behalf, which is the one thing the storage model exists to prevent. The
feature needs somewhere else to look.

## Specification

### 1. The directory

A single platform-scoped index, outside every org's store, holding one row per
room that is public:

    org        the owning org
    space      the space within it
    room       the room id, as the owning store knows it
    name       what a person sees
    topic      one line, when the room has one
    members    a count, never a roster
    updated    when this row was last written

It holds **no message, no member identity, and no private room.** A row is the
minimum needed to render a result and address the room it names; anything more
would be a second copy of the room, and HIP-0523 has one store for a reason.

The directory is a projection, never a source. If it disagrees with the owning
org's store, the store is right and the row is stale.

### 2. When a row is written

The owning org writes its own rows. Four events, all of them already writes the
`team` app performs:

| event | effect |
|---|---|
| a public room is opened | insert |
| a room is renamed or its topic set | update |
| a room turns private | **delete** |
| a room is archived | delete |

A room that turns private must leave the directory in the same write that turns
it, not on a later sweep. The window between the two is a window in which a
private room is advertised.

### 3. Finding

    GET /v1/team/public?q=&org=&limit=&cursor=

Answers rows from the directory, newest-updated first. `q` matches name and
topic; `org` narrows to one. It is readable by any authenticated principal —
the rows carry nothing an org has not published, and a directory only its own
org can read is not a directory.

It is NOT part of `GET /v1/team/rooms`. That address answers *the caller's*
rooms and its meaning must not change: a client that renders it as a sidebar
would start listing strangers' channels in a person's own list.

### 4. Joining

    POST /v1/team/rooms/{id}/join

The one write that crosses a tenant boundary, and the whole of the new
authorization. It admits the calling principal to the roster of a room their org
does not own, and it is refused unless every one of these holds:

1. the room is in the directory — that is what "public" means here, and reading
   the owning store to decide would be the cross-tenant read this HIP avoids;
2. the room is still public in the owning store, re-read at the moment of the
   write, because a directory row can be stale and a stale row must not admit
   anybody;
3. the caller is an authenticated principal with a home org — a machine token
   with no org joins nothing;
4. the owning org has not barred the caller's org.

A join writes a member into the owning org's store. It does not copy the room,
and it does not give the joiner's org a room of its own.

#### What this costs, measured

Admitting a stranger is not a matter of appending to `members`. Every read path
resolves the space through `identity.admit` (`apps/team/account.go:1267`), which
calls `SpaceByUUID(ctx, cl.org, wsUUID)` — **the space is looked up scoped to the
CALLER'S org**, so a space another org owns does not resolve for a stranger at
all, and the call returns `errNoSpace` before membership is ever consulted.
`AccountForSubject` (`account_store.go:390`) is the same shape one layer down: it
asks IAM whether the subject may act *in that org* and answers `false` for
anybody who may not.

So room membership across orgs cannot be added as a row. It requires a room-scope
that exists independently of org membership — a caller admitted to one document
in a tenant they are not a member of — and that is a change to what `admit`
means, which is the tenant boundary itself. **It is an architecture decision and
this HIP does not smuggle it in as an implementation detail.** Two shapes are
worth weighing, and neither should be chosen without the owner:

1. **A guest membership row in the owning org**, carrying the room it is scoped
   to. `admit` gains a second question rather than a looser first one; the
   boundary stays a boundary and a guest reaches exactly one document.
2. **Grant the joiner IAM membership of the owning org.** Simpler to write and
   much larger than it looks: it makes a channel-joiner a member of the company,
   which is not what joining a channel means.

The directory and its read (§1–§3) do not wait on this, and are shipped.

### 5. What a joined member is

A member from another org is a member: they read the room's messages and write
messages to it. They are NOT an administrator of it. Specifically, they may not
rename it, bind it, make it private, archive it, or admit anybody else. Those
verbs stay with the owning org, because the room is the owning org's document
and its lifecycle is that org's to state.

Leaving is `DELETE` on the same address, and removes exactly the caller.

### 6. What this does not specify

- **Federation between deployments.** Everything here is within one estate. Two
  estates sharing a channel is a different problem and needs a different HIP.
- **A public DM.** `teamRoomNew` carries no `direct` field
  (`apps/team/room.go:432`), so a direct message is not opened by that route and
  is not made public by this one.
- **Discovery of orgs.** `org=` filters the directory by a name the caller
  already has. An index of orgs is `iam`'s to publish, not `team`'s.

## Rationale

**Why a directory rather than a query.** The alternative is a handler that opens
every org's database and filters. That is not a bigger version of the current
read; it is the opposite of it. The physical partition is the isolation, so a
reader that spans partitions has no isolation left to rely on — one bug in the
predicate leaks a private room, and nothing structural stops it. A projection
holding only published fields cannot leak what it never held.

**Why the join re-reads the owning store.** A directory is eventually consistent
by construction. Trusting it for the admission decision means a room that turned
private a second ago still admits strangers. The row decides what is *findable*;
the store decides what is *joinable*. Two questions, two sources, and the
stricter one wins.

**Why joining does not copy the room.** A copy is a second store, and then two
rooms drift and nobody can say which one a message landed in — the same argument
HIP-0523 makes for having one store at all.

**Why a member count and not a roster.** "How busy is this channel" is what a
person choosing between rooms is asking. Who is in it is that org's to disclose,
and a roster in a public index is a membership list published without consent.

## Security Considerations

**The directory is the disclosure boundary.** Every field in it is world-readable
to authenticated principals; nothing may be added to it that an org has not
chosen to publish by making a room public. Adding a field to that row is a
disclosure decision, not a schema change.

**A stale row must never admit.** §4.2 is the load-bearing clause. Without the
re-read, the window between "turned private" and "row deleted" is a window in
which anybody can join a private room, and directory writes are exactly the kind
of thing that fails quietly.

**A join is an audited privileged write.** It adds a principal from outside the
tenant to a document inside it. It belongs in the audit trail with the joiner,
the room, and both orgs named, for the same reason every other cross-boundary
write does.

**Barring is per-org and must be checkable without the joiner's cooperation.**
§4.4 is what lets an org that publishes a channel stop a specific org from
entering it. It is a property of the owning org, read on the join path.

## Measured state, 2026-09-01

Against `apps/team` at `84c74fee81`, and probed on production and a local cloud
with `/v1/bogus-control-xyz` (404) as the control:

| thing | state |
|---|---|
| `GET /v1/team/rooms` | shipped — `room.go:121`, 403 unauthenticated |
| `POST /v1/team/rooms` | shipped — `room.go:122`, opens a room, public by default |
| `PUT /v1/team/rooms/{id}` | shipped — `room.go:123`, states intent |
| `GET/POST /rooms/{id}/messages` | shipped — `message.go:103-104` |
| `private` on a room | shipped — `teamRoomNew`, `room.go:432` |
| org-scoped listing | shipped — `room.go:208`, via `s.db(org, space)` |
| the directory | **shipped** — `apps/team/public.go`, system namespace |
| `GET /v1/team/public` | **shipped** — typed, `x-tool`, published in the subset |
| publish on open | **shipped** — `room.go`, public rooms only, best-effort |
| `POST /v1/team/rooms/{id}/join` | **absent** — blocked on §4's decision |

A local cloud's `/v1/openapi.json` listed `GET` alone on `/v1/team/rooms` while
the route answered `403` to a `POST`. The document lagged the binary; the route
is the measurement. Probe the address, not the spec.

## References

- HIP-0139 — A Capability Answers At Its Own Name
- HIP-0523 — Rooms — One Store, Two Views, Many Bridges
- HIP-1048 — Team
- HIP-1066 — Channels — One Inbox

## Copyright

Released under the same terms as the rest of the HIPs repository.
