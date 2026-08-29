---
hip: 0523
title: Rooms — One Store, Two Views, Many Bridges
author: Hanzo AI
type: Standards Track
category: Core
status: Final
created: 2026-08-27
requires: HIP-0139, HIP-1048, HIP-1066, HIP-1107, HIP-1210
---

# HIP-0523: Rooms — One Store, Two Views, Many Bridges

## Abstract

A room is the one place work is discussed. `#bugfix-1010` is a room. A direct
message between two people is a room. A person's thread with an agent is a room.
An Instagram stranger's first message opens a room. There is no second kind of
conversation and no second store holding one.

Its members are of three kinds — human, agent, bot — and the kind changes who
does the work, never what the object is. Two surfaces render it: `hanzo.team`
shows the conversation, `hanzo.ai` shows the same room as work in progress. Every
outside network reaches it through a bridge.

This HIP specifies the primitive, the member kinds, the storage line between an
org's rooms and a person's, the rule that surfaces never copy from each other,
and what a bridge owes. It adds no capability and no address: it composes the
ones HIP-1066, HIP-1048, HIP-1210, HIP-1107 and HIP-1252 already specify. §13
marks every mechanism it names as shipped, disabled or absent, measured in the
source on 2026-08-27.

## Motivation

What this is for: anyone can hold one coherent conversation with anyone — a
colleague, a stranger on any network, an agent — and it is the same conversation
wherever they open it. Past automation that becomes something better, a place you
can watch: rooms per problem and per project, swarms visibly working in them,
people and agents doing the work side by side. Two faces, one brain — `hanzo.ai`
for a person's own chat and building, `hanzo.team` for the org's shared space —
and both are thin renderings of one cloud, not two products with a pipe between
them.

What stands in the way is that four things in this estate already hold a
conversation and none of them can see the others. `apps/channels` holds an inbox
of messages that arrived from Slack, Discord, Teams and Telegram.
`apps/team` holds Chunter channels and chat messages, one SQLite per (org,
workspace). `apps/agents` delegates its threads to an external module.
`apps/help` holds a support thread as a framework document. A question asked in
Slack, answered by a person in the team workspace, escalated to a ticket and
finished by an agent crosses four stores and arrives as four unrelated records.
Nobody can read the sequence back, because no store holds it.

The cost is not tidiness. It is that the agent which could do the work is a
member of none of them, so each subsystem grew its own answer to "may a model
reply here" — `apps/channels` has a turn, `apps/team` has a responder — and the
two now answer the same message twice or not at all. HIP-1066's Motivation
records the first version of that defect; the estate has since reproduced it
across capabilities rather than inside one. One object with one member list ends
it: the agent is a member because everyone in the conversation is a member, and
there is nothing else to configure.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted
as in RFC 2119.

### §1 The word "channel" is taken twice, so the primitive is the room

Three meanings of "channel" are live, and two of them ship:

| Word | What it means | Owner |
|---|---|---|
| `channel` | a connected chat transport — slack, discord, teams, telegram | HIP-1066; `Message.Channel` (`apps/channels/envelope.go:153`) is the transport name |
| `channel` | a connected social account — X, Facebook, Instagram, LinkedIn | HIP-1153, "an Account is a connected channel" |
| `room` | **the conversation a message lives in**, kinds `dm`, `group`, `thread` | HIP-1066's envelope; `Room` (`apps/channels/envelope.go:60`) |

The collaboration primitive is the third one, and the shipped envelope already
names it correctly: `// Room is the conversation a message lives in`. This HIP
therefore says **room** and never overloads `channel`, for the same reason
HIP-1107 §3 refuses to let one word mean a run, a rented box and a connected
machine at once.

The two layers are named separately on purpose: **`room` is the wire and the
specification; "channel" is the product word.** A surface renders a room as
`#name` and the people using it say channel; nothing behind the screen does. No
envelope field is renamed and neither HIP-1066 nor HIP-1153 is amended by this
HIP — the two shipped meanings of `channel` keep their addresses, and this
specification simply does not use the word.

### §2 The room

A room is an ordered, durable sequence of envelopes (HIP-1066) plus a member
list plus a name. It has exactly these properties and no others:

- **A scope** — an org or a person (§5). The scope decides where it is stored.
- **Members** — one or more, of the kinds in §3.
- **A life** — `standing` or `bound`. A standing room persists until deleted. A
  bound room names one work object and archives when that object closes.
- **Bindings** — zero or more references to work objects: a project, a
  repository, an issue. A binding is a REFERENCE, never a copy. HIP-1160 §1 makes
  the issue the one work-item primitive and forbids a parallel store; a room
  holding an issue's title or status would be exactly that store. A surface
  showing a bound issue reads it through `todo` at render time.
- **An origin** — native, or the bridge that opened it (§7).

There is no separate object for a direct message, a group, a work room or an
agent thread. Those are a room's member count and its `Room.Kind`.

### §3 Members: human, agent, bot

One member model, three kinds. The kind says what runs when the member is
addressed:

| Kind | What it is | Where it runs |
|---|---|---|
| `human` | a person, identified by the IAM principal (HIP-0026) | nowhere |
| `agent` | an agent definition, addressed on demand | a session, per HIP-1210 |
| `bot` | a standing presence that is always resident | a run, per HIP-1107 |

An `agent` member is dormant until a message addresses it. Addressing it starts
a session; the session ends; the membership does not. A `bot` member is resident
whether or not anyone is talking to it — the Slack presence is one — and the
thing behind the seat is a HIP-1107 bot run. **This HIP mints no fourth meaning
of "bot."** HIP-1107 §3 names three values for that word; the member kind here is
a SEAT in a room, and the run occupying the seat is HIP-1107's.

Membership is authorization. HIP-1048 already states this for a workspace —
"the membership rows ARE the authorization" — and this HIP extends that roster to
rooms rather than introducing a second one. A reader MUST NOT find two places
that answer "who is in here".

### §4 Two views of one room

Two surfaces render the same room from the same store. Neither owns it.

- **`hanzo.team` — the conversation view.** The org's shared space: the room
  list, the message history, the members, the calls, the virtual offices.
- **`hanzo.ai` — the work view.** The same room shown as what is happening in
  it: the agent sessions under way, the code they are touching, the transcript, a
  live preview of the result.

Same room, same history, same members, different rendering. A message sent from
either appears in both because both read one store, not because anything
reconciles them. `meet` (HIP-1252) and `todo` (HIP-1160) render inside both
views; neither is a third surface with its own copy.

**A view is not a build.** Both views come from one codebase, and HIP-0504 owns
that rule: one substrate (`@hanzo/gui`) and one component library per brand
(`@hanzo/ui`) across web, native and desktop. So `hanzo.ai` in a browser, Hanzo
Desktop and Hanzo Mobile are one surface on three hosts rather than three
implementations of it — a room renders the same in all three because it is the
same code reading the same store. Note the direction HIP-0504 requires: an app
imports its brand's `ui` and never the substrate directly, which it calls
non-conformant. "One codebase" is therefore a statement about the substrate
underneath, not a licence for an app to reach past its own library.

### §5 Two scopes, one mechanism, and the tenancy line is the storage line

A room belongs to an org. That is the whole rule, and a person's own rooms are
not an exception to it.

Every person has a home org, and not by convention: a user's id is
`<owner>/<name>` and the owner half IS an org, so a resolved principal always
carries one (HIP-0026). One human may belong to many orgs, and exactly one of
them is their home. So the two scopes are two ADDRESSES on one mechanism, never
two mechanisms:

- **Org scope** — a shared org's rooms and their whole history, canonical in
  that org's store. Today that is `apps/team`'s per-(org, workspace) SQLite
  (`apps/team/store.go`), which already holds channels, direct messages and chat
  messages. `hanzo.ai` READS this store; it MUST NOT keep a copy.
- **Personal scope** — the same mechanism at the person's own org: their threads
  with their agents, and anything addressed to them rather than to an employer.

**The isolation is therefore free, and no query has to remember it.** Work rooms
sit in the work org's file and personal rooms in the person's own org's file
because per-org storage already puts them in different files. A colleague cannot
read a personal room for exactly the reason one org cannot read another's — not
because a predicate excluded them. A shared store with an `is_personal` column
would be the same fact one bug away from an org admin reading their reports'
direct messages, and this design never writes that column.

This is the same line HIP-1065 draws for credentials: "which accounts has this
ORGANIZATION connected" is an administrative fact, and "which accounts has THIS
PERSON linked" is the person's own property with no admin gate on it. A
conversation is at least as personal as a token.

A person's own org is an ordinary org and gets no special case anywhere. It is
smaller, and that is the only difference. Anything that would need to ask "is
this the personal one" has reintroduced the predicate this section removes.

Promotion is a copy, never a move: a person MAY post a personal room's content
into an org room, and that act creates new envelopes in the org store with the
person as sender. Nothing is silently reclassified.

### §6 One store, N views, M bridges

**Surfaces MUST NOT synchronize with each other.** There is no `hanzo.team` →
`hanzo.ai` sync, in either direction, ever. Two live views over one store cannot
disagree; two stores kept in step always eventually do, and the estate has paid
for that lesson three times — HIP-1107 §1 keeps no second copy of a run for it,
HIP-1160 §1 forbids mirroring the forge for it, and HIP-1252's Rationale refuses
to hold rooms and membership for it.

The shape is fixed:

```
                    external network ──┐
                                       ├─ bridge ─┐
                    external network ──┘          │
                                                  ▼
    hanzo.team ────── view ──────────────▶  THE ROOM STORE
    hanzo.ai   ────── view ──────────────▶  (org scope | personal scope)
```

A view holds no messages. A bridge holds no messages. Exactly one store does.

One consequence is immediate and is a defect today: the store must hold **both
halves of every conversation.** `apps/channels` writes an arriving message to
`channel_inbox` and a sent one to `channel_send`, and the two are different
tables (`apps/channels/store.go:109,126`) — so no single read returns the
conversation. A room is the sequence, so a room store that records only what
arrived is not one.

### §7 A bridge

A bridge joins one external network to the room store. Every bridge owes exactly
four things, and a transport is not connected until it has all four:

1. **A binding table** — our room ↔ theirs, both directions, so either side can
   be resolved from the other. Creation is bridged both ways: a room created on
   an outside network with our presence in it opens a room here, and a room
   created here with that transport bound opens one there.
2. **A relay** — messages move in both directions as they happen, normalized
   into and rendered out of HIP-1066's envelope. A bridge MUST NOT invent a
   second message shape.
3. **Echo suppression** — a message this estate sent and the network echoed back
   MUST NOT re-enter the room. Without it every reply appears twice and every
   agent answers its own message.
4. **Identity mapping** — external account ↔ our principal, so a bridged sender
   is a member and not an anonymous string. HIP-1066 already places this question
   in `integrations`: which Hanzo account a chat user has linked is that
   package's to answer, "only the answer crosses. A token never does."

**Credentials are not the bridge's.** They live sealed in the key store under a
path built from the tenant, reached through `integrations` (HIP-1250) or
`connectors` (HIP-1065). HIP-1066's one-way rule holds unchanged: rooms depend on
integrations; integrations MUST NOT depend on rooms.

A bot is not a bridge. A bot may be a member of a bridged room, and the room
still relays with no bot present. Any transport that only works when a bot is
resident has been built wrong.

### §8 Transports, and what each one honestly costs

HIP-1066's transport registry is closed and enumerated — four members today
(`apps/channels/registry.go:76`). A new transport is a tagged member added to
that registry declaring what it can actually render — direct messages, group
rooms, threading — and those declarations are honest rather than aspirational. It
is not a new subsystem.

The roster, with the real remaining cost of each stated rather than implied:

| Transport | State | What is actually left to do |
|---|---|---|
| slack, discord, teams, telegram | in the registry | bind them to a room store; today they reach an inbox, not a room. Discord carries no direct message and says so |
| whatsapp, imessage, signal, and ~20 more | adapter exists, elsewhere | `@hanzo/bot` already speaks these (`bot/src/channels/registry.ts`, plus extensions); `apps/integrations` holds only a WhatsApp credential connector. The work is a registry member and a relay, not an adapter |
| email | send-only | outbound connectors exist (`apps/integrations/messaging.go`); HIP-0061 owns `/send/email`. Nothing binds an arriving mail to a room |
| sms, voice | send-only | `tel` (HIP-1069) owns numbers, calls and messages and is not a registry member |
| x, linkedin, facebook, instagram | publish-only | `social` (HIP-1153) publishes to these; publishing is not conversation. Messaging on the Meta networks is a new adapter with its own review and its own reply-window rules |

Two of these deserve their true cost said out loud. **Publishing to a network is
not a conversation with it** — sharing an account's credential does not give
inbound messages, and four rows above are publish-only for that reason.
**iMessage has no server API.** It needs a relay on Apple hardware holding a real
account, which is an operational and policy commitment before it is an
engineering one. `@hanzo/bot` reaches it by exactly that route. Do not list it
beside the others as though it were an adapter.

### §9 The hub room and the correspondent room

Each connected transport gets one **hub** room — `#whatsapp`, `#instagram` —
standing, org-scoped, whose members are the people and agents who work that
network. The hub is where that network's outbound work is done: a post is
drafted, discussed and published from it through `social` (HIP-1153), which
remains the one publisher.

Each inbound conversation from an outside person opens one **correspondent**
room, named `#<transport>-dm-<their-handle>`, created on the first message with
no setup. It is a child of the hub, org-scoped, standing, and visible in both
views. A reply sent from any surface leaves on the transport it arrived on, as
the org's identity there.

A correspondent room is a shared inbox: **any member may answer, and members
include agents.** There is no assignment step and no owner column. Handling is
whoever picks it up, which is the property that makes a room worth having instead
of a queue.

Two limits are not negotiable. Auto-creation is bounded — an unbounded room per
inbound stranger is a room-creation flood with a name attached — so it is subject
to the access decision HIP-1066 already makes per (org, transport): pairing,
allowlist, or open. And HIP-1066's rule that sender identifiers MUST NOT appear
in logs holds here too; the room's name carries the correspondent's handle, and
the room is not a log.

### §10 The ambient agent

The org's agent is a member of every new room, by default, as org policy.

This is one line in one function. There MUST be exactly one place a room is
created, and default membership is applied there. Applied anywhere else it is a
policy with holes: a room made by a bridge, by an agent, or by a person would
each get their own answer. That single place does not exist today (§13), and
creating it is the prerequisite for this section, not a detail of it.

The agent is addressed by mention and runs a session (HIP-1210). It holds no
authority a member does not have: it reads the room it is in, and no other.

First contact with an outside person is answered by a human. What the agent MAY
do without review is recurrence — an answer a person already approved, asked
again — and the authority a specific member has to send without a person's act is
specified per user in HIP-0524, not here.

**One responder, not two.** `apps/channels`' turn and `apps/team`'s responder are
two implementations of "a model answers a message", and with one room store they
answer the same message. They MUST fold to one, and the survivor is the one
beside the store that holds the message, for the reason HIP-1066 already gives:
everything the turn needs — the policy, the reply route, the egress — is already
there.

### §11 A swarm is a session tree

Fanning out is not a new mechanism. An orchestrating agent starts child sessions
under a root; the children are research, coding, browser or computer work; the
tree is the record. HIP-1210 owns the session, its events and its per-org store,
and the tree is already served.

The work view (§4) renders that tree live: what each session is doing, and the
controls to pause, resume, stop or message any node of it. Compute under a
session is a `sandbox` lease (HIP-1146) — one primitive, whatever the lifetime.

The point of rendering it is not display. It is that a person can see and steer
every piece of agentic work from the room the work was asked for in, rather than
learning where each subsystem hid its own console.

### §12 A call happens in the room

A call is not a separate place. `meet` (HIP-1252) mints a join token for a room,
and holds no membership of its own: it asks the roster who is in.

Three consequences follow, and each is a constraint rather than a feature:

1. **The join decision still asks the roster.** `meet` asks `team` who is a
   member; with rooms it asks the room's member list. It MUST NOT grow a second
   membership store, which is precisely the design HIP-1252's Rationale rejects.
2. **An agent that joins a call is a participant with an identity and a seat.**
   `meet` stamps identity server-side and debits per seat. An agent listener is
   therefore a named participant and a billed one; there is no free silent
   observer, and a spec claiming otherwise would be claiming a `meet` that does
   not exist.
3. **The summary is a participant's work, not the token minter's.** Media rides
   browser-to-server and never passes through the API binary, so nothing in the
   join decision can see a word that was said. The path is: a recording
   participant receives the media, transcription runs over it, and the summary is
   posted into the room as ordinary envelopes — read in the conversation view,
   streamed into the work view. The recording half of that already exists
   (`apps/meet/record.go`, `apps/meet/egress.go`); transcription and the posting
   step do not (§13). Note that HIP-1252 §1 says recording "is either the media
   server's or nobody's" while `apps/meet` drives it; that is a drift between the
   spec and the code and it is HIP-1252's to resolve, not this HIP's to restate.

### §13 What is built, what is off, what is missing

Measured in `hanzoai/cloud`, `hanzoai/team`, `hanzoai/team-go` and `@hanzo/bot`
on 2026-08-27. A specification claiming built things that are not built is worse
than no specification, so each mechanism this HIP names carries its state and the
symbol that proves it.

| Mechanism | State | Evidence |
|---|---|---|
| Session tree — `rootSessionId`, `children`, the tree endpoint, `project`, `target` | **shipped** | `apps/agents/sessions.go:112,141,151,164`; `GET /v1/agents/sessions/:id/tree` (`sessions.go:329`), `sessions_store.go:331 ListTree` |
| Agents as room participants, mention detection, run-on-behalf | **off by default** | `apps/team/team.go:119` `TEAM_AGENTS_ENABLED`; `apps/team/chat.go:371 mentionsBot`; `apps/agents/onbehalf.go:34 RunOnBehalf`. The dial is necessary, not sufficient — the roster must also resolve (`apps/team/bots.go:152`) |
| Bot as a WORKSPACE member | **shipped** | `apps/team/bots.go:65 botMember`; reconciled on every transactor connect (`apps/team/transactor.go:150`) and by `POST /v1/team/bots/sync` |
| Bot as a ROOM member | **gap** | the only function that adds a bot to a room's members is `team/services/slack/pod-slack/src/botmembers.ts:138 addToSpace`, invoked only when an admin passes an explicit space |
| Slack transport — send, inbox, pairing | **shipped** | `apps/channels/slack.go:22`; `apps/channels/routes.go:73,74,96` |
| The inbox holds both halves of a conversation | **gap** | inbound writes `channel_inbox` (`apps/channels/ingest.go:78`), outbound writes `channel_send` (`store.go:126`); no read returns the sequence |
| A bridged sender resolved to a principal on the stored row | **gap** | `senderUser` is a live column and a published field that is never populated — no normalizer sets `Sender.UserID` (`apps/channels/{slack,discord,teams,telegram}.go`), asserted empty by `ingest_test.go:457`. The link IS resolved later, for the turn only |
| Echo suppression | **shipped** | `apps/integrations/slack_events.go:148,413,424`; `apps/team/chat.go:171` |
| Identity mapping, external account ↔ principal | **shipped, two designs** | sealed per user in the key store in cloud (`apps/integrations/channel.go:371 userLink`, not enumerable); a queryable table in `team-go` (`pkg/slack/installs.go:113`) |
| Meet join tokens | **shipped** | `POST /v1/meet/getToken` (`apps/meet/meet.go:350`), minted at `meet.go:784` |
| Call recording | **shipped** | `apps/meet/record.go`, `apps/meet/egress.go:234` |
| Call transcription, summary posted to a room | **gap** | no transcription anywhere in `apps/*`; no agent participant in a call |
| Correspondent room auto-created from an inbound message | **gap** | ingest writes rows, never a room; `team-go/pkg/slack/slack.go:242` returns when no mapping exists |
| Room creation bridged both directions | **gap** | only a hand-made mapping of two rooms that both already exist (`team-go/pkg/slack/slack.go:801 mapChannel`); neither leg creates one. Cloud has no equivalent |
| One room-creation choke point | **gap** | three unrelated paths — a REST create in `team-go`, the transactor `applyTx` (cloud's only path), and a mirror projection. Cloud has no server-side create at all. The nearest hook is where `apps/team/seed.go:70` already reacts to a channel create |
| The ambient agent added at creation | **gap** | follows from the line above. A mirrored room inherits bots incidentally, as workspace roster members, not by rule |
| Transports beyond the four | **gap in cloud, shipped in the bot** | `apps/channels/registry.go:76` is exactly four; `@hanzo/bot` speaks ~28 including whatsapp, imessage and signal |
| One responder | **gap** | two exist: `apps/channels/turn.go` and `apps/team`'s `runAgent` |
| One room store | **gap** | at least three conversation stores, no sync between them and no cross-imports: `apps/team/store.go` (per org+workspace), `apps/channels/store.go`, and the agent threads owned by the external `hanzoai/agent` module (`apps/agents/conversation.go`) |

Two corrections to beliefs that were in circulation while this was written, both
found by reading the source. The bot-member projection is **not** uncalled — it
reconciles on every transactor connect; what is uncalled is the *room*-level
projection, which is a different function in a different service. And
`senderUser` is not unpopulated on one path; it is unpopulated on **every** path,
by construction, because identity resolution was deliberately removed from
ingest.

### §14 Conformance

An implementation conforms when all of these hold:

1. One store answers "what was said in this room", holding both halves of the
   conversation, and no surface holds a second copy.
2. Org rooms and personal rooms are in different stores, not separated by a
   predicate.
3. Exactly one function creates a room, and default membership is applied there.
4. Exactly one responder decides whether a model answers a message.
5. Every bridge has all four properties of §7. A transport with three of them is
   not connected, and MUST NOT be listed as though it were.
6. Every stored message carries a resolved sender, or is refused. A member list
   over unresolved identifiers is not a member list.
7. A room's binding to a work object resolves through `todo`; no room row carries
   an issue's title, state or assignee.

## Rationale

The alternative is what exists: each surface owning its own conversation store
and a synchronizer between them. It is the obvious design, because each surface
can then ship alone, and it is wrong for a reason that shows up only later. Two
stores kept in step have two answers to "what was said", and they disagree under
exactly the conditions nobody tests — a partition, a redelivery, a message edited
on one side. One store with two views cannot have that class of bug at all,
because there is no second copy to disagree.

The alternative to one member model is a per-surface participant type, which is
how the estate got two responders. The moment "who may reply" is answered twice,
one of the answers is stale.

The alternative to naming the primitive `room` is to redefine `channel`, which
means renaming a field on a shipped envelope that every transport adapter reads,
plus amending two Draft HIPs. That may still be the right call — it is a
product-language decision, not a technical one — but it is a decision to take
deliberately, not a consequence of a specification quietly using a taken word.

## Security Considerations

**The scope line is the isolation boundary.** Org rooms and personal rooms in one
store make privacy a query predicate. Any defect in that predicate — a missing
clause, a join, an admin surface that forgets it — reads a person's direct
messages to their manager. Separate stores make the same defect impossible to
write.

**A bridge is an identity translator, and translators forge.** A bridged message
arrives claiming an external sender; the mapping in §7 turns that claim into a
member. An unverified mapping lets anyone who can post on the external network
speak in the room as a member. The mapping MUST be resolved by `integrations`,
which holds the link, and MUST NOT be inferred from a display name. Note that
this is not hypothetical today: the stored inbox row's `senderUser` is always
empty (§13), so anything that promotes a stored row to a member would be
promoting an unauthenticated external string.

**Auto-created rooms are an unauthenticated write.** §9 opens a room on a
stranger's message. Without the access decision it inherits from HIP-1066, that
is unbounded creation of named objects by anyone who can find the org's account
on any connected network.

**The ambient agent is a member of everything, which makes it the widest
principal in the estate.** It MUST hold only what a member holds. An agent that
reads across rooms because it is convenient is a cross-room read with a friendly
name, and in a bridged room the party on the other end is not an employee.

**Attribution is a security property, not a courtesy.** A message an agent sent
MUST be recorded as agent-sent. A room whose history cannot distinguish a
person's words from a model's words cannot be used as evidence of anything, which
is the whole reason to keep the history.

**Echo suppression is a safety limit, not tidiness.** Without it, an agent
answering a bridged room can answer its own relayed reply. Two such rooms bridged
to each other do it without stopping.

## References

- HIP-0026 — Identity & Access Management Standard
- HIP-0061 — Notification & Messaging Service Standard
- HIP-0139 — Capability
- HIP-0504 — Unified Cross-Platform Design System (one substrate, three hosts)
- HIP-0524 — The Personal Agent
- HIP-1048 — Team
- HIP-1065 — Connectors — A User's Own Credentials
- HIP-1066 — Channels — One Inbox (the envelope, the transport registry, the gate)
- HIP-1069 — Tel — Numbers, Calls and Messages
- HIP-1107 — Bot — A Run on a Surface
- HIP-1146 — Sandbox — A Lease on Isolated Compute
- HIP-1153 — Social — Publishing to Connected Channels
- HIP-1160 — Todo — The Work Item Board
- HIP-1210 — Agents — Define, Run, Keep the Run
- HIP-1250 — Integrations — The Connection Registry
- HIP-1252 — Meet — The Join Decision

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
