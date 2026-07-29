---
hip: 0306
title: AML Transaction Monitoring, Screening and Case Management
author: Hanzo AI Team
type: Standards Track
category: Infrastructure
status: Draft
created: 2026-07-29
requires: HIP-0201, HIP-0230, HIP-0302
---

# HIP-306: AML Transaction Monitoring, Screening and Case Management

## Abstract

This HIP specifies what an anti-money-laundering transaction monitoring, sanctions
screening and case management system must do to be lawfully operable by a regulated
financial institution, and therefore sellable to one. Every requirement here is
traceable to a published standard or rule. Nothing here is a design preference.

The distinction this document exists to enforce is the one between a system that
*has* rules and a system that *discharges an obligation*. A rule engine that
evaluates expressions is a week of work. An AML system is a set of promises to a
supervisor: that the monitoring covers the institution's risks, that the screening
runs against current lists, that every alert can be explained years later, that
records survive five years, and that the model was validated by someone who did not
build it. Those promises are what this HIP specifies.

## Motivation

AML software fails audit in characteristic ways, and they are not the ways engineers
expect. It is rarely throughput. It is: the screening list silently stopped loading;
the aggregation window was computed over a truncated fetch; the alert cannot be
reproduced because the rule was edited without a version; the amount on the report
was derived rather than summed; nobody can say who approved the threshold. Each of
those is a control failure that a supervisor will find and an engineer will not,
because each looks like working software from the inside.

A specification is the countermeasure. If a requirement is written down with its
citation, it can be tested, and a test that fails is cheaper than a consent order.

## Terminology

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted as
described in RFC 2119.

*Institution* means the regulated entity operating the system. *Operator* means
Hanzo or a customer running the engine. *Subject* means the natural or legal person
whose activity is monitored. *Alert* means a machine-generated indication that
activity matched a detection rule. *Case* means a human-owned investigation record.

A note on obligation-bearers: almost every rule cited here binds the *institution*,
not the software. The software's duty is to make the institution's compliance
possible and evidenceable. Where this HIP says the system MUST do something, it
means the system must not be the reason the institution fails.

## 1. Scope and the obligations model

**AML-SCOPE-1.** The system MUST treat monitoring, screening, risk rating, case
management and recordkeeping as one control surface, not five features. US
supervisors define the object of examination broadly: a bank's "suspicious activity
monitoring and reporting systems" comprise its "policies, procedures, or processes
to identify, research and report unusual activity" and "are critical internal
controls" [1]. A component that is individually correct but not evidenced as part
of that control surface does not discharge the obligation.

**AML-SCOPE-2.** The system MUST NOT assume a single jurisdiction. Obligations that
look equivalent are not. The same $3,000 funds-transfer recordkeeping duty is
written twice in US law in two different vocabularies — 31 CFR 1010.410(e) governs
non-bank financial institutions in terms of *transmittor*, *transmittal order* and
*recipient*, while 31 CFR 1020.410(a) governs banks in terms of *originator*,
*payment order* and *beneficiary* [2][3]. The canonical data model MUST represent
one concept per role and map both legal vocabularies onto it. Emitting a bank's
records in non-bank terminology is a finding.

**AML-SCOPE-3.** Where an obligation is split between a functional regulator and a
prudential regulator, the system's conformance evidence MUST cite both. Suspicious
activity reporting is the canonical case: FinCEN's rule at 31 CFR 1020.320(a)(2)
sets a single flat threshold of "at least $5,000 in funds or other assets" [4],
while the familiar tiered thresholds live in each banking agency's own rule — 12 CFR
21.11(c) for national banks, and identically at 12 CFR 353.3 (FDIC), 12 CFR 208.62
(Federal Reserve) and 12 CFR 748.1(d) (NCUA) [5]. A bank is subject to both.
Citing only the FinCEN rule understates the duty.

## 2. Transaction monitoring and typology coverage

**AML-TM-1.** Monitoring MUST be risk-based and MUST be driven by a documented risk
assessment, per FATF Recommendation 1 and, in the UK, MLR 2017 reg 18 [6][7].
Coverage is therefore not a fixed list of rules; it is the demonstrated mapping from
assessed risks to deployed detections. The system MUST be able to render that
mapping as an artefact: for each assessed risk, the rules that address it.

**AML-TM-2.** Ongoing monitoring is an express legal requirement, not an
implication. In the US it is stated at 31 CFR 1020.210(a)(2)(v)(B), which requires
"conducting ongoing monitoring to identify and report suspicious transactions and,
on a risk basis, to maintain and update customer information" [8]. In the UK it is
MLR 2017 reg 28(11) [9]. The system MUST monitor continuously, not only at
onboarding.

**AML-TM-3.** Detection MUST cover, at minimum, the typologies the institution's
risk assessment identifies, and the rule library MUST be organised by typology so
that coverage gaps are visible. Structuring MUST be covered: 31 U.S.C. 5324 makes
it an offence to structure transactions to evade reporting, and 31 CFR 1010.314
states the prohibition [10]. Note that structuring has no intent threshold
expressed as an amount — a detection tuned only to a narrow band immediately below
a reporting threshold is under-inclusive.

**AML-TM-4.** Every detection MUST be evaluated against the correct threshold
*operator*, not merely the correct number. This is a recurring and silent source of
non-compliance. Two US thresholds that appear similar are opposite in inclusivity:
currency transaction reporting applies to a transaction "in currency of more than
$10,000" (exclusive) [11], while funds-transfer recordkeeping and the Travel Rule
apply to a transmittal "in the amount of $3,000 or more" (inclusive) [2]. A
conformance test MUST assert behaviour at exactly the boundary value for every
threshold rule, in both directions.

**AML-TM-5.** Currency MUST be normalised before any monetary threshold is applied,
and the normalisation MUST be auditable. A threshold expressed in USD that is
compared against a raw foreign-currency amount is both over- and under-inclusive
depending on the pair. Where a rate is used, the system MUST record the rate and
its as-of time with the alert, because the alert must later be reproducible
(AML-EXP-2). Hard-coded static rates MUST NOT be used for threshold decisions.

**AML-TM-6.** Aggregation duties MUST be implemented with the scope the rule
states. US currency-transaction aggregation is at 31 CFR 1010.313(b) and reaches
transactions "by or on behalf of *any* person", not merely the same named person
[12]. Implementing this as same-subject aggregation narrows the duty and will miss
the third-party and agent cases the rule exists to catch.

**AML-TM-7.** Travel-rule obligations MUST be implemented per jurisdiction and per
asset class, because the thresholds genuinely differ and one of them is zero.

In the US, the pass-on duty applies to transmittals of $3,000 or more and the
elements are enumerated at 31 CFR 1010.410(f)(1)(i)–(vii) [2]. One element is
routinely omitted from implementations because summaries drop it: (vii) "either the
name and address or numerical identifier of the transmittor's financial
institution". The same duty falls on every intermediary institution in the chain,
per 1010.410(f)(2) [2].

In the EU, Regulation (EU) 2023/1113 has applied since 30 December 2024 and repealed
Regulation (EU) 2015/847 from that date; beneficiary information elements are at
Art 14(2) [29]. Critically, **there is no de-minimis threshold for crypto-asset
transfers** — the regulation deliberately declines to exempt domestic low-value
crypto transfers, consistent with treating all crypto-asset transfers as
cross-border, and its Art 37 review clause asks whether such thresholds should be
*introduced* [29]. A system that applies a EUR 1 000 floor to crypto transfers is
therefore under-inclusive in the EU. That figure appears in the crypto context only
for the separate purpose of self-hosted-address ownership verification.

In the UK, the crypto threshold changed on 30 June 2026: SI 2026/621 reg 32
substitutes "£800" for "1,000 euros" in MLR 2017 reg 64C(4) [31]. A new reg 34A,
imposing enhanced due diligence obligations on cryptoasset firms and correspondent
relationships, commences 1 February 2027 [31]. Threshold values MUST therefore be
jurisdiction-scoped and effective-dated, not global constants.

**AML-TM-8.** Legal-instrument references MUST be unambiguous. "AMLD6" MUST NOT be
used in specifications, configuration or code: in pre-2024 usage it denotes
Directive (EU) 2018/1673 (the criminal-law directive) and in 2024-package usage it
denotes Directive (EU) 2024/1640. CELEX identifiers MUST be used instead —
32018L1673 and 32024L1640 respectively [30].

**AML-TM-9.** *Deferred.* A typology catalogue enumerating FinCEN advisories and
their published red flags is required to complete this section and is deliberately
not asserted here. See §12.

## 3. Rolling-window aggregation and thresholds

**AML-AGG-1.** Where a detection depends on activity over a window, the aggregation
MUST be computed over the complete set of qualifying records in that window. If the
implementation retrieves candidate records by key and then filters by time, the
retrieval MUST NOT be silently truncated by a fetch limit. A capped fetch turns a
"total in 24 hours" into "total among the first N records", which is a wrong answer
presented as a right one. Where a cap is unavoidable, the system MUST mark the
aggregate as incomplete and MUST surface that state to the analyst and to the alert
record.

**AML-AGG-2.** Where aggregates are precomputed or cached for latency, the system
MUST record the staleness of the aggregate used in each decision. An aggregate that
a background process maintains is, by construction, capable of being behind. That
is an acceptable engineering trade-off and an unacceptable *undisclosed* one: an
analyst and an examiner must both be able to see that the number was as of a time.

**AML-AGG-3.** Threshold values MUST be institution-configurable and MUST NOT be
compiled in. FATF prescribes no numeric alert threshold, and deliberately so; the
calibration is a function of the institution's risk appetite and portfolio. A
vendor default is a starting point, never a control. Every threshold MUST carry an
owner and an effective date.

**AML-AGG-4.** Helper functions available to the rule language MUST fail closed and
MUST be observably unimplemented if unimplemented. A helper that returns a
plausible constant — `false` for a screening predicate, `true` for a completeness
predicate — silently disables every rule that depends on it while the rule continues
to appear enabled in the UI and the API. The system MUST NOT ship a rule whose
dependencies are stubbed; a rule MUST be either functional or explicitly disabled,
and the API that lists rules MUST distinguish the two.

## 4. Sanctions and PEP screening

**AML-SCR-1.** Targeted financial sanctions MUST be applied without delay. That
phrase is the operative standard in FATF Recommendations 6 and 7, and it is a
timeliness requirement on the institution's screening, not merely on its
policy [6]. Screening that runs on a daily batch cycle does not satisfy a
without-delay obligation for payment interdiction.

**AML-SCR-2.** The system MUST ingest, at minimum, the OFAC SDN and consolidated
lists, the UN Security Council consolidated list, the EU consolidated (CFSP) list
and the UK sanctions list, each in its publisher's own current format. These
formats are not interchangeable: they differ in record type, identifier space,
name decomposition and date representation. A single parser applied to four
different schemas will produce empty or corrupt results for at least three of them,
and it will do so quietly.

The UK source requires specific attention because it changed recently and
silently. The OFSI Consolidated List **closed on 28 January 2026**; the gov.uk
publication is withdrawn and states that "from 28 January 2026 the UK Sanctions
List is the only source for all UK sanctions designations" [35]. The canonical
source is now the FCDO UK Sanctions List [36]. An implementation still pointing at
the OFSI `ConList.csv`/`ConList.xml` assets has been ingesting nothing since that
date while continuing to report successful screening — the exact failure mode
AML-SCR-3 exists to catch.

**AML-SCR-2a.** Where a publisher offers both a structured and a flat export, the
system MUST ingest the structured one. This is not a preference. OFAC's flat files
omit weak aliases entirely — the strong-alias count in `SDN.XML` equals the row
count of `ALT.CSV` exactly, so weak aliases exist only as quoted fragments inside a
free-text `Remarks` column that is itself truncated at 1,000 characters with
overflow in a separate file [7][37]. Ingesting CSV therefore discards thousands of
alias records and corrupts the remainder.

**AML-SCR-2b.** The system MUST distinguish the sanction *measure* from mere
presence on a list. The UK list expresses measures as explicit boolean indicators
including `AssetFreeze`, `TravelBan` and `ArmsEmbargo` [36]; a travel-ban-only
designation is not an asset-freeze target, and interdicting a payment on it is a
false positive with customer-detriment consequences. Screening for payment
blocking MUST gate on the asset-freeze measure.

**AML-SCR-3.** List ingestion MUST be verified per source on every refresh, and a
failure MUST be treated as a control incident. The system MUST assert, per source
and per run: that the fetch succeeded, that the parsed record count is within an
expected band, and that the count did not drop discontinuously. It MUST alarm on
staleness beyond a configured interval, and it MUST NOT report a screening result
as clean when the list backing it failed to load. This is the single most dangerous
failure mode in the entire system, because an empty list produces zero hits and zero
hits is indistinguishable from compliance. It is an observed failure mode in shipped
AML products in three distinct forms: source URLs that now 404 because the list was
withdrawn (AML-SCR-2), live URLs whose payload the parser silently rejects, and a
successful load into a store that the screening path does not read.

**AML-SCR-3a.** Change detection SHOULD use the publisher's own delta mechanism
where one exists, rather than diffing full exports. OFAC retired its RSS feed on
31 January 2025 and publishes dated delta files carrying explicit
`action="add|remove|update"` semantics at entity and sub-element level [38].
Publication cadence is irregular and MUST NOT be assumed: OFAC states notices may
be published at any time, and the observed pattern is business-day publication with
a median gap of two days and occasional gaps beyond a week [7]. A weekly refresh
therefore breaches the without-delay obligation in AML-SCR-1.

**AML-SCR-4.** Screening MUST match on names and aliases and MUST NOT require exact
equality. Fuzzy matching MUST be applied, and the technique, the matched name form
and the threshold MUST be recorded with each result so a match can be defended and
a non-match explained.

The baseline technique is not a matter of vendor invention: OFAC documents the
algorithm its own Sanctions List Search uses — an edit-distance prefilter at 50%
similarity, then **Jaro-Winkler** over the full name string and **Soundex** over
split name parts, "returning the higher of the two scores" [39]. The underlying comparators have
primary citations [49]. An implementation
that adopts this combination can defend it by citation. A third algorithm was added
in January 2021 which OFAC does not name; it MUST NOT be guessed at.

**AML-SCR-4a.** The match threshold MUST be institution-configurable and MUST NOT
be compiled in. OFAC is explicit that it will not recommend one: "OFAC cannot make
such a recommendation because each search has its own unique set of facts
surrounding it. Users … must make their own match threshold determinations based
upon their own internal risk assessments and established compliance
practices" [39]. Wolfsberg likewise requires that a governance framework contain
"the documented rationale for risk based decisions, such as those made in support
of the creation of screening rules and threshold settings" [40]. A hard-coded
constant is therefore a governance defect as well as an engineering one.

**AML-SCR-4b.** Weak and low-quality aliases MUST NOT be screened as primary match
candidates, but MUST be retained and surfaced for alert adjudication. Both
authorities agree and both give the same rationale. OFAC: "OFAC does not expect
that persons will screen for weak AKAs, but expects that such AKAs may be used to
help determine whether a 'hit' arising from other information is accurate" [7].
Wolfsberg: "It is not expected, nor is it typically productive, to screen against
weak aliases" [40]. Screening every alias at equal weight is a principal driver of
false positives and is contrary to published expectation.

**AML-SCR-4c.** Alternative spellings and transliterations of sanctioned
jurisdictions and parties MUST be handled. OFAC names this as a distinct root cause
of compliance failure — organisations that "did not account for alternative
spellings of prohibited countries or parties … (i.e., Habana instead of Havana,
Kuba instead of Cuba, Soudan instead of Sudan, etc.)" [41]. A jurisdiction check
implemented as equality against a list of ISO codes does not satisfy this.

**AML-SCR-5.** Non-Latin and transliterated names MUST be normalised before
comparison, using a documented standard rather than an ad-hoc character map. The
system MUST apply Unicode normalisation — NFKC is the appropriate pre-comparison
fold, as it collapses compatibility variants, full/half-width forms and ligatures
(UAX #15) [42] — MUST compare at primary collation strength for accent- and
case-insensitive equality (UTS #10) [43], and MUST defeat homoglyph substitution
using the confusable skeleton defined by UTS #39 and its published
`confusables.txt` [44][45]. A hand-maintained Cyrillic-to-Latin table is not a
substitute: it is incomplete by construction and silently diverges from the
published confusable set.

This is load-bearing, not theoretical. Non-Latin name forms are present in volume
in the primary sources — the OFAC advanced export carries thousands of Cyrillic and
Arabic name parts alongside Chinese, Hangul, Japanese, Greek, Georgian, Hebrew and
Armenian, and the UK list carries Cyrillic, Arabic, Chinese, Hebrew, Georgian, Thai,
Hangul, Khmer, Greek, Burmese and Lao [36][46]. Wolfsberg treats "support for the
screening or transformation of data in non-Latin characters" as an explicit
selection criterion for a screening application [40].

Where romanisation rather than normalisation is required, the system MUST name the
scheme (ICAO Doc 9303 Part 3 for travel-document transliteration [33]; ISO 9 or
BGN/PCGN for Cyrillic). The identities of these standards are settled; their canonical URLs
were not retrievable during drafting and are marked accordingly in §15.

**AML-SCR-6.** Where a candidate match is found, the system MUST use the
discriminating attributes the lists actually publish to raise or lower confidence:
date of birth, nationality, place of birth, and identity document numbers. A
screening interface that accepts a date of birth and then ignores it in the match
decision is worse than one that does not accept it, because it implies a
discrimination it does not perform. Discriminators MUST participate in scoring and
MUST be shown in the result.

**AML-SCR-6a.** Date of birth MUST be modelled as an interval with a qualifier, not
as a scalar. The UN list types every date as `EXACT`, `APPROXIMATELY` or `BETWEEN`
and carries year-range fields for the latter [12]; OFAC's advanced model carries
approximate flags and per-component fixity [46]. Comparing an approximate or ranged
listed date against an exact customer date as though both were points produces both
false negatives and indefensible false positives.

**AML-SCR-6b.** Identity-document structures MUST NOT be assumed to contain only
identity documents. OFAC's `idList` is an untyped key-value bag whose types include
gender, secondary-sanctions-risk notes, websites, email addresses, vessel MMSI
numbers and digital-currency addresses alongside passports [7]. Modelling it as
passport data mis-parses the majority of its contents — and discards the
digital-currency addresses, which are directly actionable for crypto screening.

**AML-SCR-7.** The system MUST support screening beyond the four corners of the
list. OFAC's 50 Percent Rule provides that "any entity owned in the aggregate,
directly or indirectly, 50 percent or more by one or more blocked persons is itself
considered to be a blocked person", and that such an entity's property is blocked
"regardless of whether the entity itself is listed" [13]. Two qualifications matter
for implementation: the rule turns on *ownership*, not control, so a
controlled-but-under-50% entity is not automatically blocked though caution is urged
[47]; and ownership aggregates across multiple blocked owners and resolves
transitively through intermediate entities [48].

The engineering consequence is that the blocked population is strictly larger than
the published list, and a name matcher alone cannot compute it. The system MUST
maintain an ownership graph supporting transitive resolution and aggregation across
multiple blocked owners, and MUST accept institution-supplied ownership data and
internal watchlists as first-class screening sources. The published list is a seed
set, not the answer.

**AML-SCR-10.** The screening application itself MUST be treated as within scope of
model governance where the institution's framework so provides. Wolfsberg states
that a screening application "may also be submitted for consideration as a model
and, if so considered, any associated governance framework" applies, and requires
"an independent risk based testing regime to ensure that the screening application
generates expected alerts, threshold settings and/or screening rules" [40]. §9
therefore applies to the matcher, not only to any statistical scorer.

**AML-SCR-11.** There is no published regulator benchmark for sanctions screening
false-positive rates, and the system MUST NOT be specified or marketed against one.
No such benchmark was located from OFAC, OFSI, FATF or the FCA during drafting, and
the widely repeated claim that 95–99% of sanctions alerts are false positives could
not be traced to any primary source; it MUST NOT be cited. The institution MUST
instead establish its own baseline false-positive and match rate, hold it under
change control, and re-baseline after any change to lists, algorithm or thresholds
— per Wolfsberg's independent-testing requirement [40] and OFAC's position that
thresholds are the institution's own determination [39]. Where a name variation is
found to have been previously undetected, a lookback with root-cause analysis MUST
be performed [40].

**AML-SCR-8.** PEP status MUST be a resolved attribute of the subject, distinguishing
foreign, domestic and international-organisation PEPs, and MUST extend to family
members and close associates, per FATF Recommendation 12 [6]. In the UK, a person
ceasing to be a PEP MUST continue to be treated under enhanced measures for at least
12 months, per MLR 2017 reg 35(9)(a) [14]. A PEP flag that is never populated
because entity resolution is a stub means every PEP rule is inert; the system MUST
NOT derive a subject record solely from an identifier present on the transaction.

**AML-SCR-9.** Screening results MUST be reproducible against the list version in
force at decision time. The system MUST retain list versions, not only current
state, because an alert raised today may be examined in three years against the list
as it then stood.

## 5. Customer risk rating

**AML-CRR-1.** Each subject MUST carry a risk rating derived from documented
factors, and the derivation MUST be reproducible. Customer due diligence obligations
attach to the rating (FATF Recommendation 10; 31 CFR 1010.230 for beneficial
ownership; MLR 2017 reg 33 for enhanced due diligence) [6][15][16].

**AML-CRR-2.** The rating MUST be refreshed on a schedule bounded by risk. The EU
2024 package makes this a hard engineering requirement rather than a policy
aspiration: AMLR (EU) 2024/1624 Art 26(2) caps the review interval at one year for
higher-risk customers and five years for all others [17]. The system MUST therefore
implement a scheduler with per-tier caps and MUST evidence that reviews occurred
within them.

**AML-CRR-3.** Enhanced due diligence triggers MUST be encoded with jurisdictional
precision. The UK's trigger for unusual transactions at MLR 2017 reg 33(1)(f) is
qualified — "unusually complex or unusually large *in each case given the nature of
the transaction*" — which is narrower than a bare size test and differs from the EU
formulation [16]. Sharing one hard-coded trigger across jurisdictions will be wrong
in at least one of them.

**AML-CRR-4.** The rating MUST feed monitoring, not merely reporting. A risk rating
that does not change which rules apply or which thresholds are used is decorative.

## 6. Alerting

**AML-ALT-1.** Every alert MUST be durably persisted at the moment it is raised,
before any response is returned to the caller. Alerts held only in process memory
are lost on restart and cannot satisfy retention (§8). An in-memory alert store with
capacity eviction is not a cache in this context; it is undisclosed destruction of
records the institution is required to keep.

**AML-ALT-2.** Alert volume MUST be bounded by tuning, not by eviction. Where the
system caps memory or storage, it MUST do so by refusing or shedding with an error
that the operator can see, never by discarding already-raised alerts.

**AML-ALT-3.** The system MUST NOT allow a client-supplied identifier to cause
unbounded growth in any store. Re-submission of the same transaction identifier MUST
be idempotent or explicitly versioned.

**AML-ALT-4.** Aggregate risk scores MUST be monotone, bounded and informative. A
score that saturates at its maximum for ordinary activity conveys no information and
MUST be treated as a defect: if the modal transaction scores at the ceiling, the
score cannot rank work. Scores MUST be validated against a labelled sample before
deployment (§9) and their distribution MUST be monitored in production.

**AML-ALT-5.** Where a score is described as a weight of evidence, it MUST be a
weight of evidence in the statistical sense (a log-odds contribution) or MUST be
renamed. Naming a weighted sum after a specific statistical construct misleads
model validators and is a documentation defect.

**AML-ALT-6.** Rule changes MUST be governed. A change to a detection rule,
threshold or suppression MUST be versioned, attributed to an author, reviewed by a
second party, and carry an effective date; and the system MUST record which rule
version produced any given alert. Independent testing of the AML program is required
at 31 CFR 1020.210(a)(2)(ii) and independent audit at MLR 2017 reg 21(1)(c), and
neither is possible if the rule that fired cannot be recovered [8][18].

## 7. Case lifecycle, SAR/STR and audit trail

**AML-CASE-1.** Suspicious activity MUST be reportable within the statutory
deadline, and the system MUST make the clock explicit. In the US the SAR must be
filed "no later than 30 calendar days after the date of the initial detection", with
"an additional 30 calendar days to identify a suspect" and a hard ceiling of "in no
case ... more than 60 calendar days" [5][4]. The system MUST record the initial
detection date as a first-class field, because every deadline is computed from it,
and MUST surface time remaining. Note a real drafting divergence to respect: NCUA's
rule at 12 CFR 748.1(d)(2)(i) says "more than 60 days", omitting "calendar" [5].

**AML-CASE-2.** Currency transaction reports MUST be filed within 15 days, per 31
CFR 1010.306(a)(1) [19].

**AML-CASE-3.** Reported amounts MUST be computed from the underlying transactions,
never derived from a risk score or any other proxy. A monetary field on a regulatory
report is an assertion of fact. Deriving it arithmetically from an internal score
produces a false statement on a filing.

**AML-CASE-4.** A report MUST NOT be filed automatically. The narrative is the
substance of a SAR and requires human judgement; the system's role is to assemble a
complete draft and to record who reviewed, amended and submitted it.

**AML-CASE-5.** The case file MUST retain the analyst's assessment whether or not it
resulted in a report. This is explicit in the EU 2024 package: AMLR Art 77(1)(b)
requires retention of the record of the Art 69(2) assessment "whether or not such
assessment results in a suspicious transaction report", and requires that records
"are not redacted" [17]. A no-report decision is precisely the decision an examiner
will test, so the system MUST make closing an alert without a report a recorded,
reasoned, attributable act.

**AML-CASE-6.** Confidentiality MUST be enforced in the product, not only in
policy. Disclosure of a SAR or of its existence is prohibited (31 CFR 1020.320(e),
resting on 31 U.S.C. 5318(g)(2)(A)(i)) [4], and the UK tipping-off offence is POCA
2002 s.333A, carrying three months on summary conviction and two years on
indictment [20]. The system MUST scope access to SAR content by role, MUST exclude
it from general search, export and notification paths, and MUST log every access.

**AML-CASE-7.** The system MUST support FIU response service levels. AMLR Art 69(1)
requires reply to an FIU request "within 5 working days", shortenable "including to
less than 24 hours", and Art 71(1) permits proceeding absent contrary instruction
"within 3 working days" [17]. UK moratorium arithmetic MUST likewise be
representable: POCA s.335(5) seven working days, s.335(6) 31 days, s.336A(4)
extensions of not more than 31 days each, and an absolute cap at s.336A(7) of "more
than 186 days (in total)" [20]. These are computable deadlines and belong in the
case model, not in a runbook.

**AML-CASE-8.** Every state transition, note, attachment, assignment and disclosure
MUST be recorded in an append-only audit trail bearing actor, timestamp and prior
value. Audit entries MUST NOT be editable or deletable through any interface.

## 8. Recordkeeping and retention

**AML-REC-1.** Records required by the BSA MUST be retained for five years. The rule
is unambiguous: 31 CFR 1010.430(d) — "All records that are required to be retained
by this chapter shall be retained for a period of five years" [21]. SAR copies and
supporting documentation are separately required to be retained five years from the
date of filing [4].

**AML-REC-2.** UK retention is five years under MLR 2017 reg 40(3), and the system
MUST also honour the ceiling most summaries omit: reg 40(4) provides that records
need not be kept "for more than 10 years" [22]. Retention policy MUST therefore be
expressible as a window with both a floor and a cap, not as an indefinite hold —
over-retention of personal data is itself a compliance problem.

**AML-REC-3.** Records MUST be sufficient to reconstruct the transaction. MLR 2017
reg 40(2)(b) states this directly [22]. Storing a decision without its inputs does
not satisfy it.

**AML-REC-4.** Retained records MUST be retrievable within a reasonable period. 31
CFR 1010.430(d) sets a reasonableness standard rather than a numeric SLA [21]; the
system SHOULD nonetheless publish a measured retrieval time so the institution can
evidence reasonableness.

**AML-REC-5.** The transaction that was scored MUST itself be persisted. A system
that evaluates and discards has no basis for aggregation (§3), no basis for
reconstruction (AML-REC-3) and no basis for reprocessing (AML-MOD-6). Operational
telemetry — request logs, traces — MUST NOT be mistaken for, or substituted for, the
AML record. Volume of logs is not evidence of retention.

**AML-REC-6.** Where the store of record is an embedded database, durability and
replication MUST conform to HIP-0302. Per-tenant embedded storage is compatible with
a five-year obligation only with an explicit durability story.

**AML-REC-7.** Records MUST be tenant-isolated at every read path. Multi-tenant
isolation on the organisation boundary is required by the Hanzo platform baseline,
and for AML data a cross-tenant read is simultaneously a data-protection breach and
a confidentiality breach under AML-CASE-6. Every endpoint that returns alert, case,
subject or report data MUST derive tenancy from the authenticated principal and MUST
NOT accept it from a client-supplied header or parameter.

## 9. Model governance and validation

**AML-MOD-1.** Any statistical or machine-learning component used in detection or
scoring MUST be governed as a model under HIP-0201 and the supervisory model risk
management guidance: Federal Reserve SR 11-7, OCC Bulletin 2011-12 and FDIC
FIL-22-2017 [23][24][25]. The guidance organises the discipline into three areas —
"(1) Model development, implementation, and use; (2) model validation; and (3)
governance, policies, and controls" — and requires "adequate governance,
development, documentation, testing, performance monitoring, validation, and
effective challenge" [26].

**AML-MOD-2.** Applicability is charter-dependent and MUST NOT be over-claimed. The
MRMG was not issued by the NCUA and does not apply to credit unions [26]. The 2021
interagency statement on model risk management for BSA/AML is FDIC FIL-27-2021, 9
April 2021, issued by the FDIC, Federal Reserve and OCC in consultation with FinCEN
and NCUA — the latter two are not co-issuers [27].

**AML-MOD-3.** In the EU, model risk management is already an express requirement:
AMLD4 Art 8(4)(a) requires "model risk management practices" as part of the
institution's policies and controls [28]. This is base text, not a 2024 amendment.

**AML-MOD-4.** Validation MUST be performed by parties independent of development,
MUST assess conceptual soundness as well as outcomes, and MUST be documented and
repeated on a defined cycle. The system MUST retain, per model version: the training
and evaluation datasets or their fingerprints, the performance metrics, the
validation report and the approval.

**AML-MOD-5.** Model performance MUST be measured with metrics appropriate to a
heavily imbalanced detection problem and MUST be reported as a distribution, not a
point. Confusion matrix, precision, recall and ROC/AUC on a held-out sample are the
minimum; accuracy alone MUST NOT be reported. Production drift MUST be monitored
against the validation baseline.

**AML-MOD-6.** The system MUST support reprocessing historical activity through a
changed model or rule set, so that the effect of a change can be measured before
deployment and exposure can be assessed after new intelligence arrives. Above-the-
line and below-the-line threshold testing depends on it.

**AML-MOD-7.** Rules and models MUST be promotable through environments with an
approval gate, and the promoted artefact MUST be immutable and identified in every
decision it produces.

## 10. Explainability

**AML-EXP-1.** For any alert, the system MUST be able to state, in terms a
non-engineer can act on: which detection fired, on what inputs, against what
threshold, at what time, under which rule version, and what contribution each
component made to the aggregate score. This is the operational meaning of
HIP-0230 in a regulated context.

**AML-EXP-2.** An alert MUST be reproducible. Given the retained inputs, re-running
the retained rule version MUST produce the same outcome. Any dependency that cannot
be pinned — a live rate, a mutable list, a cached aggregate — MUST be captured as a
value at decision time, not re-fetched at explanation time.

**AML-EXP-3.** Screening explanations MUST identify the matched list, the matched
record, the matched name form and the score. An aggregate such as a mean distance
across all matched records MUST NOT be the only value exposed to rule logic or to
the analyst, because it cannot answer "who did we match, and on which list". A
regulator's question is always about a specific designation.

**AML-EXP-4.** Where an unexplainable model contributes to a decision, the decision
MUST be attributable to explainable evidence sufficient on its own to justify the
action taken. A model score MAY prioritise work; it MUST NOT be the sole stated
basis for a filing.

**AML-EXP-5.** The rule authoring language MUST be reviewable by a compliance
reader. Where the language is general-purpose and compiled, the system MUST also
render the rule's intent in a constrained, human-readable form, and MUST sandbox
execution.

## 11. Performance and operability

**AML-OPS-1.** Real-time interdiction paths MUST publish a latency budget and MUST
be measured against it at p50 and p99 under representative concurrency, not at mean.
An interdiction control that is fast at concurrency 1 and serialises under load has
no usable capacity figure.

**AML-OPS-2.** Throughput MUST be reported together with the durable work performed
per transaction. A figure obtained while the system performs no durable write is not
comparable to one obtained while it archives, aggregates and screens, and MUST NOT
be presented as though it were.

**AML-OPS-3.** Memory MUST be bounded and MUST be measured under sustained load, not
only at idle. Unbounded in-process accumulation of alerts, cases or logs is a defect
regardless of headroom.

**AML-OPS-4.** The system MUST start unattended. It MUST NOT require an interactive
step, and MUST NOT attempt to launch a browser or any desktop process; on a server
or in a container that is at best inert and at worst a failure. Readiness MUST be
exposed as a health endpoint that reports not-ready until dependencies, including
loaded sanctions lists, are usable.

**AML-OPS-5.** Every background responsibility MUST state whether it is safe to run
in more than one instance. A component with no concurrency control is a scaling
ceiling and MUST be documented as one.

**AML-OPS-6.** Operational cost MUST be stated as the full dependency set required
to run — every process, datastore and broker — because that set, not the binary, is
what an institution must operate, secure, patch and prove.

**AML-OPS-7.** Authentication and authorisation MUST be enforced on every endpoint
that touches AML data, and the enforcement MUST be verified by negative tests that
would fail if the check were removed. Documentation asserting that endpoints are
authenticated MUST NOT be the only evidence that they are.

## 12. Conformance

An implementation claims conformance to this HIP by publishing, per requirement, a
test that fails when the requirement is violated. The following are mandatory
negative tests, chosen because each corresponds to a failure mode that presents as
working software:

1. **Boundary tests** at exactly the threshold value for every monetary rule, in
   both inclusive and exclusive directions (AML-TM-4).
2. **Stubbed-helper detection**: a test that enumerates rule dependencies and fails
   if any deployed, enabled rule depends on an unimplemented helper (AML-AGG-4).
3. **Empty-list detection**: a test that fails if a screening result is reported as
   clean while any configured list has zero records or a stale load timestamp
   (AML-SCR-3).
4. **Known-designation screening**: a test that asserts a hit against a name known
   to be on each configured list (AML-SCR-2, AML-SCR-3).
5. **Restart durability**: a test that raises an alert, restarts the process, and
   asserts the alert is still retrievable (AML-ALT-1).
6. **Tenant isolation**: for every data-returning endpoint, a test that authenticates
   as tenant B and asserts no record of tenant A is returned (AML-REC-7).
7. **Unauthenticated access**: for every endpoint, a test asserting rejection without
   credentials (AML-OPS-7).
8. **Score distribution**: a test that fails if a benign reference transaction
   produces a maximal score or any alert (AML-ALT-4).
9. **Reproducibility**: a test that re-evaluates a retained alert from retained
   inputs and asserts an identical outcome (AML-EXP-2).
10. **Report arithmetic**: a test that asserts a report's monetary total equals the
    sum of its constituent transactions (AML-CASE-3).
11. **Withdrawn-source detection**: a test that fails if any configured list URL does
    not return a parseable payload of the expected shape, run against every
    configured source rather than one (AML-SCR-2, AML-SCR-3).
12. **Homoglyph resistance**: a test that substitutes confusable characters into a
    known designated name and asserts the match still fires (AML-SCR-5). The UN
    list's populated original-script names are a ready-made corpus for this.
13. **Approximate-date handling**: a test asserting that a listed date qualified as
    approximate or as a range is compared as an interval, not as a point
    (AML-SCR-6a).
14. **Measure gating**: a test asserting that a designation carrying no asset-freeze
    measure does not cause payment interdiction (AML-SCR-2b).
15. **Weak-alias policy**: a test asserting weak aliases do not raise primary
    screening alerts but are present in adjudication context (AML-SCR-4b).

Requirements deliberately left incomplete, to be closed by the capability catalogue
rather than guessed at here:

- **AML-TM-9**, the typology catalogue. FinCEN publishes advisories that enumerate
  explicit red-flag indicators and request specific SAR key terms; these are the
  correct basis for a typology library. They are enumerable from
  `fincen.gov/resources/advisories`. No advisory number is asserted in this HIP
  because none was verified during drafting, and an unverified citation in a
  compliance specification is worse than an acknowledged gap.
- FATF numeric values. FATF's own publication host was unreachable from the drafting
  environment. This HIP therefore cites FATF Recommendations by number for the
  *obligation* but asserts no FATF numeric threshold or retention period. In
  particular, the FATF R.16 wire-transfer de-minimis figure and the R.11 retention
  period MUST be confirmed against the primary text before either is relied on. The
  US equivalents are verified and cited above and are the safe anchor in the
  interim.
- **The EU consolidated (CFSP) list format.** No EU field name, element name or
  access mechanism is asserted anywhere in this HIP, because none was verified.
  Unresolved: whether the legacy `webgate.ec.europa.eu/fsd/fsf` token-bearing URL
  remains valid, whether an open mirror exists on `data.europa.eu`, and the actual
  structure of `sanctionEntity`, `nameAlias`, `birthdate`, `identification` and the
  legal-basis reference. AML-SCR-2 states the requirement to ingest the EU list;
  the *how* is an open work item and MUST be closed before EU coverage is claimed.
- **NYDFS 23 NYCRR Part 504.** This is the strongest existing regulatory
  requirement to tune and validate a screening filter, and its text was not
  retrievable during drafting. No subsection is cited here. It SHOULD be obtained
  verbatim and folded into §4 and §9, and it may impose obligations on New York
  regulated institutions beyond what this HIP currently states.
- **FFIEC BSA/AML Examination Manual** sections on above-the-line and below-the-line
  threshold testing were not reached, and AML-MOD-6 is therefore stated in general
  terms rather than against the examiners' own wording.

## 13. Relationship to the capability catalogue

This HIP is the specification. The engine's capability catalogue is the inventory of
what is implemented. They MUST agree on three things, and the agreement MUST be
mechanical rather than editorial:

1. **Identifiers.** Requirement IDs in this HIP are the join key. Each catalogue
   entry MUST cite the requirement it satisfies; each requirement MUST resolve to
   zero or more catalogue entries. An unreferenced requirement is an open gap, and
   the count of unreferenced requirements is the headline compliance metric.
2. **Status vocabulary.** A capability is *implemented* only if a conformance test
   from §12 exists and passes. "Present in the codebase" is not a status. A rule
   whose helpers are stubbed MUST be catalogued as not implemented, however
   complete its definition looks.
3. **Jurisdiction.** Every catalogue entry MUST state the jurisdictions it covers,
   because §2 and §5 establish that superficially equivalent obligations differ by
   jurisdiction and by charter.

Where the catalogue and this HIP disagree, the HIP is authoritative as to what is
required and the catalogue is authoritative as to what exists. Neither may be edited
to conceal the difference.

## 14. Questions requiring a compliance SME

The following are not engineering decisions, and this HIP does not decide them. Each
requires a qualified compliance officer or counsel for the institution in question,
because each turns on the institution's own risk appetite, charter and regulator.

1. **Threshold calibration.** What alert thresholds and score cut-offs are
   appropriate. FATF sets no number by design; a vendor default is not a control
   (AML-AGG-3).
2. **Typology coverage sufficiency.** Which typologies a given institution must
   cover, and whether the deployed rule set is adequate to its risk assessment.
3. **Screening threshold and false-positive tolerance.** Where to set fuzzy-match
   thresholds. This is an explicit trade-off between missed designations and
   investigator load, and it is the institution's to make. No credible public
   false-positive benchmark was identified during drafting, so this cannot be
   settled by reference to an industry figure.
4. **Whether an alert is suspicious.** The judgement that triggers a filing, and the
   sufficiency of any narrative.
5. **Model validation adequacy** and validator independence, including whether the
   MRMG applies at all given charter (AML-MOD-2).
6. **Retention and deletion policy** reconciling the five-year floor against the UK
   ten-year cap and applicable data-protection law (AML-REC-2).
7. **Jurisdictional applicability** — which of these regimes bind a given deployment,
   and the treatment of the EU transition to 10 July 2027.

## References

Citations verified against primary sources during drafting are marked (verified).
Citations recorded from a secondary or paraphrasing source are marked as such.

1. Request for Information on the extent to which model risk management principles
   support BSA/AML compliance, 86 FR (doc 2021-07428), footnote 4 (verified) —
   https://www.federalregister.gov/documents/full_text/text/2021/04/12/2021-07428.txt
2. 31 CFR 1010.410(e), (f) — funds transfer recordkeeping and the Travel Rule,
   "$3,000 or more" (verified) —
   https://www.ecfr.gov/api/versioner/v1/full/2026-07-01/title-31.xml?part=1010
3. 31 CFR 1020.410(a) — bank funds transfer recordkeeping (verified) —
   https://www.ecfr.gov/api/versioner/v1/full/2026-07-01/title-31.xml?part=1020
4. 31 CFR 1020.320 — reports by banks of suspicious transactions; (a)(2) "at least
   $5,000"; (b)(3) "no later than 30 calendar days"; five-year retention of the SAR
   copy and supporting documentation; (e) confidentiality resting on 31 U.S.C.
   5318(g)(2)(A)(i) (verified) —
   https://www.ecfr.gov/api/versioner/v1/full/2026-07-01/title-31.xml?part=1020&section=1020.320
5. 12 CFR 21.11(c), (d) (OCC); 12 CFR 353.3 (FDIC); 12 CFR 208.62 (Federal
   Reserve); 12 CFR 748.1(d) (NCUA) — tiered SAR thresholds, the 30/60-day
   deadlines, and NCUA's "60 days" divergence (verified) —
   https://www.ecfr.gov/api/versioner/v1/full/2026-07-01/title-12.xml?part=21
6. FATF, International Standards on Combating Money Laundering and the Financing of
   Terrorism & Proliferation — the FATF Recommendations. Cited by Recommendation
   number for R.1, R.6, R.7, R.10, R.11, R.12, R.13, R.16, R.18, R.20.
   **Numeric values not verified** — host unreachable during drafting; see §12 —
   https://www.fatf-gafi.org/en/publications/Fatfrecommendations/Fatf-recommendations.html
7. Money Laundering, Terrorist Financing and Transfer of Funds (Information on the
   Payer) Regulations 2017, SI 2017/692, reg 18 — risk assessment (verified) —
   https://www.legislation.gov.uk/uksi/2017/692/regulation/18
8. 31 CFR 1020.210(a)(2)(v)(B) ongoing monitoring; (a)(2)(ii) independent testing
   (verified) —
   https://www.ecfr.gov/api/versioner/v1/full/2026-07-01/title-31.xml?part=1020
9. SI 2017/692 reg 28(11) — ongoing monitoring (verified) —
   https://www.legislation.gov.uk/uksi/2017/692/regulation/28
10. 31 U.S.C. 5324 and 31 CFR 1010.314 — structuring (verified) —
    https://www.ecfr.gov/api/versioner/v1/full/2026-07-01/title-31.xml?part=1010
11. 31 CFR 1010.311 — "a transaction in currency of more than $10,000" (verified) —
    https://www.ecfr.gov/api/versioner/v1/full/2026-07-01/title-31.xml?part=1010&section=1010.311
12. 31 CFR 1010.313(b) — aggregation "by or on behalf of any person" (verified) —
    https://www.ecfr.gov/api/versioner/v1/full/2026-07-01/title-31.xml?part=1010
13. OFAC, Revised Guidance on Entities Owned by Persons Whose Property and Interests
    in Property Are Blocked (the 50 Percent Rule) — cited for the obligation;
    URL not re-verified during drafting —
    https://ofac.treasury.gov/faqs/topic/1521
14. SI 2017/692 reg 35(9)(a) — PEP tail, "at least 12 months" (verified) —
    https://www.legislation.gov.uk/uksi/2017/692/regulation/35
15. 31 CFR 1010.230 — beneficial ownership / CDD rule (verified) —
    https://www.ecfr.gov/api/versioner/v1/full/2026-07-01/title-31.xml?part=1010
16. SI 2017/692 reg 33, incl. reg 33(1)(f) — enhanced due diligence (verified) —
    https://www.legislation.gov.uk/uksi/2017/692/regulation/33
17. Regulation (EU) 2024/1624 (AMLR), Arts 26(2), 69(1), 69(2), 71(1), 77(1)(b);
    applies from 10 July 2027 (verified) —
    https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=OJ:L_202401624
18. SI 2017/692 reg 21(1)(c) — independent audit (verified) —
    https://www.legislation.gov.uk/uksi/2017/692/regulation/21
19. 31 CFR 1010.306(a)(1) — CTR filed within 15 days (verified) —
    https://www.ecfr.gov/api/versioner/v1/full/2026-07-01/title-31.xml?part=1010
20. Proceeds of Crime Act 2002, ss.327–330, 333A, 335(5), 335(6), 336A(4), 336A(7)
    (verified) — https://www.legislation.gov.uk/ukpga/2002/29/contents
21. 31 CFR 1010.430(d) — "shall be retained for a period of five years" (verified) —
    https://www.ecfr.gov/api/versioner/v1/full/2026-07-01/title-31.xml?part=1010&section=1010.430
22. SI 2017/692 reg 40(2)(b), 40(3), 40(4) — reconstruction, five years, ten-year cap
    (verified) — https://www.legislation.gov.uk/uksi/2017/692/regulation/40
23. Federal Reserve SR 11-7, Guidance on Model Risk Management — body not extracted
    verbatim during drafting; see [26] —
    https://www.federalreserve.gov/supervisionreg/srletters/sr1107.htm
24. OCC Bulletin 2011-12, Sound Practices for Model Risk Management —
    https://www.occ.gov/news-issuances/bulletins/2011/bulletin-2011-12.html
25. FDIC FIL-22-2017, Adoption of Supervisory Guidance on Model Risk Management
    (verified by title) —
    https://www.fdic.gov/news/financial-institution-letters/2017/fil17022.html
26. 86 FR (doc 2021-07428) — the three MRMG areas and the MRMG principles are quoted
    from this Federal Register document, not from SR 11-7 itself; footnote 3 states
    the MRMG does not apply to credit unions (verified) —
    https://www.federalregister.gov/documents/full_text/text/2021/04/12/2021-07428.txt
27. FDIC FIL-27-2021, Interagency Statement on Model Risk Management for Bank
    Secrecy Act/Anti-Money Laundering Compliance, 9 April 2021 (verified) —
    https://www.fdic.gov/news/financial-institution-letters/2021/fil21027.html
28. Directive (EU) 2015/849 (AMLD4) Art 8(4)(a) — "model risk management practices"
    (verified, consolidated text CELEX 02015L0849-20240709) —
    https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:02015L0849-20240709
29. Regulation (EU) 2023/1113 — information accompanying transfers of funds and
    certain crypto-assets; applies from 30 December 2024; beneficiary elements at
    Art 14(2); no de-minimis for crypto-asset transfers (verified) —
    https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32023R1113
30. Directive (EU) 2024/1640 and Directive (EU) 2018/1673 — cite by CELEX
    (32024L1640, 32018L1673) rather than "AMLD6", which is ambiguous between them
    (verified) — http://publications.europa.eu/resource/celex/32024L1640
31. SI 2026/621, Money Laundering and Terrorist Financing (Amendment) Regulations
    2026 — reg 32 substitutes "£800" for "1,000 euros" in reg 64C(4) in force
    30 June 2026; new reg 34A commences 1 February 2027 (verified) —
    https://www.legislation.gov.uk/uksi/2026/621/regulation/32
32. *(superseded by [44])*
33. ICAO Doc 9303, Machine Readable Travel Documents, 8th edition 2021, Part 3 —
    name transliteration and MRZ rules. **Document identity verified; canonical URL
    not retrievable during drafting** (icao.int paths returned 404).
34. HIP-0201 Model Risk Management; HIP-0230 AI Transparency & Explainability;
    HIP-0302 Hanzo Replicate — Encrypted SQLite Durability for Base Services.
35. gov.uk content API, `financial-sanctions-consolidated-list-of-targets` —
    withdrawn 2026-01-28T10:40:06Z; "The OFSI Consolidated List has closed. From
    28 January 2026 the UK Sanctions List is the only source for all UK sanctions
    designations" (verified) —
    https://www.gov.uk/api/content/government/publications/financial-sanctions-consolidated-list-of-targets
36. FCDO UK Sanctions List — canonical exports at
    https://sanctionslist.fcdo.gov.uk/docs/UK-Sanctions-List.xml (and .csv/.ods/.pdf);
    schema and field names incl. `UniqueID`, `IndividualEntityShip`,
    `Names/Name/{Name1..Name6,NameType,AliasStrength}`, `NonLatinNames`,
    `SanctionsImposedIndicators/*`, `RegimeName`, `DesignationSource` (verified) —
    https://www.gov.uk/api/content/government/publications/the-uk-sanctions-list
37. OFAC Sanctions List Service export surface and file manifests (verified) —
    https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/
38. OFAC delta file schema, namespace
    `https://www.treasury.gov/ofac/DeltaFile/1.0`, carrying
    `action="add|remove|update"`; RSS feed retired 31 January 2025 (verified) —
    https://www.treasury.gov/ofac/downloads/sanctions/1.0/DeltaFile.xsd and
    https://ofac.treasury.gov/sdn-list-data-formats-data-schemas/ofac-technical-actions-in-reverse-chronological-order
39. OFAC Sanctions List Search FAQs — FAQ 249 (Jaro-Winkler + Soundex, 50% edit
    distance prefilter, higher of the two scores), FAQ 250 (OFAC will not recommend
    a threshold), FAQ 892 (unnamed third algorithm added 2021-01-25), FAQ 287 (the
    tool is not for automated repeated querying), FAQ 5 (hit-adjudication steps)
    (verified) — https://ofac.treasury.gov/faqs/topic/1636
40. Wolfsberg Group, Guidance on Sanctions Screening (2019) — §3.1 risk-based levers
    and documented threshold rationale; §3.4 independent testing and treatment of the
    screening application as a model; §3.6 non-Latin support as a selection
    criterion; §6.3 weak aliases; §7 lookbacks (verified) —
    https://db.wolfsberg-group.org/assets/29c751c6-f406-4329-a267-1b05aabdd241/Wolfsberg%20Guidance%20on%20Sanctions%20Screening.pdf
41. OFAC, A Framework for OFAC Compliance Commitments (May 2019), Appendix root
    cause VI, "Sanctions Screening Software or Filter Faults" (verified) —
    https://ofac.treasury.gov/media/16331/download?inline
42. Unicode UAX #15, Unicode Normalization Forms (rev 57) (verified) —
    https://www.unicode.org/reports/tr15/
43. Unicode UTS #10, Unicode Collation Algorithm (rev 53, Unicode 17.0.0)
    (verified) — https://www.unicode.org/reports/tr10/
44. Unicode UTS #39, Unicode Security Mechanisms (rev 32, Unicode 17.0.0)
    (verified) — https://www.unicode.org/reports/tr39/
45. Unicode confusables data file (verified) —
    https://www.unicode.org/Public/security/latest/confusables.txt
46. OFAC Advanced Sanctions Data Model XML explanatory notes — `DistinctParty` /
    `Profile` / `Alias` / `DocumentedName` structure, script and reference value
    sets, `DatePeriod` approximation flags (verified) —
    https://ofac.treasury.gov/media/10391/download?inline
47. OFAC FAQ 398 — the 50 Percent Rule turns on ownership, not control (verified) —
    https://ofac.treasury.gov/faqs/398
48. OFAC FAQ 401 — indirect and aggregated ownership, with worked examples
    (verified) — https://ofac.treasury.gov/faqs/401
49. Jaro, M.A. (1989), *JASA* 84(406):414–420, DOI 10.1080/01621459.1989.10478785;
    Winkler, W.E. (1990), ERIC ED325505, https://files.eric.ed.gov/fulltext/ED325505.pdf;
    Damerau, F.J. (1964), *CACM* 7(3):171–176, DOI 10.1145/363958.363994; Soundex
    coding rules, US National Archives, https://www.archives.gov/research/census/soundex
    (all verified). Levenshtein (1966), Fellegi & Sunter (1969), Metaphone and
    Double Metaphone are **not** verified to a citable primary source; where an
    implementation uses Double Metaphone it SHOULD be cited by reference
    implementation rather than by paper.
