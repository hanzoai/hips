---
hip: 0524
title: The Personal Agent — What It May Send Without You
author: Hanzo AI
type: Standards Track
category: Core
status: Draft
created: 2026-08-27
requires: HIP-0026, HIP-0523, HIP-1041, HIP-1210
---

# HIP-0524: The Personal Agent — What It May Send Without You

## Abstract

Every person gets one agent of their own, made when their account is, keyed to
them and not only to their employer. It reads what they read, learns how they
work, and drafts what they would have written.

Whether it may actually send anything is a separate question with three answers,
chosen by that person and by nobody else. At `draft` it writes and the person
sends. At `confirm` it asks first and sends what the person picks. At `send` it
tells the person what it is about to do, waits a chosen interval, and sends if
they say nothing.

This HIP specifies the one agent per person, the key it is stored under, the
three levels and where each applies, what a waiting window means, and the rule
that every message a machine sent says so. It composes HIP-0523's rooms,
HIP-1210's agents and HIP-1141's per-person settings, and §12 lists the four
things it asks of other specifications rather than deciding on their behalf.
§11 marks each mechanism as shipped, partial or absent, measured in the source
on 2026-08-27.

## Motivation

The goal is that a person can set up, configure and then stop doing almost all of
their own routine work — not by writing automations, but by having an agent that
already knows how they answer and is allowed, to whatever degree they choose, to
answer that way. `hanzo.ai` and `hanzo.team` are two faces of one cloud, so the
agent that drafts a reply in one is the same agent, with the same memory of that
person, in the other.

The reason this needs a specification rather than a feature is that the
interesting part is not the drafting. It is the authority. An agent that can
never send is a toy; an agent that always sends is a liability, and the estate
has no way to express anything in between: there is no autonomy setting anywhere
in the cloud today. The nearest things are a tool list, which says what an agent
may call, and a channel policy, which says who may talk to it. Neither answers
"how much may this act without me", so the answer is hard-coded per subsystem and
is always one of the two extremes.

Getting that wrong is not a bug that shows up in a test. It shows up as a message
a customer received, in a person's name, that the person never saw.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted
as in RFC 2119.

### §1 One per person

Every human principal has exactly one personal agent. It is created when the
account is, not on request, and a person MUST NOT have two.

One is a deliberate number. Two would immediately need a rule for which one
answers, which is the same defect HIP-0523 §10 records for the org's responders,
and a person who wants specialized behaviour gets it from the agent's
instructions rather than from a second agent with a second authority setting.

An org's ambient agent (HIP-0523 §10) and a person's agent are different objects,
and neither is the other's fallback:

| | Ambient agent | Personal agent |
|---|---|---|
| Belongs to | the org | one person |
| Is a member of | every room in the org | that person's rooms |
| Answers | what is addressed to the org | what is addressed to the person |
| Configured by | an org admin | that person, and only that person |
| Authority to send | org policy | the ladder in §4 |

**Provisioning is free; running is not.** Creating the agent costs nothing and
MUST NOT require a balance. Every run it performs is metered exactly as HIP-1210
meters any run, against the org. There is no signup grant in this estate
(HIP-1045), so "everyone has an agent" means everyone has one that is ready, not
that anyone has free inference.

### §2 The key is the pair, and there is no org-less person

The personal agent is stored under the **(org, user) pair as the row key** — not
under a user column filtered at read time.

The distinction is the whole of the isolation property, and HIP-1065 already
argued it for credentials: a pair-keyed row means a lookup that omits the user
finds no row and answers 404, whereas a filter is a clause every future query
must remember, and the query that forgets returns a colleague's. That reasoning
transfers unchanged; it is not restated here.

**There is no personal scope outside an org.** HIP-0118 records that a consumer
which cannot resolve the org and falls back to a `"personal"` or empty tenant has
merged every unscoped request into one tenant, and calls it a reportable
isolation defect. Nothing in this HIP creates such a fallback: the org is
resolved first, from the validated principal, exactly as it is everywhere else,
and the user narrows it. A principal with no org gets no personal agent, and that
is a refusal rather than a default.

Within that key, the agent's instructions, its memory and its authority setting
are the person's own. An org admin MAY see that a person has an agent, because
the org pays for what it runs. An org admin MUST NOT read its instructions, its
memory, or the contents of the rooms it works in. Paying for a thing does not
confer the right to read it — the org pays for the person's mailbox too.

### §3 What it is made of

A personal agent is HIP-1210's agent — a model, instructions and a set of tool
names — plus per-person inputs it MUST read and MUST NOT hold its own copy of:
settings from `pref` (HIP-1141), which is already one document per person, and
presentation from `appearance` (HIP-1040) and `avatar` (HIP-1042).

An agent that keeps its own copy of a preference is a second answer to what the
person wants, and the copy will be the stale one.

**Memory is an open question this HIP does not close.** HIP-1260's founding
property is that human wiki and agent memory are one org-scoped store, indexed
once, "so an agent retrieves exactly what the team can read", and it forbids a
capability from opening a store of its own. A personal agent that remembers a
person's own things has memory the team cannot read, which is the inverse of that
property. This HIP does not resolve it unilaterally; see §12.

### §4 The ladder

The authority setting has exactly three values. Each names what the agent does on
its own initiative; what remains is the person's act.

| Level | The agent | The person | Default |
|---|---|---|---|
| `draft` | writes a reply, a summary, a suggestion, and stops | reads it, edits it, sends it | **yes** |
| `confirm` | prepares one or more replies and asks which | picks one, or edits, or declines | opt in |
| `send` | announces what it will send, waits (§5), then sends | may change or stop it during the wait | opt in, explicitly |

**The ladder is not a role and it is not a grant.** HIP-1041 closes the role
vocabulary at three and states that narrower authority is a narrower grant with a
smaller scope and a set expiry, never a separate mechanism. This ladder does not
enter that calculus at all: it is a policy about **whether to ask a person**,
evaluated BEFORE the authorization check, and an agent at `send` that lacks the
grant is refused exactly as it would be at `draft`. Nothing here widens what an
agent may do; it only decides who presses the button on the things it could
already do.

Three rules bind the ladder, and an implementation that breaks any of them is not
implementing this HIP:

1. **`draft` is the default for every person and every scope.** A person who has
   never opened a setting has an agent that cannot send. New scopes — a newly
   connected transport, a new room — start at `draft` too. A default that
   escalates is not a default.
2. **Escalation is always the person's own act.** No admin, no org policy and no
   agent MAY raise a person's level; an agent MUST NOT be able to reach the
   setting that governs it. An org MAY set a CEILING no person may exceed; a
   ceiling only lowers. This ladder is also strictly BELOW the operator's: where
   a deployment has not wired a responder at all, HIP-1048 §6 guarantees the
   binary is provably inert, and no per-person setting may route around that.
3. **`send` is never reached by accident.** Choosing it is a separate act from
   choosing `confirm`, and the interface MUST state plainly what it means: that
   messages will go out in the person's name while they are not looking.

At `confirm`, declining is a first-class outcome and MUST be as easy as
accepting. A confirmation with one button is a `send` level wearing a costume.

### §5 The window

At `send`, the agent does not act immediately unless told to. It notifies the
person, starts a window, and sends at the end of it if nothing has happened. The
choices are `instant`, `1m`, `5m`, `15m`, `1h`; `instant` means no window.

Semantics, exactly:

- The notification goes out FIRST, and the window starts after it is delivered.
  A window that starts before the person could have been told is not a window.
- During the window the person may edit the message, replace it, or stop it. Any
  of the three cancels the send.
- Silence at the end of the window is consent, and this is the only place in this
  specification where silence means anything.
- The notification and the eventual message are both written into the room's
  history. A person MUST be able to read back, later, both what they were told
  and what went out. Nothing about this is hidden from the person it acts for.

The window exists so a person can pick their own responsiveness — a short one
while working, a long one while away, `instant` for a correspondent they trust.

**A window shorter than the implementation's own timing resolution is a lie and
MUST NOT be offered.** The only deferred-execution pattern in this cloud today is
a due-time row swept by a cron (§11), and a sweep every minute cannot honour a
one-minute window. Either the sweep is finer than the smallest offered window, or
the smallest window comes off the list.

**The timer is a durable schedule on the one engine.** HIP-1062 states that the
binary embeds exactly one task engine and that a subsystem MUST NOT create
another; a second timer wheel for this would be that. And a send that fires on a
timer is a flow that runs with nobody there, which is HIP-1063's own definition
of `auto` — so the amplification ceilings HIP-1063 §7 places on such flows apply
here by the same argument. An agent replying on a timer across a connected
transport is cheap fan-out with a customer's credential on the far end, and it
inherits those bounds rather than needing new ones.

### §6 The confirmation rides the person's own rooms

The agent asks on whatever the person is already reading: their `hanzo.ai` chat,
their room in `hanzo.team`, or the transport they are actually on. It is one
question in a room, not a queue somewhere they must remember to visit.

This has a mechanical consequence that decides the design. **Asking requires a
path that can carry the answer BACK.** The notification capability sends email
and SMS and has no inbound half at all — HIP-0061 deliberately dropped push,
in-app delivery and preference management, and what remains cannot hear a reply.
The rooms of HIP-0523 have both directions by construction. So the confirmation
MUST ride a room, and MUST NOT be built on a send-only notifier with a link out
to a web page, which is the design that looks equivalent and is not.

### §7 Attribution

**Every message an agent sends MUST record that an agent sent it, and on whose
behalf.** HIP-0523 already requires the first half and gives the reason: a
history that cannot distinguish a person's words from a model's words is not
evidence of anything. This HIP adds the second half — the person the agent acted
for — because "a machine wrote it" and "a machine wrote it as me" are different
facts and only the second one lets a person disown a message.

Three obligations follow:

1. The stored message carries the authoring kind and, when an agent, the person
   it acted for. Both are set by the server at the moment of sending and MUST NOT
   be decodable from a client's request body. HIP-1066's send route refuses
   client-supplied identity fields with a strict decode, deliberately and under
   test, precisely so a caller cannot assert who a message is from; that refusal
   stands. The on-behalf fact is derived from the credential the agent holds, not
   from what it says about itself.
2. The message is stored, not only transmitted. An agent reply that is sent and
   forgotten leaves no trail at all, which is today's behaviour (§11).
3. The person's name may appear as the sender on an outside network that has no
   way to show anything else. That is a rendering limit, not permission to
   discard the fact internally — our record MUST still say a machine wrote it.

There is no level at which an agent sends anonymously or as the person without
record. `send` is authority, never disguise.

### §8 Where a level applies

The setting is a global default per person, with narrower overrides. The
effective level is the most specific one set:

```
    room override        →  most specific
    transport override
    global default       →  least specific, defaults to `draft`
```

An unset override inherits; it does not reset to the default. Overrides only
resolve — they never combine — so there is exactly one effective answer per room
and no order-of-evaluation question to get wrong. An org ceiling (§4) applies
after resolution and can only lower the result.

**No level applies to first contact.** HIP-0523 §10 requires that the first
message from an outside person is answered by a human, and what an agent may
replay without review is recurrence — an answer a person already approved, asked
again. A person's ladder decides whether their own agent may replay it without
asking them again. It never converts a first contact into an automatic one.

### §9 Dropping a level is immediate

A person MAY lower their level, globally or anywhere, at any time, and it takes
effect at once. Lowering it MUST cancel every window currently open under the old
level. A pending send that survives the revocation of the authority that created
it is precisely the message the person was trying to stop.

Lowering MUST NOT require an admin, a support request, or a confirmation of its
own.

### §10 Where it meets the org's agent

Both may be members of one room (HIP-0523 §3). They do not race, because they
answer different things: the org's agent answers what is addressed to the org,
and the person's agent answers what is addressed to that person. A message
addressed to neither is answered by neither.

Where HIP-0523 §10's human-first rule and this ladder meet, the stricter one
governs.

### §11 What is built, what is off, what is missing

Measured in `hanzoai/cloud` on 2026-08-27. The personal agent itself is
net-new — there is no per-user agent in the estate — but most of what it stands
on exists, and two of the pieces that look ready are not.

| Mechanism | State | Evidence |
|---|---|---|
| Per-user agent | **gap** | `apps/agents/store.go:38 Agent` has no user field; the unique index is `(org, name)` (`store.go:140`); the store is one file per org (`apps/agents/tenancy.go:44`) |
| A run attributable to a person | **shipped** | `apps/agents/store.go:89 Run.Actor`, `apps/agents/sessions_store.go:142`; the nearest existing hook |
| Automatic provisioning | **partial, and per-org only** | `agents.SeedPersonalities(ctx, org)` (`apps/agents/personalities.go:79`) runs on every login from `apps/team/account.go:539` and is idempotent. It seeds an ORG's agents; nothing is seeded per person |
| Per-person settings store | **shipped** | `apps/pref/store.go:62` `prefs(subject, doc, updated_at)`, `GET`/`PATCH /v1/pref`. An opaque JSON document, so the setting needs no migration |
| …readable from an agent turn | **gap** | `apps/pref/prefs.go:186` resolves the subject from an HTTP request and fails closed without one; a turn runs on a detached context (`apps/channels/turn.go:211`). The store that must hold the setting cannot be read by the code that must honour it |
| Send-on-behalf | **not what the name says** | `apps/agents/onbehalf.go:34 RunOnBehalf` sets the billing and audit actor on a run record (`:102`). It sets no identity on any outbound message |
| Authorship on a message | **gap, and deliberately closed** | `apps/channels/envelope.go:53 Sender` has no agent/human field; `SendRequest` has no sender at all; identity fields are non-decodable on send and refused loudly (`apps/channels/routes.go:83`) |
| The agent's reply stored | **gap** | `apps/channels/turn.go:185` sends with no store call; `insertInbox` has one caller, the inbound branch (`ingest.go:78`). `apps/agents/onbehalf_rpc.go:87 transcript()` exists because the answering side has no record of what it said |
| Notifying one person and hearing back | **gap** | `apps/notify` sends email and SMS only, addressed by raw address string, with no inbound path (`apps/notify/notify.go:131`, `send.go:30`). It cannot carry an answer back — which is why §6 requires a room |
| A cancellable timer | **partial** | The pattern works, in one place: a due-time column, a one-minute sweep, and a cancel guarded on `(org, status)` — `apps/marketing/sequences.go:151,380`, `apps/marketing/drip.go:147`. It sends marketing email; it is not a primitive anyone else can call |
| A one-shot durable timer | **gap** | `ScheduleSpec` offers only `CronString` and `Interval` — no "run once at T" — and `workflow.Sleep` has no caller in cloud |
| Cancelling a durable agent task | **unwired** | `apps/agents/agents.go:477` hard-codes `disabledTaskController{}`; no operator dial turns it on, and a live consumer sits at `apps/agents/sessions_typed.go:256` |
| Wait-for-approval | **shipped, without a timeout** | `apps/auto/engine.go:120` blocks on a signal channel with no selector and no timer, so "proceed anyway after N minutes" is not expressible there |
| The `approval` action on a message | **a renderer, not a mechanism** | `apps/channels/envelope.go:92 Approval{ID}`, validated only as non-empty and rendered as text (`envelope.go:263`). No store, no route, no resolution |
| An authority or autonomy setting | **gap** | Nothing in `apps/` models how much an agent may do without a person. `Agent.Tools` is a capability grant; `channel_policy` is who may talk to it; neither is this |

The shortest honest order of work: make the agent row's key the (org, user) pair,
seeded beside the org personalities that already seed on login; put the level in
the `pref` document the person already has, and give `pref` a background-safe
read; add the authoring fields to the envelope, set server-side, and finally
write the agent's reply to the store; then build the window on the
due-time-and-sweep pattern that already works, with the sweep made finer than the
smallest window offered.

### §12 What this asks of other specifications

Four things this HIP needs are owned elsewhere. Each is named here as a request,
not decided here as a fact:

1. **HIP-1066** — the on-behalf principal is a new tagged member on the
   envelope's sender union. That union is closed by design, and HIP-1066's own
   rule is that a new concept adds a tagged member rather than overloading an
   existing one. This HIP proposes the member; HIP-1066 owns whether it lands.
2. **HIP-1103** — the audit record carries one actor, populated from the
   validated principal. An agent acting for a person is two principals, and with
   one field the trail records that the person did it. Either the record grows a
   second field or the distinction is lost in the compliance trail; that is
   HIP-1103's call.
3. **HIP-0519** — the identity header set is nine, closed, and Active, and a
   partial set is a defect. The on-behalf fact therefore rides the message
   envelope and NOT a tenth header. If a downstream service must see it in the
   identity set, that is an amendment to an Active HIP and needs its own change.
4. **HIP-1260** — agent memory is one org-scoped store by that HIP's founding
   property, and it forbids a second store. Personal memory does not fit as
   written. Note also that HIP-1211 already calls `/v1/ai/memory` "per-user
   memories" while tenanting by org; that inconsistency predates this HIP and
   should be resolved with it rather than inherited.

### §13 Conformance

An implementation conforms when all of these hold:

1. Every human principal in an org has exactly one personal agent, and no path
   creates a second.
2. The row key is the (org, user) pair; no read resolves an agent by org alone
   and filters afterwards.
3. The default level is `draft`, everywhere, including for scopes that did not
   exist when the person last looked.
4. No principal other than the person can raise that person's level, the agent
   cannot reach its own setting, and an org ceiling can only lower it.
5. Every stored message carries its authoring kind, set by the server, and every
   agent-sent message is stored.
6. A confirmation is asked on a path that can carry the answer back.
7. Lowering a level cancels every window open under the old one.
8. No offered window is shorter than the implementation's own timing resolution,
   and no window runs on a second task engine.

## Rationale

The alternative to a ladder is a switch: the agent replies, or it does not. It is
simpler, it is what everything in the estate does today, and it fails because the
two settings are both right in different rooms on the same afternoon. A person
will happily let an agent answer a recurring question from a known correspondent
and will not let it answer their co-founder. With one switch they must pick the
stricter setting and hand-write everything, which is the outcome where the agent
is a toy.

The alternative to a waiting window is a confirmation for every message. That is
`confirm`, and it stays, because for many people it is the right level forever.
The window exists for the case `confirm` handles badly: a person who is away, who
wants the work done, and who wants a chance to stop it if they happen to look.

**Silence-is-consent deserves its own argument, because nothing else in this
corpus works that way.** Everywhere else, an unanswered question blocks — a
paused flow waits for a resume that may never come. Blocking is the right default
when the cost of acting wrongly exceeds the cost of not acting, and for a
signature, a payment or a deploy it plainly does. For a reply to a message it
plainly does not: the cost of not answering is the thing the person was trying to
avoid, and a draft that waits forever is a draft nobody sent. So the window is
narrow on purpose. It applies to one act, sending a message; it never applies to
first contact; it is opt-in per person; its length is chosen by the person who
bears the consequence; and it is visible to them before and after. Those five
limits are what make it consent rather than a shrug, and an implementation that
drops any of them has built something else.

It does not relocate responsibility. A person who sets `send` is answerable for
what their agent sends, exactly as they are for a filter they wrote. What the
window buys is that they can see it happen and stop it, which a filter never
offered.

The alternative to one agent per person is a fleet, which is more flexible and
needs a rule for which one answers. That rule is the thing this HIP exists to
avoid re-deriving in every subsystem.

## Security Considerations

**Escalation is the whole attack.** Everything dangerous here is one principal
raising another's level. Any surface that writes the setting MUST verify the
subject is the caller, and an org-scoped admin path that can write a member's
authority is a mechanism for sending mail as an employee. There is no legitimate
reason for one to exist; a ceiling that only lowers covers the real
administrative need. The agent MUST NOT be able to reach the setting either — an
agent that can raise its own authority has none.

**A window is a period during which a message exists and has not been reviewed.**
Its length is the exposure. `instant` has no exposure and no protection; a person
choosing it is choosing that, and the interface MUST say so.

**Cancellation must be stronger than delivery.** If revoking authority leaves a
scheduled send in place, revocation does not work at the moment it matters most,
which is always immediately after something went wrong.

**Attribution defends the person, not the platform.** Without a durable record of
which messages a machine wrote, a person cannot disown one and an organisation
cannot answer a regulator. This is why §7 requires the record even where an
outside network renders the person's name — and why §12 asks HIP-1103 whether a
one-actor audit row can carry a two-principal fact, rather than assuming it can.

**The personal scope is a boundary between an employee and their employer.** The
agent reads the person's rooms, so anything that can read the agent — its memory,
its instructions, its transcript — reads those rooms. An admin console that
renders a member's agent for support purposes is a manager reading direct
messages, however it is labelled.

**Prompt content is untrusted input, and at `send` it reaches the outside
unreviewed.** A message from a stranger becomes text a model reads and answers
with no person in between. The agent MUST hold only what its member holds
(HIP-0523 §10) — the room it is in, and no other — because at `send` the blast
radius of a successful injection is exactly the agent's reach.

## References

- HIP-0026 — Identity & Access Management Standard
- HIP-0061 — Notification & Messaging Service Standard
- HIP-0111 — Hanzo IAM Authentication Standard (token exchange)
- HIP-0118 — SuperAdmin & Tenant Isolation Model
- HIP-0523 — Rooms — One Store, Two Views, Many Bridges
- HIP-0903 — The Agentic Company (the autonomy dial, and why guards do not move responsibility)
- HIP-1040 — Appearance
- HIP-1041 — Authz (three roles, closed; a delegation is a narrower grant)
- HIP-1042 — Avatar
- HIP-1045 — Orgs (no signup grant)
- HIP-1048 — Team (the operator's opt-in, above this ladder)
- HIP-1062 — Tasks — The Durable Run (one engine)
- HIP-1063 — Auto — Flows That Run Themselves (amplification ceilings)
- HIP-1065 — Connectors — A User's Own Credentials (the pair is the key)
- HIP-1066 — Channels — One Inbox (the envelope, and the strict send decode)
- HIP-1103 — Audit — The Tamper-Evident Trail
- HIP-1141 — Pref — One Document Per Person
- HIP-1210 — Agents — Define, Run, Keep the Run
- HIP-1260 — Knowledge — Wiki and Agent Memory

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
