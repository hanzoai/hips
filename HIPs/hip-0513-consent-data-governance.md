---
hip: 0513
title: Consent, Data Governance, and the Training Corpus — Opt-In First-Party Data, One Sanitized Pipeline
author: Hanzo AI Team
type: Standards Track
category: Core
status: Draft
created: 2026-07-23
requires: HIP-0001, HIP-0111, HIP-0511, HIP-0512
---

# HIP-513: Consent, Data Governance, and the Training Corpus

## Abstract

This proposal specifies how request and response data flowing through the unified Hanzo
gateway may — **only under explicit opt-in** — become first-party training data for the
Enso router (HIP-0512), and the governance that makes that safe and compliant. One
pipeline, one way: an opted-in tenant's traffic is sanitized and de-identified by
`hanzoai/guard` at ingestion, stripped of PII, retained for a customizable window
(30-day default), and hard-deleted after; only the sanitized, consented subset enters
the corpus. Consent is a property of the tenant (HIP-0511 identity), enforced at the
ingestion boundary, and revocable. This document is the **engineering** governance
spec; the customer-facing `hanzo.ai/terms` and `hanzo.ai/privacy` copy and the
SOC2 / FedRAMP / GDPR attestations it must satisfy are **legal deliverables reviewed by
counsel**, referenced here but never authored in this HIP.

## Motivation

Enso improves as its corpus grows (HIP-0512: routing showed no detectable signal at
n≈198; the design needs orders more data). Hanzo sits at the unified gateway, so the
data exists — but using it is a governance problem before it is an ML one. The failure
modes are concrete and unacceptable: training on content a customer never agreed to
share; retaining PII; a de-identification claim that does not hold; an inability to
honor deletion; a corpus that cannot prove which examples were consented. Each is a
compliance breach and a diligence red flag. The answer is not to avoid the data — it is
**one governed pipeline** where consent, sanitization, retention, and deletion are
structural invariants, not policies bolted on.

## Specification

### 1. Consent is opt-in, tenant-scoped, revocable (default: excluded)

The default for every tenant is **excluded**: no request or response content enters the
training corpus. A tenant (org, per HIP-0511) may opt in explicitly; consent is stored
on the tenant record, carried on every request's provenance, and checked at ingestion.
Opt-in is revocable — revocation stops new ingestion immediately and triggers deletion
of that tenant's retained data (§4). Consent is granular: a tenant may share
`outcomes-only` (scores, per-arm correctness — no content) or `sanitized-content`
(§3 output). Customer content is **never** training data absent an explicit
`sanitized-content` opt-in.

### 2. First-party treatment of shared data

Data a tenant explicitly shares under `sanitized-content` consent is, after §3, treated
as **first-party**: Hanzo may use it to train and improve the shared router and models.
This is the reciprocal contract — the tenant gets a continuously-improving router
(HIP-0512), Hanzo gets the corpus — and it is exactly what the consent grant authorizes.
It does **not** extend to a non-consenting tenant, whose per-org policy still trains only
on its own traffic (HIP-0510 tenancy), never the shared base.

### 3. The `hanzoai/guard` sanitization pipeline (one way, at ingestion)

Every candidate example passes through one pipeline before it can enter the corpus,
composed at the ingestion boundary:

1. **Consent gate** — drop unless the source tenant's consent covers this class. No
   consent ⇒ the example never exists downstream. Fail-closed.
2. **PII strip** — `hanzoai/guard` detects and removes personally identifiable
   information (names, emails, phone, addresses, secrets, credentials, identifiers).
   PII is **never retained**, not even encrypted — it is removed before the example is
   written anywhere durable.
3. **Sanitize + filter** — `hanzoai/guard` redacts residual sensitive spans and filters
   examples that cannot be safely de-identified (dropped, not forced through).
4. **De-identification check** — an example that still carries identifying signal after
   3 is dropped, not admitted on a hope. "Anonymized" is a verified property, not a label.
5. **Provenance stamp** — the surviving example carries its consent class, sanitization
   version, source-tenant-hash (not identity), ingestion time, and retention deadline.

The pipeline is fail-closed at every step: any stage's uncertainty drops the example.
`hanzoai/guard` is the one sanitizer; no surface writes training data around it.

### 4. Retention is customizable, 30-day default, deletion is real

Sanitized examples carry a retention deadline: **30 days by default**, customizable per
tenant (a tenant may shorten it, or lengthen it within the compliance ceiling). After
the deadline the example is **hard-deleted** from the corpus and every derived store.
Deletion is also on-demand: a tenant's deletion request (or consent revocation) purges
its retained examples within the SLA, across the transactional plane and the aggregate
OLAP (`hanzoai/datastore`, HIP-0512). A model already trained on an example is not
retroactively untrained — the contract is that the *data* is deleted and no *future*
training uses it; this boundary is stated plainly to the tenant (it is a legal-copy point,
§6).

### 5. Compliance control mapping (SOC2 / FedRAMP / GDPR)

The controls above map to the frameworks Hanzo's global cloud must meet; the mapping is
the engineering contract, the certification is counsel's:

- **GDPR** — lawful basis = explicit opt-in consent (Art. 6); data minimization + PII
  removal (Art. 5); right to erasure via §4 deletion (Art. 17); purpose limitation =
  training only, stated at consent.
- **SOC2** — consent + provenance + deletion are audit-logged (every ingestion and
  deletion is an event); access to the corpus is least-privilege; the pipeline is a
  documented, tested control.
- **FedRAMP** — tenant isolation on the org boundary (SC-2/AC-4); audit of every
  privileged corpus action (AU-2/12); no cross-tenant data flow absent consent.

Data residency follows the tenant's region; a residency-constrained tenant's data never
leaves its region for training. These are **requirements on the build**, satisfied by
the pipeline, and the attestation is a separate legal/audit workstream.

### 6. Legal deliverables (NOT authored here)

The customer-facing `hanzo.ai/terms` and `hanzo.ai/privacy` language, the consent-UI
copy, and the SOC2/FedRAMP/GDPR attestations are **counsel-reviewed legal deliverables**.
This HIP specifies the engineering behavior those documents describe and must not
contradict; it does not write binding legal text. The build exposes the mechanisms
(consent flags, retention config, deletion API, audit log); the terms explain them to
the customer.

## Rationale

- **One pipeline, one way.** Consent → guard-sanitize → retain → delete is a single
  composed path; there is no second way for data to enter the corpus, so the invariant
  ("only consented, sanitized, PII-free, within-retention data trains") holds by
  construction, not by policy discipline.
- **Fail-closed, values not places.** Consent and de-identification are gates that drop
  on uncertainty; an example's consent class and retention deadline are properties of the
  value, checked everywhere, not a flag someone remembers to honor.
- **Reciprocity is the contract.** First-party treatment is what the opt-in grant *is*;
  it is scoped to the consenting tenant and never leaks to a non-consenting one.
- **Engineering ≠ legal.** The spec draws the line deliberately: mechanisms here, binding
  language with counsel. Inventing legal text would be liability, not diligence.

## Backwards Compatibility

Forward-only, and inert by default: with no tenant opted in, no content enters the
corpus and Enso trains only on Hanzo's own data plus the public benchmark commons
(HIP-0512). Enabling consent for a tenant adds data through the one pipeline; no existing
request contract or tenancy boundary changes.

## Open Questions

1. **Retention ceiling.** The maximum a tenant may lengthen retention to (compliance +
   storage bound) — a policy number for counsel + ops, not fixed here.
2. **Outcomes-only granularity.** Whether `outcomes-only` consent (scores, no content)
   should be the *default* opt-in (safer, trains Scout but not Critic) with
   `sanitized-content` a second explicit tier — likely yes.
3. **Re-identification audit cadence.** How often to red-team the de-identified corpus for
   residual identifying signal (the "anonymized is verified" claim needs periodic proof).
4. **Deletion-vs-trained-model boundary.** The precise customer-facing statement of what
   deletion does and does not do to an already-trained model (a legal-copy point).

## Reference Implementation (staging)

1. Consent field on the tenant record (HIP-0111 identity) + ingestion-boundary gate.
2. `hanzoai/guard` sanitization pipeline wired at ingestion (PII strip + sanitize +
   de-identification check + drop-on-uncertainty), with a sanitization version stamp.
3. Retention deadline on every corpus example; scheduled hard-delete; on-demand deletion
   API spanning the SQLite project plane + `hanzoai/datastore` OLAP.
4. Audit log of every ingestion and deletion event (SOC2).
5. Consent tiers (`outcomes-only` / `sanitized-content`) surfaced in the console; the
   terms/privacy copy (counsel) references them.

Each stage ships and is reviewed independently (blue builds, red reviews the fail-closed
gates + the de-identification claim, CTO confirms live); the legal deliverables gate the
customer-facing launch, not the engineering landing.
