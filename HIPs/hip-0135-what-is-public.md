---
hip: 0135
title: What Is Public
author: Hanzo AI
type: Process
category: Governance
status: Active
created: 2026-07-29
---


# HIP-0135: What Is Public

## Abstract

Every repository sits in exactly one of four states, and which one is decided
by a single question: **what can someone do with it that competes with us?**

| State | Where | License | What lives here |
|---|---|---|---|
| **Private** | `hanzo-inc` | none published | The cloud and SaaS control plane, and anything that hands a reader the ability to run our business |
| **Fork, public** | `hanzoai` | the upstream's, unchanged | Software we forked and maintain |
| **Ours, public** | `hanzoai` | Apache 2.0 | Libraries, SDKs, tools, demos — our own new code |
| **Ours, source-available** | `hanzoai` | a license permitting local development and forbidding production, enterprise and hosted service use | Code worth reading and running locally that would otherwise be a competitor's head start |

`hanzoai` is the open organisation. If a repository there is private, it is
either mislabelled or in the wrong organisation — private work belongs in
`hanzo-inc`, where every repository is private and that is the point.

## Specification

### 1. Private means competitive, not merely internal

The test is not "did we write it" or "is it finished". It is whether a reader
who obtained it could stand up something that competes with what we sell. The
cloud control plane, the SaaS surfaces, and the operational glue that runs them
are private for that reason.

Being unfinished is not a reason to be private. Being embarrassing is not a
reason to be private. Those belong in the archive
(`hanzo-inc/papers`, `hanzo-inc/artifacts`) or in public with an honest README.

### 2. A fork carries its upstream forward, unchanged

We fork software and we maintain those forks. Three things are not ours to
alter:

- **the upstream LICENSE file**, kept as it arrived;
- **the upstream copyright notices**, in that LICENSE and in source headers;
- **a NOTICE file** naming the upstream project and its copyright holder.

Renaming a fork for our brand is fine and expected. Removing the copyright of
the people whose work we build on is not, and the distinction is not a
formality — it is the condition on which we were given the code.

A fork stays public. A fork we take private is a fork we have stopped
contributing back, and that is a decision to make deliberately and rarely.

### 3. Our own new code is Apache 2.0

Apache 2.0 unless there is a specific reason otherwise: it grants patent rights
explicitly, it is compatible with nearly everything, and it requires attribution
without requiring reciprocity. Every Apache-licensed repository of ours carries
a NOTICE file — section 4(d) is what makes attribution travel with the code.

**A public repository with no license is the worst state available.** Default
copyright reserves all rights, so a reader may look and may not use; we give up
the benefit of being open and receive no protection in exchange. Public and
unlicensed is a defect, not a neutral middle ground.

### 4. Source-available is for the case OSS does not cover

Some code should be readable, runnable locally, and buildable against — and
should not be a competitor's shortcut to a hosted product. That is what the
source-available state is for: local development permitted, production,
enterprise deployment and hosted service use reserved.

Use it deliberately and name it accurately. Do not call it open source; it is
not, and saying so costs more credibility than the license saves.

## Rationale

**Why the boundary is competition rather than secrecy.** Most of what we build
is more valuable to us when it is read, adopted, and reported against. What is
genuinely worth protecting is narrow: the thing a customer pays us to run. Once
that is the test, the rest of the estate can be open without argument, one
repository at a time.

**Why forks are strict.** An upstream license is a grant with conditions, and
attribution is the cheapest one anybody has ever asked for. Stripping it saves
nothing and risks the fork.

**Why unlicensed is called a defect.** It looks like generosity and functions
as a trap: a reader who relies on it is exposed, and so are we. Choosing a
license — any of the four states — is always better than leaving it open.

## References

- HIP-0134 — One Process, One Socket, One Identity (the estate this governs)
- Apache License, Version 2.0 — https://www.apache.org/licenses/LICENSE-2.0
