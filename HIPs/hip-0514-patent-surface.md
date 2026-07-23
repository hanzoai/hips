---
hip: 0514
title: Research-to-IP — the Patent Surface, Disclosure Gating, and Provenance-as-Invention-Record
author: Hanzo AI Team
type: Standards Track
category: Core
status: Draft
created: 2026-07-23
requires: HIP-0001, HIP-0512, HIP-0513
---

# HIP-514: Research-to-IP — the Patent Surface

## Abstract

This proposal specifies how novel, defensible inventions flow from Hanzo's research
evidence (HIP-0512) into protected intellectual property, and the one decision that
governs what comes out of private research: **disclose, protect, or publish**. Two
orthogonal layers over one store: **`hanzoai/research`** holds the evidence (what we
measured — provenance-first, immutable, timestamped); **`hanzoai/patent`** (`/v1/patent`)
reads that evidence and adds the IP layer — invention disclosure, prior-art assist, draft
generation, portfolio tracking, and a per-artifact **disclosure classification**. A
patent is a *projection* of research evidence plus a claims layer, exactly as the
benchmark leaderboard is a projection of the attempt store. The engineering pipeline is
Hanzo's; **filing, as-filed claims, and freedom-to-operate/novelty opinions are
attorney + registered-agent deliverables** referenced here, never authored by the
system.

## Motivation

Private research routinely produces inventions — a routing algorithm (Enso Genome), a
kernel-fusion technique (hanzo-engine), a training method (hanzo-ml) — and today they sit
undifferentiated in the evidence layer. Three failures follow: a patentable invention is
open-sourced before filing (destroying novelty); a trade-secret is accidentally
disclosed; or the invention date cannot be defended because conception and
reduction-to-practice were never recorded. Each is an avoidable loss of protectable
value. The fix is structural: make **disclosure classification** a first-class field on
every research artifact, and give the invention a projection surface that turns evidence
into a protected filing — with the provenance the evidence already carries serving as the
invention record.

Hanzo is unusually positioned: the research datastore (HIP-0512) is an immutable,
timestamped, cryptographically-provenanced log of every experiment. That *is* the
lab-notebook evidence a patent's priority date and reduction-to-practice defense require —
no separate invention-tracking system is needed, only a layer that reads it.

## Specification

### 1. Two layers, one store, orthogonal

- **`hanzoai/research`** (evidence) — the graduated home of the research plane (HIP-0512):
  experiments, runs, attempts, results. Facts, provenance-first. `/v1/research` is its
  cloud surface. It answers *what did we discover*.
- **`hanzoai/patent`** (IP) — `/v1/patent`, a sibling surface that **reads** research
  evidence and adds *is this novel, defensible, and how do we protect it*. It never
  duplicates the evidence; it references research artifacts by their stable id, so a
  patent's supporting evidence is the exact immutable experiment record.

Neither layer knows the other's policy. Research does not decide IP; patent does not
produce evidence. They compose at the reference seam.

### 2. Disclosure classification — the one reveal-vs-protect decision

Every research artifact carries one field, `disclosure`:

```
open               — published / open-sourced; no protection sought
defensive-pub      — deliberately published to bar others from patenting (prior art)
trade-secret       — kept private indefinitely; never disclosed; protection = secrecy
patentable         — candidate for filing; frozen from public release pending decision
patent-pending     — a provisional/application is filed; priority date established
filed              — a full application is on file (national/PCT)
```

This is the single mechanism for "what comes out of private research." A `patentable` or
`trade-secret` artifact is **held from any public surface** (the commons of HIP-0512, an
open-source release, a blog) by a fail-closed gate keyed on this field; an `open` or
`defensive-pub` artifact may be published. The field is set by a human (an inventor +
counsel decision), never inferred by the system — classifying IP is a legal/business
judgment, not an automated one.

Per the house IP-tone rule: the classification is **data**. Code enforces the gate
(`disclosure != open ⇒ not on a public surface`) without narrating concealment — no
"CONFIDENTIAL", "never reveal", "stays private to" prose in source, comments, or commits.
The gate simply gates; the HIP is the spec home for why.

### 3. The `/v1/patent` pipeline (engineering; the legal line drawn)

A patent moves through stages, each an engineering aid to a human inventor + counsel:

1. **Disclosure capture** — an inventor files an invention disclosure referencing the
   research artifacts (experiment ids) that are its conception + reduction-to-practice
   evidence. The provenance (timestamps, run manifests, results) is the priority-date
   record, pulled from `/v1/research`, not re-entered.
2. **Prior-art assist** — surface related public work (search over patent corpora + the
   literature) to inform the inventor. This is **decision-support** — it flags overlap and
   surfaces references; it does **not** issue a novelty opinion (that is counsel's).
3. **Draft generation** — assemble a structured draft (background, field, summary,
   detailed description, claims skeleton, figures) in **LaTeX** (the papers/proofs rule),
   grounded in the referenced evidence. A draft, for attorney review — not a filing.
4. **Portfolio + status tracking** — track each invention's `disclosure` state, filing
   dates, jurisdictions, deadlines, and the linked evidence. This is the durable IP
   ledger.
5. **Publication decision** — on an `open`/`defensive-pub` classification, route the
   artifact to the publish path (HIP-0512 commons, a paper, a repo); on `patentable`/
   `trade-secret`, the gate (§2) holds it private.

**The legal line (NOT authored by the system):** filing with any patent office, the
as-filed claim language, freedom-to-operate analysis, and any legal novelty/validity
opinion are the deliverables of counsel + a registered patent agent/attorney. `/v1/patent`
produces disclosures, prior-art *references*, drafts, and tracking — the inputs to that
legal work, never the legal act itself. This is the same line HIP-0513 draws for
terms/privacy: mechanisms here, binding legal work with counsel.

### 4. Provenance as the invention record

A filing's strength rests on a defensible conception date and reduction-to-practice. The
research plane already provides both: every experiment is an immutable, timestamped record
with its harness commit, inputs, and results. `/v1/patent` links a disclosure to those
records by id, so the invention's evidence is the exact, unaltered experiment — an
audit-grade lab notebook by construction, not a reconstructed claim. A re-scored or
corrected result adds a new event (HIP-0512), never rewrites the original, preserving the
evidentiary chain.

### 5. Security and access

Patent data (disclosures, drafts, `patentable`/`trade-secret` artifacts) is the most
sensitive tier: access is least-privilege, org-scoped, and audit-logged (every read of a
pre-filing disclosure is an event). The disclosure gate is fail-closed — an artifact whose
classification cannot be resolved is treated as `trade-secret` (never published), because
an accidental disclosure is irreversible and destroys patentability. Draft artifacts live
in the isolated store, never a public surface, until an explicit `open`/`filed` transition.

## Rationale

- **Decomplected.** Evidence (research) and protection (patent) are two layers with two
  jobs; a patent references evidence, never copies it. One store, two projections.
- **One way, values not places.** `disclosure` is one field on the artifact — the single
  reveal-vs-protect decision — checked everywhere by a fail-closed gate, not a policy
  scattered across surfaces.
- **Provenance is the asset.** The immutable research log is the invention record; the
  patent layer reads it rather than reinventing lab-notebook tracking.
- **Engineering ≠ legal.** The system prepares IP work (capture, search-assist, draft,
  track); counsel + a registered agent do the filing and the opinions. Drawing the line
  is the integrity requirement, identical to HIP-0513.
- **IP-tone honored.** Protection is a data classification enforced by a plain gate; the
  code does not narrate concealment.

## Backwards Compatibility

Forward-only and additive. `hanzoai/research` is the evidence layer's proper home
(graduating the enso-bench prototype); `/v1/patent` is a new sibling surface. With no
disclosures filed, the patent layer is inert and every research artifact defaults to its
existing publication behavior — except that the fail-closed gate now treats an
unclassified artifact as private, which is strictly safer than today.

## Open Questions

1. **Default disclosure.** Whether a new research artifact defaults to `trade-secret`
   (safest, but blocks the open commons until reclassified) or `open` with an explicit
   hold for anything flagged patentable. Leaning `trade-secret`-default with a fast
   inventor reclassification, since accidental disclosure is irreversible.
2. **Prior-art corpora.** Which patent/literature sources the search-assist indexes, and
   the licensing to do so.
3. **Draft model.** Which model drafts patents (an Enso preset, likely a strong-reasoning
   arm) and how its output is watermarked as attorney-review-required.
4. **Defensive publication cadence.** A pipeline to convert `open` research into timestamped
   defensive publications (barring others' patents) as a standing practice.

## Reference Implementation (staging)

1. `disclosure` field on the research artifact (HIP-0512 store) + the fail-closed
   publication gate (unclassified ⇒ trade-secret ⇒ never public).
2. `/v1/patent/disclosures` — capture an invention disclosure referencing research ids.
3. Prior-art assist (search over indexed corpora) as decision-support, watermarked
   non-opinion.
4. LaTeX draft generation grounded in referenced evidence; attorney-review watermark.
5. Portfolio/status ledger + least-privilege audit-logged access; the isolated pre-filing
   store.

Each stage ships and is reviewed independently (blue builds, red reviews the fail-closed
disclosure gate + the legal-line boundary, CTO confirms); the attorney/agent deliverables
gate any actual filing, not the engineering landing.
