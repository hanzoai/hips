---
hip: 0131
title: The Method — How We Build and Grow Autonomous Companies
author: Hanzo AI Team
type: Informational
category: Meta
status: Active
created: 2026-07-27
requires: HIP-0512
---

# HIP-131: The Method — How We Build and Grow Autonomous Companies


## Abstract

`hanzoai/method` is the discipline Hanzo applies to every bet it makes — R&D, product,
growth and marketing on one plane. This HIP is its manifesto; HIP-0512 is the mechanism.

## Motivation — the problem with companies

A company is a sequence of bets. Which model to serve. What to charge. Which kernel to
ship. Which sentence goes at the top of the page. Most of those bets are wrong — not
occasionally wrong, *usually* wrong, because they are guesses about a world that has not
answered yet.

That is fine. Being wrong is cheap. Being wrong **twice about the same thing** is what
kills companies, and it is the default, because the first refutation was never written
down anywhere the next person would look.

We have watched this happen inside our own walls. GPU results lived as `.log` files in
the home directory of the box that produced them — findable only by whoever remembered
the filename, gone with the disk. Two engineers a month apart can burn a week each on a
path the first already proved was dead, and neither will ever know.

So the scarce asset is not compute, or capital, or talent. It is **knowing which of your
bets already came back, and what they said.**

## The method

One discipline, applied to everything:

> **State a hypothesis. Say what you predict. Run the arms. Record the verdict.**

That is the scientific method, and it is not a metaphor here — it is the write path. A
kernel A/B and an ad test are the same shape: a falsifiable claim, some measured arms,
and a verdict of **proven**, **refuted**, or **inconclusive**.

This is why `kind` is an open string and will never be an enum. `kernel-perf`,
`ablation`, `training` — and `pricing-test`, `ad-test`, `growth-experiment`. The moment
you make marketing a second-class citizen with its own dashboard and its own vocabulary,
you have two systems, two truths, and no way to ask "did this change help?" across the
company. Same question. Same record. One plane.

## Four principles

**A refutation is a result.** Stored as plainly as a proof, retained forever, surfaced as
prominently. A plane that only kept wins would be a marketing plane. What did not work is
the more valuable half — it is the only thing that stops the company paying twice.

**Provenance or it did not happen.** Every record carries its commit, its branch, its
library versions, and whether the tree was dirty. A number measured on uncommitted code
is not reproducible, and the record says so rather than implying otherwise. We would
rather store an honest "—" than a confident zero.

**Measure where it happens.** Not in a dashboard afterward, not in a spreadsheet someone
maintains. The harness records at the moment of measurement, in whatever language the
harness is written in — Python, TypeScript, Go, Rust. Four producers, one record, keyed
so they upsert the same row. A result that requires a human to transcribe it is a result
you will lose.

**Private by default.** Recording is not publishing. Whether something becomes training
data, or a public claim, is a separate deliberate grant. Nothing leaves because it was
measured.

## Why this is the company, not a tool

An autonomous company is not a company with chatbots in it. It is a company whose loop —
*decide, act, measure, update* — closes without a human in the middle of every turn.

That loop is exactly the method. An agent that can state a hypothesis, run the arms, and
read the verdict can price a product, choose a model, write the ad, and kill its own bad
idea. What it cannot do is remember across sessions, or know what the last agent already
disproved. **The evidence plane is that memory.** Not a feature of the company — the
substrate the company runs on.

Which is what makes a million of them possible. Not a million bespoke companies, each
with its own analytics stack and its own institutional amnesia. A million instances of
one loop, each accumulating evidence into the same shape, each able to inherit what every
other one already learned.

Formation to exit, on one plane: incorporate, price, launch, measure, iterate, grow —
every step of it a bet with a verdict attached, and none of it requiring someone to
remember.

## What we owe you

Vertically integrated means we own the whole path, so we are accountable for the whole
path — the model, the gateway, the metering, the ledger, the record. There is nowhere to
point when it is wrong.

So the discipline applies to us first. Every claim we make about our own stack is a
record on this plane, with its provenance and its verdict, including the ones that came
back **refuted**. Our own DSL lost to a hand-written kernel by a measured 0.51–0.78×, and
that is written down — in the code, with the numbers, and the reason it will not close
with the current approach. We did not delete it and we did not ship the loser. We wrote
down what was true.

That is the whole thing. **Say what you think will happen. Find out. Write down what
actually did — especially when it is not what you wanted.**

Everything else is engineering.

---

*The plane this describes: `/v1/experiment` (HIP-0512). Producers in Python, TypeScript, Go
and Rust. The record is `(project, kind:subject:task)`; the verdict is `proven`,
`refuted`, or `inconclusive`; the source of truth is per-org and transactional, with a
best-effort warehouse projection for cross-project reads — losing a roll-up must never
fail a measurement.*
