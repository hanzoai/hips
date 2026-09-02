---
hip: "0518"
title: AML — The Obligation Plane
author: Hanzo AI Team
type: Standards Track
category: Interface
status: Final
created: 2026-07-29
requires: HIP-0106, HIP-0111, HIP-0302
---



# HIP-0518: AML — The Obligation Plane

## Abstract

`/v1/aml` monitors transactions for money laundering and terrorist financing, screens
parties against sanctions and PEP lists, and carries an alert to a filed report. Every
control it implements exists because a named instrument requires it, and this document
records which one. That mapping is the product: a compliance buyer does not ask whether
the engine is fast, they ask which obligation each rule discharges, and an auditor asks
the same question in the same words.

The engine is a Go module served from the unified cloud binary, one static artifact with
an embedded UI and a per-org SQLite store. It is not a separate deployment.

## Motivation

A transaction-monitoring system is a **control someone points at a regulator**. That
makes it different from the rest of the platform in one specific way: a false negative
is not a bug report, it is the customer's regulatory exposure. So the requirement is not
"detect suspicious activity" — it is *detect what these instruments say must be
detected, and be able to show that you do*.

The failure mode this HIP exists to prevent is a plausible engine with no provenance: a
rule library assembled from intuition, thresholds chosen because they looked reasonable,
and no answer to "which recommendation is that?". Such a system can work and still be
unsellable.

The second failure mode is the opposite: treating volume as evidence. The Wolfsberg
Group states plainly that the value derived from the constantly increasing volume of
SARs/STRs does not contribute proportionately to effective outcomes, and that the
industry should pivot away from prescriptive rules-based routines toward a true
risk-based approach.[^w-msa1] An engine that maximises alerts is optimising the wrong
number.

## Specification

### 1. What must be monitored, and continuously

Ongoing monitoring is the load-bearing obligation and it is stated almost identically on
both sides of the Channel.

**EU** — CDD comprises "conducting ongoing monitoring of the business relationship
including scrutiny of transactions throughout the relationship to ensure consistency
with knowledge of the customer, the business and risk profile, including where necessary
the source of funds".[^d4-13-1-d] The 2024 Regulation restates it and adds a purpose:
detecting transactions to be made subject to a more thorough assessment.[^amlr-26-1]

**UK** — the relevant person must conduct ongoing monitoring including "scrutiny of
transactions undertaken throughout the course of the relationship (including, where
necessary, the source of funds) to ensure the transactions are consistent with the
relevant person's knowledge of the customer, the customer's business and risk
profile".[^mlr-28-11]

Two consequences the engine must implement rather than approximate:

- **Consistency is relative to a profile.** The comparison is against what is known
  about *this* customer, not against a global threshold. A customer profile is therefore
  a first-class stored object, not a derived convenience.
- **Monitoring feeds back into the profile.** The FCA states this as good practice
  directly: feed monitoring findings back into the customer risk profile.[^fcg-3-2-5g]
  Wolfsberg makes it a requirement for correspondent relationships — the results of
  suspicious-activity monitoring must be factored back into the periodic review, and the
  relationship between due-diligence information and transaction monitoring is
  *continuous* throughout the life of the relationship.[^w-cb-6]

### 2. Refresh cadence is a hard number, not a policy

The AMLR sets ceilings the engine must enforce rather than recommend: customer
information updates must not exceed **1 year** for higher-risk customers subject to
enhanced due diligence, and **5 years** for all other customers.[^amlr-26-2]

Event-driven triggers sit on top of the ceiling: a change in relevant customer
circumstances; a legal duty in the calendar year to contact the customer about
beneficial owners; or becoming aware of a relevant fact.[^amlr-26-3]

Sanctions verification is **separate** from CDD refresh and has its own cadence:
commensurate with exposure, and for credit and financial institutions **upon any new
designation**.[^amlr-26-4]

### 3. Thresholds, and the one that does not exist

| Trigger | EU | UK |
|---|---|---|
| Occasional transaction | EUR 10 000 (was 15 000)[^amlr-19-1b] | £12 000[^mlr-27-2] |
| Transfer of funds | EUR 1 000[^amlr-19-2] | £800[^mlr-27-1] |
| Cash (identification only) | EUR 3 000[^amlr-19-4] | — |
| High-value dealer, cash | EUR 10 000[^d4-11-c] | £10 000[^mlr-27-3] |
| Gambling | EUR 2 000[^amlr-19-5] | £2 000[^mlr-27-5] |
| Crypto transfer | EUR 1 000 full CDD; identification below[^amlr-19-3] | £800[^mlr-27-7e] |
| **Crypto travel rule** | **no threshold at all**[^tfr-14] | — |

That last row is the one implementations get wrong. Articles 14(1) and 14(2) of the
Transfer of Funds Regulation apply to crypto-asset transfers **without any value
threshold**, in deliberate contrast to the EUR 1 000 thresholds that govern transfers of
funds.[^tfr-14] An engine that applies a de-minimis to crypto is non-compliant by
construction.

Thresholds apply to single **or linked** operations throughout. AMLA is due to specify
the criteria for identifying linked transactions by 10 July 2026,[^amlr-19-9] so the
engine must treat linkage as a configurable predicate rather than a hardcoded window.

**Structuring** is the reason linkage matters. EBA guidance names it directly: the
unusual-transaction test includes transactions *split to circumvent reporting
limits*.[^eba-4-60] Detection therefore requires rolling-window aggregation, not
point-in-time comparison.

### 4. What makes a transaction unusual

The statutory trigger is four independent conditions, and AMLD5 split them apart
precisely so they could not be read cumulatively: transactions that are (i) complex,
(ii) unusually large, (iii) conducted in an unusual pattern, or (iv) have no apparent
economic or lawful purpose.[^d5-18-2] The UK carries the same four.[^mlr-19-4]

The AMLR adds what must then be examined: the **origin and destination** of funds and
the purpose.[^amlr-34-2]

The statutory basis of a *suspicion* is enumerated, and it is broader than any single
transaction: characteristics of the customer and their counterparts; size and nature;
the **methods and patterns**; the **link between several** transactions; origin,
destination or use of funds; and consistency with the client risk profile.[^amlr-69-2]

EBA guidance operationalises "unusual" as deviation in amount, frequency, complexity or
similar — including unusually frequent small amounts and successive transactions without
obvious economic rationale.[^eba-4-60] JMLSG adds **peer-group comparison** and
**networks of connected persons** as monitoring axes alongside the customer's own
profile.[^jm-5-7-5]

### 5. Detection architecture the regulators actually ask about

These are not implementation suggestions; they are the questions a supervisor asks.

**Real-time versus after-the-event.** Firms must determine which transactions are
monitored in real time and which ex-post, including which high-risk factors or
combinations *always* trigger real-time monitoring.[^eba-4-74a] JMLSG frames the same
choice and notes either is acceptable provided the objective — flagging for further
examination — is met.[^jm-5-7-4]

**The three essentials.** JMLSG reduces any monitoring system to three: it flags
transactions or activities for further examination; those reports are reviewed
**promptly** by the right person; and appropriate action is taken on the
findings.[^jm-5-7-3] An engine that satisfies the first and not the second has not
implemented monitoring.

**Alert thresholds are governed, not tuned.** The alert level must **not** be set merely
to fit existing staff numbers, nor generate large volumes of unproductive alerts
requiring excessive resource. A governance mechanism must oversee, review and approve
monitoring parameters, with documented rationale, measured effectiveness, and explicit
governance of turning off or dialling down less efficient parameters.[^jm-5-7-20]

**Override must exist.** Firms must be able to override an automatically generated risk
score, with a documented rationale.[^eba-3-6] Weighting must not be driven by a single
factor or by profit, and must not make high-risk classification impossible.[^eba-3-6]

**Bought-in systems do not transfer responsibility.** Where risk scoring uses a
purchased system, the firm must understand how it works and how it weights factors, and
must demonstrate to the competent authority that the scores reflect *its own*
understanding of risk.[^eba-3-7] Wolfsberg says the same of AI/ML: the institution is
responsible regardless of whether systems are developed in-house or sourced
externally.[^w-ai-4]

**Ex-post sampling is required.** Irrespective of automation level, firms should
regularly perform ex-post reviews on a **sample of all processed transactions** — to
identify trends and to *test and improve* the monitoring system.[^eba-4-75]

**Decommissioning needs justification.** The FCA treats retiring a rule set as a
governed act: it must be justified against performance outcomes including alert
intelligence-value and false-positive proportion.[^fcg-3-2-5a]

**Monitor at multiple levels of aggregation** — transaction, account, customer, and
linked-entity.[^fcg-3-2-5a]

### 6. Explainability is a hard requirement

A regulator asks *why* an alert fired, and the answer must be produced from the system.

JMLSG requires the firm to understand the workings and rationale of the system and **the
reasons for its alerts**, because it may be asked to explain them to the
regulator.[^jm-5-7-15] Its system-selection criteria include functionality to give the
user the reason a transaction alerted, with a full evidential process, and to implement
and **test new typologies before live activation**.[^jm-5-7-18]

For machine-learning detection, Wolfsberg is more specific and this constrains any
behavioural-scoring design: because a model output is a **probability**, there is a risk
appetite question of how likely the model is to *miss* suspicious activity — the
equivalent of below-the-line testing — and that appetite must be explained and agreed so
the model has a clear objective and tolerance.[^w-msa2-usage] When outputs go to
investigation there is *always* a need to explain why an alert was generated,
illustrated by the features that influenced the output, the risk associated with those
features, and the risk indicators behind them.[^w-msa2-usage]

And risk coverage must be demonstrable: where rules map risk indicators to typologies,
ML maps typologies to **data features**, so a **mapping inventory** of risk
indicators/typologies to features is required as evidence of coverage.[^w-msa2-cov]
Model variables must be not only statistically significant but **contextually
meaningful**, grounded in a specific risk assessment.[^w-msa2-cov]

**Consequence for this engine.** Behavioural or statistical scoring is admissible and is
where the industry is going — but only behind the mapping inventory, the stated
miss-rate appetite, and per-alert feature attribution. A model that cannot say which
feature fired and which typology that feature serves is not deployable here regardless
of its accuracy.

### 7. Sanctions and PEP screening

Screening is "the comparison of one string of text against another to detect
similarities suggesting a possible match", run over customer *and transactional*
records.[^w-scr-1] Critically: **the generation of an alert is not itself an indication
of sanctions risk** — it is the first step.[^w-scr-1]

**Fuzzy matching must be available and its degree calibrated.** Matching parameters must
be defined per measure by checking true-positive thresholds at different matching
percentages — neither too sensitive nor insufficiently sensitive — decided *before*
developing a new screening system and periodically thereafter, with documented rationale
available on request.[^eba-rm-24]

**Minimum fields.** For naturals: name in original script and/or transliteration, plus
date of birth. For legal persons: name in original and/or transliteration. Plus other
names, aliases, trade names, and **wallet addresses** where the lists carry
them.[^eba-rm-17] Screening must extend to beneficial owners through ownership interest,
beneficial owners through control, and any person purporting or authorised to
act.[^eba-rm-18]

**Trigger events** must at least include: a new or changed designation entering into
force; onboarding; a significant change in CDD data (name, residence, nationality,
business operations); and reasonable grounds to suspect circumvention.[^eba-rm-16]

**Transaction screening minimum data**: payer/payee, originator/beneficiary, the
**purpose** of the transfer and other **free-text** fields, and details of intermediary
institutions and correspondents including BIC/SWIFT codes.[^eba-rm-20]

**Timing** — PSPs must screen before making funds available to the payee; CASPs before
making crypto-assets available to the beneficiary.[^eba-rm-19]

**Circumvention detection** is its own control surface: attempts to omit, delete or
alter payment-message information; channelling through connected persons; **structuring
transfers to conceal a designated party**; concealing beneficial ownership; counterfeit
documentation.[^eba-rm-45] Highly exposed firms should perform **aggregated** analysis of
flows to and from sanctioned countries and known circumvention corridors.[^eba-rm-46]

**Where identification remains impossible** after using all held and obtainable
information, the firm must **refrain** from providing the service.[^eba-rm-34]

Whitelisting to suppress repeat false positives is permitted, but reasons must be
documented and the list reviewed immediately on a new or amended measure or a change in
customer information.[^eba-rm-13]

#### 7.1 The EU consolidated list — measured, not assumed

The EU Financial Sanctions File was ingested and parsed to establish the contract. These
facts are load-bearing and each one is a trap for an implementation that assumes
otherwise.

- **Ingest XML 1.1** (`xmlFullSanctionsList_1_1`) against `xsdFullSanctionsList_1_1`. The
  1.0→1.1 delta is exactly one attribute — `sanctionEntity@euReferenceNumber` — which is
  the only unique, stable, citable business key. Both XSDs have been frozen since 2017.
- **`strong="true"` on every single alias** — 30 306 of 30 306, one distinct value. The
  schema documents it as marking the primary name. **In the published data it carries
  zero information.** It is *not* an OFAC-style strong/weak alias quality flag and it
  does not identify a primary name.
- **There is no primary-name marker at all.** The Commission's own PDF prints every name
  as a peer. Treat all aliases as equal-weight variants; if a display name is needed,
  prefer the first with `nameLanguage="EN"` and structured parts, then document order.
- **`logicalId` is scoped per element type, not globally unique** — 420 collisions
  between `sanctionEntity` and `nameAlias` alone. Key on `(elementType, logicalId)` or
  records silently merge.
- **`unitedNationId` is populated on 87 of 6 017 entities.** Absence does not mean "not
  UN-listed", and it is not unique. It is not a reliable cross-reference.
- **Vessels are `enterprise` records** carrying an `imo` identification type. There is no
  aircraft type at all.
- **Country sentinel `00` = UNKNOWN** appears in birthdate, identification and address
  records and must be special-cased or it pollutes country joins.
- **Partial dates are omitted, not empty-stringed** — use presence tests, not `!= ""`.
  Shapes observed: full date; year only; year range; year+month; place with no date.
- **No delta file and no delisting history exist.** `delistingDate` is in the schema and
  never emitted; delisted entities simply vanish from the next snapshot. Deltas must be
  computed by diffing consecutive snapshots on `euReferenceNumber`, and **we must retain
  our own snapshot archive** because the EU publishes none.
- **Poll the RSS feed, not the file.** It carries a SHA-1 per file; conditional GET does
  not work (always 200 + full 24 MB) and range requests are unsupported. Gate on the
  checksum, then download in full.
- Only the Regulation is cited, never the CFSP Decision; the `programme` code→label map
  exists **only in the PDF**.

### 8. From alert to filed report

**EU.** Report promptly to the FIU where there is knowledge, suspicion or reasonable
grounds to suspect, **regardless of amount**,[^d4-33-1a] and **all** suspicious
transactions **including attempted** ones.[^d4-33-1-fin] Suspicions arising from the
*inability to conduct CDD* must also be reported.[^amlr-69-1-2] FIU information requests
carry a **5 working day** response deadline, shortenable to under 24 hours in justified
urgent cases.[^amlr-69-1] After filing, the firm may proceed if no contrary FIU
instruction arrives within **3 working days**.[^amlr-71-1]

Assessment must be **prioritised** by urgency and by the risks affecting the Member
State of establishment.[^amlr-69-2-1]

**UK.** The POCA clock is exact and the engine must model it rather than approximate it:

- **Notice period = 7 working days**, starting with the *first working day after* the
  disclosure is made.[^poca-335-5]
- **Moratorium = 31 days**, starting with the day the refusal notice is
  **received**.[^poca-335-6]
- Court extensions run in blocks ending no later than **31 days** after the period would
  otherwise end,[^poca-336a-4] capped in **aggregate at 186 days** on top of the initial
  31 — a maximum total of **217 days**.[^poca-336a-7]
- A **working day** excludes weekends, Christmas Day, Good Friday and bank holidays in
  the relevant UK part.[^poca-335-7]
- **There is no moratorium for a refused DATF** — no defence exists unless and until the
  request is granted.[^ukfiu-14]
- Where the UKFIU closes a deficient request, the statutory timeframe **restarts** on
  resubmission.[^ukfiu-12]

**Tipping off** is a criminal offence on both sides and constrains the UI: no disclosure
that a report has been or will be made, or that an analysis is under way.[^d4-39]
[^poca-333a] CDD may be *ceased* where continuing it would tip off.[^mlr-28-14] The
engine must therefore be able to suppress customer-visible signals on a case, and that
suppression is itself an audited state.

**Non-reporting must be recorded.** This is the requirement most systems miss. The AMLR
requires retention of a record of the Article 69(2) assessment — the information and
circumstances considered and the results — **whether or not it resulted in an
STR**.[^amlr-77-1b] JMLSG: if the nominated officer decides not to report, the reasons
must be clearly documented and retained with the internal suspicion report.[^jm-6-32]
Records must cover **information not acted upon**.[^jm-8-6] And the compliance officer
must regularly consider **why alerts were not escalated**.[^co-52g]

So a dismissed alert is not a deleted row. It is a retained decision with its rationale.

### 9. Records

- **5 years** from end of relationship, from the occasional transaction, **or from the
  date of refusal** to enter a relationship or carry out a transaction.[^amlr-77-3]
- Deletion on expiry; case-by-case extension capped at a further **5 years**.[^d4-40-1-2]
- **Records must not be redacted.**[^amlr-77-1-fin]
- UK: sufficient supporting records to **enable the transaction to be
  reconstructed**;[^mlr-40-2b] retention 5 years, and in-relationship transaction records
  need not be kept beyond **10 years**.[^mlr-40-4]
- Personal data may be used **only** for ML/TF prevention; processing for commercial
  purposes is **prohibited**.[^d4-41-2]
- Systems must answer, fully and speedily, whether a relationship with a named person is
  or was maintained in the prior **five years**, and its nature, over secure and
  confidential channels.[^amlr-78]

That last one is a design constraint, not a report: it implies an indexed party graph
over historical relationships, not a log scan.

### 10. Surface

All routes are org-scoped and live under `/v1/aml`. There is no `/api/` prefix and there
will be no `v2`.

```
POST /v1/aml/transactions        ingest and score
GET  /v1/aml/rules               the rule library, each rule citing its instrument
POST /v1/aml/rules/test          dry-run a rule against history before activation
GET  /v1/aml/sanctions/search    list screening
     /v1/aml/cases               investigation lifecycle through report
GET  /v1/aml/health
```

`/v1/aml/rules/test` is not a convenience. JMLSG requires functionality to implement and
**test new typologies before live activation**.[^jm-5-7-18]

### 11. Vocabulary

We say **monitoring for suspicious activity**, not transaction monitoring. The narrower
term excludes what the obligation includes. Wolfsberg makes the point exactly: customer
behaviour and customer attributes *combined with* transactions give broader insight, and
transaction monitoring is a **sub-set** of monitoring for suspicious activity — which
also covers ongoing CDD and can extend to employee, vendor or counterparty
activity.[^w-msa1] The UK's own guidance places transaction monitoring inside a section
titled "Monitoring customer activity", not in a chapter of its own.[^jm-5-7]

## Rationale

**Why cite everything.** Because the citation is the product feature. Coverage claimed
without provenance cannot be audited, and an AML control that cannot be audited has
negative value to the buyer.

**Why not fail-open on a cap check.** Elsewhere in this platform, metering deliberately
fails open so a slow dependency never blocks a completion. That trade is correct for
billing and wrong here: a monitoring control that fails open produces a clean receipt for
an unexamined transaction. Where this engine cannot complete a required check it must
refuse or queue, never pass silently. The sanctions instruments say this directly — where
unambiguous identification is impossible, **refrain**.[^eba-rm-34]

**Why in-process.** Per HIP-0106 the engine mounts into the one cloud binary. A separate
deployment would add a port, a Service, a NetworkPolicy and a cross-namespace hop — each
an independent way for a compliance control to become unreachable while appearing
healthy.

**Why per-org SQLite.** Per HIP-0302 the org boundary is physical: a query in one org's
file cannot reach another org's rows. For a system holding suspicion records about named
individuals, a logical tenant filter is a weaker guarantee than a separate file.

## Open questions

These are stated rather than guessed, because each needs a decision this document cannot
make.

1. **Behavioural/statistical detection.** Mature products pair rules with behavioural
   scoring because pure rules miss novel patterns and generate the false-positive volume
   compliance teams complain about. §6 sets the admission price: mapping inventory,
   stated miss-rate appetite, per-alert feature attribution. Whether to pay it now is a
   product decision.
2. **Which typologies ship first.** The FinCEN advisory corpus alone yields well over a
   hundred citable red-flag indicators across ransomware, virtual-currency abuse,
   fentanyl procurement, pig-butchering, deepfake onboarding fraud, mule schemes and
   unemployment-insurance fraud. Sequencing needs a target customer.
3. **Model governance.** Model risk management appears in the AMLD4 policy list
   itself,[^d4-8-4a] so it is an obligation and not an aspiration. Whose function owns
   validation is unresolved.
4. **A compliance SME must review this.** Every citation here was read from a primary
   document, but reading an instrument is not the same as knowing how a supervisor
   applies it. This HIP is engineering-complete and compliance-unreviewed, and it should
   not be represented otherwise.

## Provenance note

Sources were retrieved directly from primary publishers and read as text — EUR-Lex and
the CELLAR endpoint, legislation.gov.uk, EBA, FCA, JMLSG, NCA/UKFIU, the Wolfsberg
Group's own asset host, FinCEN, and the Commission's sanctions file service. Counts and
schema facts in §7.1 come from parsing the downloaded artifact, not from documentation
about it.

No open-source AML implementation was consulted, read, or used as a source for this
specification or for the engine it describes. The requirements here derive from
regulatory instruments, which are the same instruments any such implementation is itself
attempting to satisfy.

[^d4-8-4a]: Directive (EU) 2015/849, Art. 8(4)(a).
[^d4-11-c]: Directive (EU) 2015/849, Art. 11(c).
[^d4-13-1-d]: Directive (EU) 2015/849, Art. 13(1)(d).
[^d4-33-1a]: Directive (EU) 2015/849, Art. 33(1)(a).
[^d4-33-1-fin]: Directive (EU) 2015/849, Art. 33(1) final subparagraph.
[^d4-39]: Directive (EU) 2015/849, Art. 39(1)–(5).
[^d4-40-1-2]: Directive (EU) 2015/849, Art. 40(1) second subparagraph.
[^d4-41-2]: Directive (EU) 2015/849, Art. 41(2).
[^d5-18-2]: Directive (EU) 2018/843, Art. 1(10)(b), replacing Art. 18(2) AMLD4.
[^amlr-19-1b]: Regulation (EU) 2024/1624, Art. 19(1)(b).
[^amlr-19-2]: Regulation (EU) 2024/1624, Art. 19(2).
[^amlr-19-3]: Regulation (EU) 2024/1624, Art. 19(3)(a)–(b).
[^amlr-19-4]: Regulation (EU) 2024/1624, Art. 19(4).
[^amlr-19-5]: Regulation (EU) 2024/1624, Art. 19(5).
[^amlr-19-9]: Regulation (EU) 2024/1624, Art. 19(9)(a)–(d).
[^amlr-26-1]: Regulation (EU) 2024/1624, Art. 26(1).
[^amlr-26-2]: Regulation (EU) 2024/1624, Art. 26(2)(a)–(b).
[^amlr-26-3]: Regulation (EU) 2024/1624, Art. 26(3)(a)–(c).
[^amlr-26-4]: Regulation (EU) 2024/1624, Art. 26(4).
[^amlr-34-2]: Regulation (EU) 2024/1624, Art. 34(2)(a)–(d).
[^amlr-69-1]: Regulation (EU) 2024/1624, Art. 69(1) third and fourth subparagraphs.
[^amlr-69-1-2]: Regulation (EU) 2024/1624, Art. 69(1) second subparagraph.
[^amlr-69-2]: Regulation (EU) 2024/1624, Art. 69(2) second subparagraph.
[^amlr-69-2-1]: Regulation (EU) 2024/1624, Art. 69(2) first subparagraph.
[^amlr-71-1]: Regulation (EU) 2024/1624, Art. 71(1).
[^amlr-77-1b]: Regulation (EU) 2024/1624, Art. 77(1)(b).
[^amlr-77-1-fin]: Regulation (EU) 2024/1624, Art. 77(1) final subparagraph.
[^amlr-77-3]: Regulation (EU) 2024/1624, Art. 77(3).
[^amlr-78]: Regulation (EU) 2024/1624, Art. 78.
[^tfr-14]: Regulation (EU) 2023/1113, Art. 14(1)–(2), read against Art. 5(2) and Art. 6(2).
[^mlr-19-4]: MLR 2017 (SI 2017/692), reg. 19(4)(a).
[^mlr-27-1]: MLR 2017, reg. 27(1)(b).
[^mlr-27-2]: MLR 2017, reg. 27(2), as amended by SI 2026/621.
[^mlr-27-3]: MLR 2017, reg. 27(3), as amended by SI 2026/621.
[^mlr-27-5]: MLR 2017, reg. 27(5)–(7).
[^mlr-27-7e]: MLR 2017, reg. 27(7E), inserted by SI 2022/860.
[^mlr-28-11]: MLR 2017, reg. 28(11)(a)–(b).
[^mlr-28-14]: MLR 2017, reg. 28(14)–(15).
[^mlr-40-2b]: MLR 2017, reg. 40(2)(b).
[^mlr-40-4]: MLR 2017, reg. 40(4).
[^poca-333a]: Proceeds of Crime Act 2002, s.333A.
[^poca-335-5]: Proceeds of Crime Act 2002, s.335(5).
[^poca-335-6]: Proceeds of Crime Act 2002, s.335(6).
[^poca-335-7]: Proceeds of Crime Act 2002, s.335(7).
[^poca-336a-4]: Proceeds of Crime Act 2002, s.336A(4).
[^poca-336a-7]: Proceeds of Crime Act 2002, s.336A(7).
[^ukfiu-12]: UKFIU SARs Best Practice Guidance, Chapter 3, p.12.
[^ukfiu-14]: UKFIU SARs Best Practice Guidance, Chapter 3, p.14.
[^eba-3-6]: EBA/GL/2021/02, Guideline 3.6.
[^eba-3-7]: EBA/GL/2021/02, Guideline 3.7.
[^eba-4-60]: EBA/GL/2021/02, Guideline 4.60(a), as replaced by EBA/GL/2024/01.
[^eba-4-74a]: EBA/GL/2021/02, Guideline 4.74(a)(i)–(ii).
[^eba-4-75]: EBA/GL/2021/02, Guideline 4.75.
[^eba-rm-13]: EBA/GL/2024/15, §4.1.3, para 13.
[^eba-rm-16]: EBA/GL/2024/15, §4.1.4, para 16(a)–(d).
[^eba-rm-17]: EBA/GL/2024/15, §4.1.4, para 17(a)–(c).
[^eba-rm-18]: EBA/GL/2024/15, §4.1.4, para 18(a)–(c).
[^eba-rm-19]: EBA/GL/2024/15, §4.1.5, para 19.
[^eba-rm-20]: EBA/GL/2024/15, §4.1.5, paras 20–21.
[^eba-rm-24]: EBA/GL/2024/15, §4.1.6, para 24(a)–(b), para 25.
[^eba-rm-34]: EBA/GL/2024/15, §4.2.2, paras 34–35.
[^eba-rm-45]: EBA/GL/2024/15, §4.2.5, para 45(a)–(e).
[^eba-rm-46]: EBA/GL/2024/15, §4.2.5, para 46.
[^fcg-3-2-5a]: FCA Financial Crime Guide, FCG 3.2.5A (Financial Crime Guide (Amendment) Instrument 2024, in force 29 Nov 2024).
[^fcg-3-2-5g]: FCA Financial Crime Guide, FCG 3.2.5G.
[^jm-5-7]: JMLSG Guidance Part I, Ch.5 s.5.7 "Monitoring customer activity".
[^jm-5-7-3]: JMLSG Guidance Part I, para 5.7.3.
[^jm-5-7-4]: JMLSG Guidance Part I, para 5.7.4.
[^jm-5-7-5]: JMLSG Guidance Part I, para 5.7.5.
[^jm-5-7-15]: JMLSG Guidance Part I, para 5.7.15.
[^jm-5-7-18]: JMLSG Guidance Part I, para 5.7.18.
[^jm-5-7-20]: JMLSG Guidance Part I, para 5.7.20.
[^jm-6-32]: JMLSG Guidance Part I, para 6.32.
[^jm-8-6]: JMLSG Guidance Part I, paras 8.6–8.7.
[^co-52g]: EBA/GL/2022/05, §4.2.4(f), para 52(g).
[^w-msa1]: Wolfsberg Group, Statement on Effective Monitoring for Suspicious Activity, Part I (2024), Introduction.
[^w-msa2-cov]: Wolfsberg Group, Statement on Effective Monitoring for Suspicious Activity, Part II (2025), "Risk coverage".
[^w-msa2-usage]: Wolfsberg Group, Statement on Effective Monitoring for Suspicious Activity, Part II (2025), "Model usage".
[^w-ai-4]: Wolfsberg Principles for Using AI/ML in Financial Crime Compliance (2022), Principle 4.
[^w-cb-6]: Wolfsberg Group, Financial Crime Principles for Correspondent Banking (2022), §6.
[^w-scr-1]: Wolfsberg Group, Guidance on Sanctions Screening (2019), §1.
