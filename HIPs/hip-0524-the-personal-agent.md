---
hip: 0524
title: The Personal Agent — What It May Send Without You
author: Hanzo AI
type: Standards Track
category: Core
status: Final
implementation-go: partial
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

It also specifies what the agent IS, separately from what it may do. An agent
wears a persona — a named expert identity and its instructions, cut from a
library — and a person's agent is the one whose persona is derived from that
person rather than picked from the shelf. The persona is who it is; the ladder is
what it may do; the two never mix.

This HIP specifies the one agent per person, the key it is stored under, the
persona it wears, the three levels and where each applies, what a waiting window
means, the personal phone, email and WhatsApp line it answers on, where a person
configures it, how capacity and runtime are billed, and the rule that every
message a machine sent says so. It composes
HIP-0523's rooms, HIP-1210's agents and HIP-1141's per-person settings, and §15
lists the five things it asks of other specifications rather than deciding on
their behalf. §14 marks each mechanism as shipped, partial or absent, measured in
the source on 2026-08-27.

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

**Provisioning is free; running is not.** The free plan carries capacity for the
one agent this section requires (§13), so creating the agent costs nothing and
MUST NOT require a balance. Every hour it runs meters at the one rate. "Everyone
has an agent" means everyone has one that is ready — granted capacity, not free
running time.

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

**The org in that pair is the person's HOME org** — the owner half of their id,
which is an org by construction (HIP-0026), and which HIP-0523 §5 makes the
address of their personal scope. So one human may belong to many orgs and has
exactly ONE personal agent: the one bound to them in their home org. An
employer's org has its own ambient agent (§1) and never a second personal one.

Two facts about how that org comes to exist are worth stating, because a
specification that assumed the simpler one would be wrong. **A home org always
resolves**, because it is a half of the id rather than a row that might be
missing. **A chartered org — created at signup with the person as founder — is
conditional**, happening only when the application signed up through is
configured for it; through an application that is not, the person lands in that
application's org and the charter is onboarding's job (§14). This HIP depends
only on the first, which is why it says home and not founder.

This is what keeps "personal" from becoming a flag. A work org cannot host a
user-bound agent, so there is no row anywhere whose privacy depends on being
read with the right filter — the wrong org simply has no such row.

Within that key, the agent's instructions, its memory and its authority setting
are the person's own. An org admin MAY see that a person has an agent, because
the org pays for what it runs. An org admin MUST NOT read its instructions, its
memory, or the contents of the rooms it works in. Paying for a thing does not
confer the right to read it — the org pays for the person's mailbox too.

### §3 The persona is who it is

An agent wears a **persona**: a named identity giving it a voice and a remit.
It is a value, not a subsystem:

```
    persona = { name, description, instructions, capability defaults }
```

`name` is the handle a person addresses — `@cto`, `@dev`, `@des`. `instructions`
are the system prompt that makes it that expert. `capability defaults` are the
tools the job comes with, which a researcher and a marketer do not share.

Personas come from a library. The platform ships presets; an org MAY add its own,
and an org preset with a platform preset's name shadows it for that org alone.
**Creating an agent from a persona is one operation**, not a copy-and-edit ritual
— that operation is `agents`' to serve, and §15 asks HIP-1210 for it.

**A persona says who an agent is. It never says what it may do without a
person.** These are orthogonal and MUST stay so:

| | Answers | Set by | Specified in |
|---|---|---|---|
| persona | who is this — voice, remit, tools it comes with | picked from the library | this section |
| ladder (§4) | may it send without me | the person, and only them | §4 |

A persona's `capability defaults` are HIP-1041 grants — what the agent may call.
They are NOT an authority level. **A persona MUST NOT carry, imply or default a
ladder level**, because a preset that shipped `send` would raise a person's
authority without that person's act, which §4's second rule forbids. A newly
created agent, from any persona, starts at `draft`.

**The personal agent is the user-bound agent, and its persona is the person's
own.** Where a library persona is a job, a person's persona is that person: their
instructions, their customizations, how they answer. It derives from the
per-person inputs the agent MUST read and MUST NOT copy — settings from `pref`
(HIP-1141), which is already one document per person, and presentation from
`appearance` (HIP-1040) and `avatar` (HIP-1042). An agent that keeps its own copy
of a preference is a second answer to what the person wants, and the copy will be
the stale one.

So a person's agent is not a fourth kind of thing. It is the same object as
`@cto` and `@des`, cut from a persona that happens to be derived rather than
picked, bound to a user by the key of §2.

One naming point, since the code already has both words: the shipped struct is
`persona` and the shipped list is `personalities` (`apps/agents/personalities.go`).
That is one concept wearing two names, and the noun is **persona**.

**Memory is an open question this HIP does not close.** HIP-1260's founding
property is that human wiki and agent memory are one org-scoped store, indexed
once, "so an agent retrieves exactly what the team can read", and it forbids a
capability from opening a store of its own. A personal agent that remembers a
person's own things has memory the team cannot read, which is the inverse of that
property. This HIP does not resolve it unilaterally; see §15.

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
a due-time row swept by a cron (§14), and a sweep every minute cannot honour a
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
   forgotten leaves no trail at all, which is today's behaviour (§14).
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

### §11 The personal line

A person may connect their own phone number, their own email and their own
WhatsApp, and the free plan includes doing so (§13). Inbound on any of them lands
in that person's rooms — their own org's, per §2 and HIP-0523 §5 — and their
agent answers under the ladder. Nothing about this is an org integration: the
line is the person's, connected as a per-person credential (HIP-1065), and an org
admin MUST NOT connect, read or disconnect a member's personal line.

This is where the ladder stops being abstract. The same arriving text, at each
level:

| Level | What happens when a text arrives |
|---|---|
| `draft` | the room holds it; the agent writes a reply; the person sends it |
| `confirm` | the agent writes the reply and asks in the room; the person picks, edits or declines; the chosen text leaves as an SMS from their number |
| `send` | the agent posts what it is about to text, waits the person's window (§5), and sends unless they intervene |

**A live call has no window, so `confirm` and `draft` behave identically on
it — the agent does not speak.** There is no pause in a ringing call in which to
ask a person and wait for an answer, so only `send` lets an agent take a call at
all. An implementation MUST NOT invent a shortened window for voice: a person who
chose `confirm` chose to be asked, and being asked is impossible here.

The reply leaves as the person, from the person's own number, which is precisely
why §7's attribution obligation is load-bearing rather than bookkeeping. The
recipient sees a text from a human being. Our record MUST say a machine wrote it.

**"Connecting your number" is three different mechanisms and they are not
interchangeable.** Saying so plainly is the difference between a specification
and a brochure:

| Route | What it means | Honest cost |
|---|---|---|
| A number we provide | rented from a carrier; we own the route | least work — and it is a NEW number, not the one on the person's card |
| The person's number, forwarded | their carrier sends us what arrives | ordinary carrier feature for VOICE; carries no SMS |
| The person's number, ported | the number's routing moves to our carrier account | the only route that genuinely moves SMS; a multi-day carrier workflow with documents and per-country rules, not a code change |
| A relay on the person's device | software holding their own logged-in account | how WhatsApp and iMessage are actually reached; needs the person's machine, or a Mac |

**Forwarding does not carry SMS**, and the asymmetry has to be said out loud
rather than papered over. A person can forward their calls today from their
handset; they cannot forward their texts. So "connect your phone and we answer
your texts" is a promise about a ported or a provided number, and a specification
that blurs the two is selling something the carriers do not sell.

The fourth row is where "your own number" is already literally true, and it is
worth knowing which is which: WhatsApp is reached by linking the person's own
account the way a desktop client does, and iMessage by a relay on Apple hardware.
Both are the person's real identity to their correspondents. Neither is an API
we call, so both carry the failure modes of a logged-in session rather than of a
credential. §14 records what exists and where it runs.

### §12 Where the agent is configured, and the product words

At the product layer `hanzo.ai` shows a customize directory — **Apps · Channels ·
Plugins · Skills** — for how a person shapes their experience. A connected
external service is an **App** there.

**The personal agent is not in that directory.** An App is something a person
connects; their agent is not a connection, it is them. It is configured under
their personal preferences: who it is (§3), what it may send (§4), the window it
waits (§5), and the lines it answers on (§11). Putting it in a directory of
external services would file the one thing customized TO the person among the
things customized BY connecting somebody else's.

The same two-layer rule as HIP-0523 §1 applies, and for the same reason: **"App"
is the product word; the wire and the specification keep their shipped nouns.**
`/v1/integrations` and `/v1/integrations/connectors` do not move, and this HIP
renames nothing. In the specification the umbrella noun stays **Integration**,
with the kinds HIP-0126 §2 fixed — Connector, Provider, Tool — and "Connector"
remains, in that HIP's words, "the ONE Hanzo term".

The care matters because "app" is not carrying one spare meaning. It is carrying
six, all shipped:

| Sense | What it means | Owner |
|---|---|---|
| `apps/<name>` | a capability — a Go package in `hanzoai/cloud` serving one `/v1/<name>` | HIP-0139 |
| `x-app` | the extension naming the serving capability — 2,341 occurrences, and the only `x-` key with a Go field behind it | HIP-0139 §4.1, HIP-0106 §13.2 |
| `zip.App` | the server object every service and every plugin composes over | HIP-0122 |
| an IAM application | a registered OIDC client under `<org>-<app>` | HIP-0026, HIP-0111 §3 |
| a platform application | a deployed container, at `/v1/platform/apps` | HIP-1230 |
| a frontend app | a human-facing site in the per-org apps organization | HIP-0115 |

Three consequences follow, and the third is unresolved:

1. **The rule that keeps this safe is a prohibition, not a preference.** "App"
   MUST NOT appear as a noun in any route, package name, schema field, or
   normative sentence. Confined to the product surface it renames nothing, and
   HIP-0126 §8.4 — "never name one axis with the other's word" — is left intact,
   because no axis in the specification is renamed. Carried back into the spec it
   breaks that rule immediately, since `app` is the host-composition axis word.
2. **The direction is inverted from IAM's sense.** An IAM application is a client
   WE register so it can authenticate OUR users; an App is a credential we hold
   for somebody else's service. Anyone reading both in one paragraph will get it
   backwards, which is why the prohibition above is worth enforcing rather than
   trusting to context.
3. **"Apps" is already a live product label meaning the opposite of this one, and
   that collision is NOT resolved here.** The shipped commerce catalogue has a
   category `Apps` holding eight FIRST-PARTY Hanzo products — Chat, Bot, Search,
   Crawl, Studio, Console, Referrals, Marketplace
   (`commerce/models/catalogentry/seed/hanzo-catalog.json`). Both that label and
   this directory are product-facing, so the two-layer rule cannot separate them:
   one word would mean Hanzo Chat in the catalogue and Slack in the directory.
   One of the two has to give, and which one is a product decision this HIP
   records rather than takes.

**One more product word, recorded here for the same reason: agentic coding is
"Dev", and "Code" never names it.** The offering is Hanzo Dev — the command-line
tool, and the same thing in the cloud at `hanzo.ai/dev`. The wire keeps its own
nouns as always. `/v1/code` is the code INDEX — search and symbols over a
repository (HIP-1114) — which is genuinely about code and is not the product;
the agentic run itself answers at `/v1/agents/coding`, under the capability
HIP-0139's fold put it in. A pane showing source files may still be labelled
Code, because that label names what is on the screen rather than what is being
sold.

The prohibition is the one above, unchanged: "Dev" is what a person calls the
product, and it MUST NOT become a route, a package name or a schema field.

A reader should also know the family the word "app" is joining is not tidy yet.
"Provider" already means two things — an AI provider in HIP-0126 §3, the external
service being connected to in HIP-1250 — and "Connector" already means two, a
catalogue entry in HIP-0126 and a per-user credential row in HIP-1065. Four paths
serve the same family today: `/v1/integrations`, `/v1/integrations/connectors`,
`/v1/connectors`, and `/v1/automations/connectors`. Adding a product word on top
of that is safe only while the prohibition in point 1 holds.

### §13 The roster is the capacity, the runtime is the bill

Two questions that look like one, and the whole model is keeping them apart.
**How many agents may an org have** is a capacity limit its plan carries. **What
does an org pay** is a function of how long those agents actually ran. A capacity
limit refuses; a meter bills. Neither may quietly do the other's job.

The kinds are still the member kinds of HIP-0523 §3 — human, agent, bot —
because what an org counts is who is in its rooms. What changed is that counting
is no longer charging.

The shape, which is all this HIP fixes:

- A plan carries an ALLOWANCE of agents and of bots, as capacity limits. They
  cap what may EXIST. They are not a per-head price.
- Agent runtime is metered at ONE hourly rate, whatever the agent is doing.
  Agentic coding, a chat session, and a resident bot that never sleeps are the
  same meter. A bot costs more because it runs continuously, not because it is a
  different kind of thing being charged differently.
- There are no per-kind add-on rates, because there are no seats to buy. Wanting
  more capacity than a plan carries is a plan change.
- The free plan carries capacity for the one personal agent of §1 and includes
  the personal line of §11.

**A bot "included" in a plan is capacity, not free running time.** A catalog
entry granting one bot grants the right to HAVE one; its hours meter like any
other. This is the reading that cannot lose money by accident — the alternative,
where an included bot runs continuously at no charge, is an unbounded cost
sitting behind a fixed price.

**The numbers live in one place and this HIP does not copy them.** Plan limits
and the hourly rate are catalog data in `@hanzo/plans` — authored JSON, embedded
as a Go module, normalized to a flat namespaced dictionary, and read by the cloud
through that one package rather than reimplemented. The rate has one home,
`seats.json` `runtime.agentHourUSD`; the capacity limits sit beside it. HIP-1181
and HIP-1202 own both. A table of prices here would be a second copy that drifts
the first time one changes, and the drift would be invisible because both copies
would look authoritative. Read the catalog.

That rule is why the repricing which dissolved the seat model cost this section a
paragraph rather than a correction: there was never a number here to be wrong.

One fact about today's billing bears on this shape, and §14 records it rather
than letting the section imply otherwise. Where a plan still charges per head,
the count it charges is a quantity the CALLER supplies, and nothing joins it to
the roster the deployment independently counts. The reprice sharpens that instead
of settling it: capacity is now the thing a limit has to enforce, and a limit
enforced against a self-reported number is not enforced.

This settles what §1 leaves open, and the reprice makes it exact rather than
approximate. **"Provisioning is free; running is not" is now the literal billing
model.** Creating an agent costs nothing at any tier, every hour it runs meters
at the one rate, and an org that wants more agents than its plan admits changes
plan.

### §14 What is built, what is off, what is missing

Measured in `hanzoai/cloud` on 2026-08-27. The personal agent itself is
net-new — there is no per-user agent in the estate — but most of what it stands
on exists, and two of the pieces that look ready are not.

| Mechanism | State | Evidence |
|---|---|---|
| Per-user agent | **gap** | `apps/agents/store.go:38 Agent` has no user field; the unique index is `(org, name)` (`store.go:140`); the store is one file per org (`apps/agents/tenancy.go:44`) |
| A run attributable to a person | **shipped** | `apps/agents/store.go:89 Run.Actor`, `apps/agents/sessions_store.go:142`; the nearest existing hook |
| Automatic provisioning | **partial, and per-org only** | `agents.SeedPersonalities(ctx, org)` (`apps/agents/personalities.go:79`) runs on every login from `apps/team/account.go:539` and is idempotent. It seeds an ORG's agents; nothing is seeded per person |
| The persona as a value | **shipped** | `apps/agents/personalities.go:27` — `persona{Name, Description, Instructions}`, exactly this HIP's shape less the capability defaults |
| A platform preset library | **shipped, compiled in** | `personalities.go:35` `var personalities` — the crew `dev`, `des`, `vi`, under test at `personalities_test.go:30` and `brand_test.go:198`. Presets flatten into ordinary agent rows and are not special-cased downstream, which is the property this HIP wants |
| Capability defaults on a persona | **gap** | the struct carries no tool set; every seeded persona gets the deployment's default model and nothing else |
| Org-extendable presets | **gap** | the library is a package-level var, and the file states "no per-org config" as its design. Org extension is a change of shape, not a value added to a list |
| Create-an-agent-from-a-persona, as one operation | **in progress** | only a bulk idempotent seed of the whole crew exists (`SeedPersonalities`). No per-persona create. Landing in the `apps/agents` persona lane |
| The persona an agent wears, as stored state | **gap** | a persona is flattened into the agent row at seed time (`personalities.go:88`); nothing records which persona an agent was cut from, so an agent cannot change one |
| User-bound agent link | **in progress** | not present at HEAD, and absent from the working tree and every worktree checked on 2026-08-27. Landing in the `apps/agents` persona lane, with the per-user agent row above |
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
| A home org that always resolves | **shipped** | `iam/pkg/store/membership.go:210 MemberOrgRefs`, `:249 IsHomeOrg` — "the owner segment IS the home org", emitted whether or not a membership row exists |
| A chartered founder org at signup | **partial, and conditional** | `iam/internal/oidc/signup.go:305` charters only when `app.OrgChoiceMode == "create"`; slug from `onboard.go:230 personalOrgSlug`; the converge at `provision.go:99` |
| Founding a SECOND org through signup | **refused by design** | `iam/internal/oidc/provision.go:139` returns 409; additional orgs go through `cloud/apps/account/account.go:237 POST /orgs` |
| Home membership rows backfilled | **gap, and a live landmine** | `iam/pkg/store/membership.go:155 BackfillMemberships` has no caller, so a home row exists only where an invite or a founder provision wrote one — and an empty org set is what HIP-0519 reads as a machine principal |
| `tel` numbers | **shipped — RENTED ONLY** | `apps/tel/carrier.go:16` has six verbs: Search, Buy, Release, Call, Hangup, Send. The only path into `tel_numbers` is `apps/tel/tel.go:192 buyNumber` |
| `tel` bring-your-own number | **gap** | no SIP, porting or forwarding verb anywhere in `apps/tel`; there is no way to attach a number an org already controls |
| `tel` inbound | **gap** | ten routes (`apps/tel/tel.go:106-123`), all outbound or read-only. The `Webhook` field (`tel.go:257`) is forwarded to the CUSTOMER's URL (`rest.go:165`) — the carrier never posts to us |
| `tel` tenancy | **shipped — org** | `apps/tel/store.go:41` `PRIMARY KEY (org, id)` plus a global unique index on the E.164. No user column |
| `tel` reaching the room plane | **gap** | `apps/channels/registry.go:76` is a closed four-transport set and telephony is not in it |
| Real PSTN, inbound and outbound | **shipped, in the wrong process** | `bot/extensions/voice-call/` — three carriers, inbound webhook at `src/webhook.ts:134`, signature verification, an inbound pairing policy. It is node-local and single-tenant, exposed through a tunnel (`src/tunnel.ts`) |
| WhatsApp on the person's own number | **shipped, as a linked session** | `bot/src/channels/registry.ts:43` — "WhatsApp (QR link)", a web-multi-device bridge. Cloud's `apps/integrations/whatsapp.go:20` holds a Business credential with no ingress |
| iMessage | **shipped, and it needs a Mac** | `bot/extensions/imessage/` and `bot/extensions/bluebubbles/`, both inbound and outbound relays |
| Personal email as a room | **gap** | no email channel in the bot's eight-channel roster (`bot/src/channels/registry.ts:7`); `apps/notify` sends and cannot receive |
| Outbound SMS, voice and WhatsApp on the ORG's own carrier credential | **shipped** | `apps/notify/twilio.go:17` — channels SMS, Voice, WhatsApp, keyed by the org's own account-sid, auth-token and from-number. The closest shipped prior art for a brought number |
| Plans as one catalog | **shipped** | `@hanzo/plans`: `subscription.json`, `embed.go:15`, normalized by `entitlements.mjs:104 fromLegacy`; cloud reads it at `apps/plan/plan.go:56` through goja rather than reimplementing it |
| `plan.Limits` as a Go type carrying capacity | **shipped** | `commerce/models/plan/plan.go:298 Limits`, with `Agents` at `:340` and `Bots` at `:341` — "how many of each the plan may RUN". `api/billing` aliases the type rather than declaring a second copy |
| The hourly rate as catalog data | **shipped** | `@hanzo/plans` 1.6.0, `plans/seats.json:4 runtime.agentHourUSD`, with the capacity limits beside it at `subscription.json` `limits.agents` / `limits.bots`. Its own note states the split this section specifies |
| Anything metering agent hours against that rate | **gap** | no reader of `agentHourUSD` anywhere in `cloud/apps`. The rate is published and nothing bills from it, so the runtime half of §13 is a standard today, not a meter |
| Heavier compute tiers | **not published** | `plans/seats.json:6` says the rate buys the base tier and that heavier tiers are not published yet — so a bot on a bigger machine has no price to charge |
| A per-seat price | **shipped, for one plan** | `plans/subscription.json:331` `per_seat` on `team`; real money at `commerce/api/billing/subscribe_card.go:389` |
| Seats reconciled against the roster | **gap** | the charged quantity is caller-supplied (`subscribe_card.go:126`); the true count is computed separately at `cloud/apps/team/account_store.go:448 Seats` and only displayed. Nothing joins them |
| One definition of "free" | **gap — four are in circulation** | the catalog tier (`plans/subscription.json:3`), a runtime daily ceiling (`cloud/apps/allowance/allowance.go`), a commerce tier granting `MaxAgents:1` and no credit (`commerce/billing/tier/tier.go:53`), and an unrelated `freeTier` flag on a compute plan (`plans/plans.json`) |
| `pref` readable only by its subject | **shipped, deliberately** | `apps/pref/prefs.go:146,166` are the only two routes and the subject is derived server-side at `:202`; the package doc states there is no path for an org admin or a SuperAdmin |

The shortest honest order of work: make the agent row's key the (org, user) pair,
seeded beside the org personalities that already seed on login; put the level in
the `pref` document the person already has, and give `pref` a background-safe
read; add the authoring fields to the envelope, set server-side, and finally
write the agent's reply to the store; then build the window on the
due-time-and-sweep pattern that already works, with the sweep made finer than the
smallest window offered.

For the line, the order is narrower than it looks. One signature-verified inbound
route on `tel` is the single highest-leverage change, because without it every
route in §11 is dead and with it both the provided and the ported number light
up; a fifth transport in the room plane's registry then buys pairing, gating and
inbox for free, since the transport shape is already `{id, caps, normalize,
send}`. Attaching a number an org already controls needs a claim verb distinct
from `Buy` AND a proof of control, because a global unique index on the E.164
makes first-claimant-wins the default and that is a hijack. Porting is a quarter
of work and is mostly not code.

For the bill, the reprice moved the work rather than finishing it. Capacity is
now a published limit with a Go type behind it, so enforcing it is a read. The
runtime half has a published rate and no meter, so billing an agent-hour is the
piece to build. The old join is still owed and is narrower now: a capacity limit
checked against a self-reported count is not a limit.

### §15 What this asks of other specifications

Five things this HIP needs are owned elsewhere. Each is named here as a request,
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
5. **HIP-1210** — the persona library and the create-from-persona operation are
   surface on `/v1/agents`, which HIP-1210 owns. §3 specifies what a persona IS
   and the rule that it carries no authority; the address, the preset list's
   shape, and how an org extends it are HIP-1210's to declare. The concept is
   already in that package (§14) — what is missing is a route, not an idea.

### §16 Conformance

An implementation conforms when all of these hold:

1. Every human principal in an org has exactly one personal agent, and no path
   creates a second.
2. The row key is the (org, user) pair; no read resolves an agent by org alone
   and filters afterwards.
3. The default level is `draft`, everywhere, including for scopes that did not
   exist when the person last looked, and for an agent freshly cut from any
   persona. No persona carries, implies or defaults a level.
4. No principal other than the person can raise that person's level, the agent
   cannot reach its own setting, and an org ceiling can only lower it.
5. Every stored message carries its authoring kind, set by the server, and every
   agent-sent message is stored.
6. A confirmation is asked on a path that can carry the answer back.
7. Lowering a level cancels every window open under the old one.
8. No offered window is shorter than the implementation's own timing resolution,
   and no window runs on a second task engine.
9. A personal line is connected as a per-person credential, and no org-admin path
   connects, reads or disconnects one.
10. `confirm` is never silently downgraded on a synchronous channel: on a live
    call the agent does not speak unless the level is `send`.
11. No plan limit and no hourly rate is written down anywhere but the catalog.
    Capacity refuses, runtime bills, and neither does the other's job.
12. The product words stay on the product surface. Neither "App" nor "Dev"
    appears as a noun in a route, a package name, a schema field or a normative
    sentence.

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
outside network renders the person's name — and why §15 asks HIP-1103 whether a
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
- HIP-1114 — Code — Search and Symbols (the index, not the product)
- HIP-1141 — Pref — One Document Per Person
- HIP-1210 — Agents — Define, Run, Keep the Run
- HIP-1260 — Knowledge — Wiki and Agent Memory

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
