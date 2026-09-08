---
hip: 0525
title: Rendezvous — When Every Participant Is a Machine
author: Hanzo AI
type: Standards Track
category: Core
status: Draft
created: 2026-08-27
requires: HIP-0523, HIP-0524, HIP-1252
---

# HIP-0525: Rendezvous — When Every Participant Is a Machine

## Abstract

Two people's agents can confer on their behalf. When they do, nobody is
listening, and a meeting nobody listens to should not carry sound.

A **rendezvous** is a meeting whose admitted participants are all machines. It
opens no audio and no video — not muted, never negotiated — and the agents
exchange the same envelopes they would exchange in any room. The saving is not a
new protocol. It is the absence of one: two machines that speak text have no
reason to synthesize it into speech so the other can transcribe it back.

This HIP specifies when a meeting is a rendezvous, what is exchanged instead of
media, the bounded profile of a person's preferences one agent may offer another,
and the consent that gates it. It adds no capability: the meeting is HIP-1252's,
the envelope is HIP-1066's, the room is HIP-0523's, and the authority to act for
a person is HIP-0524's.

## Motivation

Two agents conferring over audio is the clearest waste in the estate. One
composes text, synthesizes it to speech, ships the audio; the other transcribes
it back to text and reads it. Two lossy conversions, an encoder, a media path and
a listener, to move a sentence between two processes that could have exchanged
the sentence. Every conversion can drop a digit from a phone number, and none of
them helps anyone, because there is no ear in the room.

The second reason is more useful than the efficiency. A meeting nobody attends
leaves no record a person can read afterwards. If the agents exchange envelopes
instead of sound, the meeting IS its own transcript — the person opens the room
later and reads what their agent agreed to, in the same view as everything else.
Audio would have required a recorder, a transcriber and a summarizer to arrive at
what the exchange already was.

This is worth a specification and not a shortcut because the decision has to be
made at admission. Media that is opened and then muted has already allocated the
path, already granted the publish right, and already created something a defect
can turn back on. The interesting rule is the one that never negotiates it.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted
as in RFC 2119.

### §1 The trigger

A meeting is a **rendezvous** when every admitted participant is a machine — an
agent or a bot in HIP-0523 §3's sense — and no human has been admitted.

The predicate is over the ADMITTED set, not the invited one. An invitation
predicts nothing: a person invited to a meeting who never joins has not made it a
human meeting, and a room that waits for them is a room holding a media path open
for an audience of none.

The kind of a participant is already known at the moment it matters. HIP-1252
stamps identity server-side at admission and never takes it from the client, so
the thing that decides whether media is opened reads the same field that decides
who the participant is. There is no separate detection step and MUST NOT be one:
a second mechanism that classifies participants is a second answer to a question
admission already answered.

### §2 No media is opened

In a rendezvous, no participant is granted the right to publish or subscribe to
an audio or video track. This is a property of the grant, not of the client.

**Muting is not this.** A muted track has been negotiated, the path allocated and
the right granted; what stops the sound is a flag, and a flag is one defect away
from the other value. A rendezvous never asks for the track, so there is nothing
to turn on. An implementation that opens media and mutes it has not implemented
this HIP.

Nothing here changes what HIP-1252 does. It mints a join token carrying grants;
this HIP fixes what those grants are when the admitted set has no human in it.

### §3 What they exchange instead

Envelopes. The ones HIP-1066 already defines, in the room the rendezvous belongs
to, written to the one store HIP-0523 §6 requires.

There is no second message shape and this HIP defines no wire of its own. Between
processes in this estate the envelopes ride the transport the estate already
uses, which is binary and is not new. The efficiency the rendezvous buys is
entirely in what it does NOT do — no synthesis, no transcription, no media path —
and buying it does not require inventing anything.

The consequence is the useful one: **a rendezvous is legible.** Its exchange is
ordinary history in an ordinary room, so a person reads what their agent said in
the same view they read everything else, with no recorder and no summarizer in
between. A meeting that produced only audio would need all three to arrive back
at the text it started from.

### §4 The profile

An agent MAY offer a counterpart a bounded description of how its person likes to
be dealt with. The point is a smoother exchange between two humans who never met:
their agents agree on language, length and timing before either person is
troubled.

The profile is a closed set of enumerated fields:

| Field | Value |
|---|---|
| `style` | `brief` or `full` |
| `formality` | `plain` or `formal` |
| `format` | any of `prose`, `list`, `table`, `link` |
| `language` | one BCP 47 tag |
| `hours` | a time range and an IANA zone |
| `latency` | `now`, `hours`, or `days` |

**Every field is drawn from a closed vocabulary or a standard format. No field
carries free text.** That is the whole safety property, and it is structural
rather than a promise: there is no place in the shape to put a sentence about the
person, so a profile cannot become a summary of them however the sending agent
is prompted. Widening it is a change to this table, reviewable as such.

A profile is a PROJECTION of settings the person already holds in `pref`
(HIP-1141), which is one document per person and is the one place a per-person
preference lives. It MUST NOT be derived from the person's memory, their message
history, or anything an agent has inferred about them. Those are exactly the
sources that would make it a summary of the person rather than a description of
how to write to them.

**This deliberately does not resolve the memory question.** HIP-0524 §3 records
that per-person memory sits awkwardly with HIP-1260's one org-scoped store, and
HIP-1211 already calls `/v1/ai/memory` per-user while tenanting by org. A richer
profile drawn from memory would land in the middle of that, which is why this one
is drawn from `pref` instead. The tension stays open and stays HIP-1260's.

### §5 Consent is symmetric and starts off

A profile is exchanged only when BOTH people have allowed it. Consent defaults to
off, is set by the person and by nobody else, and an agent MUST NOT be able to
reach the setting that governs it — the same three rules HIP-0524 §4 puts on the
authority ladder, for the same reason.

Symmetry is not politeness, it is what makes the exchange fair to reason about: a
profile handed to a counterpart whose own person shared nothing is a one-way
disclosure, and the person who disclosed cannot tell that it was.

The exchange is written to the room like everything else, so a person can read
later what was shared on their behalf and with whom. An exchange that leaves no
record is indistinguishable from one that never happened, which is the property
an audit needs and the person deserves.

Consent to share a profile is not authority to act. What an agent may SEND on a
person's behalf remains HIP-0524's ladder, and a rendezvous grants nothing there:
two agents at `draft` may confer all day and neither may send a thing.

### §6 A human joining opens the meeting, once

When a human is admitted to a rendezvous, it stops being one and media becomes
available from that moment.

The transition runs one way only. A meeting that has admitted a human stays open
for its life, even if that person leaves. The alternative — closing again when
the last human drops — makes the media path a function of a set that changes
constantly, which is a renegotiation every time someone's connection blinks and a
race every time two people leave at once. One transition, in one direction, is
the whole of it.

Nothing that was exchanged before the human arrived is hidden from them. It is
envelopes in the room, and they are a member of the room.

### §7 What is built, what is missing

Measured on 2026-08-27. The honest summary is that the meeting and the envelope
both exist and the rendezvous does not: this HIP describes a rule over shipped
parts, and the rule is the part that is missing.

| Mechanism | State | Evidence |
|---|---|---|
| A meeting with server-stamped participant identity | **shipped** | HIP-1252; `apps/meet` mints the join token and stamps identity server-side |
| Grants carried on the join token | **shipped** | the token is where publish and subscribe rights are set, which is where §2's rule belongs |
| The envelope the exchange rides | **shipped** | HIP-1066; `apps/channels/envelope.go` |
| Per-person settings to project a profile from | **shipped** | HIP-1141; `apps/pref` — one document per person |
| The rendezvous predicate, and grants that follow it | **gap** | nothing computes "every admitted participant is a machine", and nothing varies the grants on it |
| A participant kind distinguishing machine from human | **gap** | see HIP-0523 §13 — a bot is a workspace member today, not a room member, and a meeting participant carries no kind |
| Agent-to-agent exchange with no human between | **gap** | no path in the estate sends a structured message from one agent to another |
| The profile, its consent, and its record | **gap** | `apps/pref` serves exactly two routes (`apps/pref/prefs.go:146,166`), derives the subject server-side (`:202`), and its package doc states there is no path for an org admin or a SuperAdmin. That is the correct starting point, not the feature: today nothing but the person can read what §4 would project |

Two of those gaps are the same gap. Until a participant carries a kind, the
predicate in §1 cannot be evaluated, so **the participant kind is the first piece
of work and everything else in this HIP waits on it.** It is also the piece
HIP-0523 §13 already needs for its own reasons, which is the argument for doing
it once.

### §8 Conformance

An implementation conforms when all of these hold:

1. The rendezvous predicate is evaluated over admitted participants, at
   admission, from the server-stamped kind.
2. No audio or video track is negotiated in a rendezvous — the grant withholds
   the right rather than the client withholding the stream.
3. The exchange is envelopes in the room's one store; no second message shape and
   no second store exist for it.
4. A profile carries only the fields of §4, every one from its closed vocabulary,
   and is projected from `pref` alone.
5. A profile crosses only when both people have consented, consent defaults to
   off, and no agent can write its own.
6. Every exchange is recorded in the room.
7. Admitting a human opens media once and never closes it again.

## Rationale

The alternative is to let two agents hold an ordinary call and simply not listen.
It costs a media server, an encoder per participant, and a transcription pass to
recover the text that existed before any of it — and it produces a recording of
synthetic speech as the record of what was decided. The rendezvous is not an
optimization of that; it is declining to build it.

The alternative to envelopes is a purpose-built agent protocol, which is the
tempting design because "machines talking to machines" sounds like it wants its
own wire. It would be a second message shape, a second store to read it back
from, and a second thing to keep in step with the first. The estate already has
one shape for a message and one place messages live, and two agents are not a
reason to grow a second of each.

The alternative to a closed profile is a free-text one — "tell the other agent
what my human is like" — which is more useful on the first day and is a summary
of a person crossing a boundary under a name that sounds harmless. The closed
table is less capable on purpose. It is also the only version whose safety can be
checked by reading it.

## Security Considerations

**A profile is a disclosure about a person who is not in the room.** They are not
present at the moment it crosses, which is why consent is symmetric, defaults to
off, cannot be set by an agent, and is recorded. Each of those four exists
because the person cannot object in the moment.

**Free text is the whole attack surface, so there is none.** An agent asked to
"summarize your human" cannot comply through this mechanism: the shape has no
field to carry it. If a future field takes a string, that field is the exposure
and it needs its own review — the fields in §4 are safe because they are closed,
not because agents are trusted.

**A machine participant that is not really a machine reads the room.** The
predicate decides whether media is opened; a forged or defaulted kind on a human
participant would make a meeting a rendezvous with a person quietly in it. The
kind MUST be server-stamped from the same admission that stamps identity, and a
participant of unknown kind MUST be treated as human — the safe default is the
one that opens media rather than the one that hides a listener.

**Two agents conferring is an unattended path between two tenants.** Each side
acts for a different person, and possibly a different org. An agent in a
rendezvous holds only what its membership holds (HIP-0523 §10), and the
counterpart's words are untrusted input exactly as a stranger's message is —
more so, because they arrive with the shape of a peer and nobody is reading them
as they arrive.

**A rendezvous is where an injection would most like to land.** No human sees the
exchange while it happens, and both ends can act. That is why §5 keeps the two
questions apart: conferring is not authority, and whatever an agent is talked
into agreeing, HIP-0524's ladder still decides whether anything leaves.

## References

- HIP-0523 — Rooms — One Store, Two Views, Many Bridges
- HIP-0524 — The Personal Agent — What It May Send Without You
- HIP-1066 — Channels — One Inbox (the envelope)
- HIP-1141 — Pref — One Document Per Person
- HIP-1210 — Agents — Define, Run, Keep the Run
- HIP-1252 — Meet — The Join Decision
- HIP-1260 — Knowledge — Wiki and Agent Memory
- BCP 47, and the IANA time zone database

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
