---
hip: 0526
title: Semantic Memory — The Substrate Under the Graph
author: Hanzo AI
type: Standards Track
category: Core
status: Draft
implementation-go: partial
created: 2026-09-09
requires: HIP-0111, HIP-0522, HIP-1198
---

# HIP-0526: Semantic Memory — The Substrate Under the Graph

## Abstract

Three HIPs describe what the estate does with an assertion and none describes
where one comes from. This HIP specifies that: how a source becomes a document,
a document becomes chunks, a chunk becomes assertions, and an assertion keeps
the span it was read from. It states the values, the five stages, the three
stores, the provenance vocabulary, the decision record and one measured finding
about retrieval — as a contract, so a second implementation in another language
holds the same shapes and interoperates with the first.

It specifies no address. `/v1/graph` is HIP-1198's; the noun those assertions
land as is HIP-0522's; documents and their vector index are HIP-1260's. This is
what sits under all three.

The reference implementation is **`github.com/hanzoai/semantic`** v0.2.2 (MIT,
Go): fifteen packages, 30,717 lines outside tests and 16,052 in them, with
eighteen runnable example programs under `examples/`.

## Motivation

HIP-1198 §2 defines an assertion as a stored row carrying provenance columns and
a derived instant, and specifies the plane that serves it. HIP-0522 defines
entities and edges as one noun and says in as many words that turning documents
into entities is somebody else's job. HIP-1260 owns documents and their vector
index, and computes its link graph at read rather than storing one.

The step between "a PDF arrived" and "here is a subject, a predicate, an object
and the sentence they were read from" is therefore unwritten. It is where most
of the work is, and it is where the two mistakes that cannot be corrected later
are made.

**An assertion that arrives without its span cannot be checked afterwards.** It
has a confidence, and a confidence is not evidence: no reader can return to the
sentence and see whether the extractor read it correctly, or whether the
sentence says the opposite. HIP-1198 §5 stamps who filed a claim, which is a
different fact and does not substitute — by the time a claim reaches an address
the text it came from is gone unless the pipeline carried it. Adding the span
later is not possible, because the extraction that knew it has finished.

**A pipeline written once per language drifts once per language.** Three
runtimes each holding their own idea of what a chunk is produce three vector
indexes whose identifiers denote different things, and the divergence is
discovered when two of them are asked the same question and disagree. One
specified set of values is what makes a Python ingest and a Go reader address
the same evidence.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted
as in RFC 2119.

### §1 What this specifies

This HIP specifies VALUES and INTERFACES. It specifies no HTTP address, no
storage engine, no request encoding and no model.

| question | answered by | why not here |
|---|---|---|
| what a document, a chunk and an assertion ARE | this HIP | nothing else names them |
| how a source becomes an assertion | this HIP | HIP-0522 excludes extraction by design |
| what an assertion means once stored, and how conflicts resolve | HIP-1198 §2 | the served plane owns the order and the derived instant |
| entities, edges and decisions as one queryable noun | HIP-0522 | one noun, one owner |
| documents, their vector index and the link graph over them | HIP-1260 | a projection of records the tenant already holds |
| a ranked answer fused across indexes | HIP-1147 | fusion owns no store |
| who the caller is | HIP-0111 | one auth authority |

An implementation of this HIP is a library. It MUST NOT open a network listener,
resolve a tenant, or hold a credential; §8 says where those belong.

### §2 The values

Three values, and no fourth.

A **document** is one parsed source: a stable id, the reference it came from,
its text, and what the reader learned about it. A **chunk** is a span of a
document sized for extraction: the document id, its ordinal, and its text. An
**assertion** is one claim an extractor found — a subject, a predicate, an
object — carrying the chunk it was read from and the confidence it was given.

    Doc     { ID, Source, Text, Meta }
    Chunk   { DocID, Index, Text }
    Triple  { Subject, Predicate, Object, From Chunk, Score }

Four requirements hold over them.

1. **An assertion MUST carry the chunk it was read from.** A value that cannot
   be resolved back to a document is something the caller supplied, not
   something a source asserted, and an implementation MUST NOT represent the two
   identically. This is the property the rest of the specification exists to
   preserve, and it is the one that cannot be restored after the fact.

2. **A document MUST record its origin.** At minimum: the reference, the byte
   offset and size within it, the modification time, a content hash and the
   media type. The reference implementation writes these into `Doc.Meta` under
   an `Origin` and reads them back through one accessor
   (`ingest/ingest.go:60-84`, `:117`).

3. **Identity is computed, not assigned.** The identifier of an assertion is a
   hash over its folded triple, so the same claim names itself identically in
   every process, every run and every runtime. Two operations are normative
   because provenance (§5) and decisions (§6) point at the result:

   - **fold(s)** — trim leading and trailing whitespace, collapse internal runs
     of whitespace to one space, lower-case. Two spellings that fold alike are
     one term.
   - **id(s, p, o)** — FNV-1a (64-bit) over `fold(s)`, `fold(p)`, `fold(o)`,
     each followed by a single `0x00` byte, rendered as sixteen lower-case hex
     digits.

   An implementation that mints identifiers another way is not interoperable
   with one that follows this, because an id minted in one will not resolve in
   the other. (`kg/kg.go:44-60`.)

4. **Repetition is not duplication.** The same assertion arriving twice is one
   edge with a higher count, the better confidence of the two, and both sources
   recorded. An extractor that states no confidence is not stating zero
   confidence, so an absent score MUST be read as full confidence rather than as
   none.

**Temporal bounds.** An assertion MAY carry the stretch of time it is held true,
as a span with an open zero bound at either end, and a read MAY be bounded by an
instant. Conversational and organizational memory is mostly about when something
was true, so three instants have to stay apart and an implementation MUST NOT
collapse them:

- **from** and **until** — when the world was that way.
- the **as-of** instant of a read — which state of belief is being asked for.
  HIP-1198 §4 derives this server-side from the later of the filer's claim and
  the server clock, and §8 here explains why a library cannot.

Closing a span MUST only ever shorten it, so closing something twice cannot
revive it. **A retraction MUST NOT be a delete.** Closing a span keeps the
record and the fact that it was withdrawn; deleting the row makes "nobody ever
said so" and "somebody said so and took it back" the same answer, and they are
not. Erasure is a separate operation that removes the record and leaves a
tombstone — the proof that something was removed, without the thing itself.
(`agent/graph.go:30-95`.)

### §3 The stages

Five interfaces, each with one method, each taking the previous stage's value
and returning the next.

    Ingester   (ref)   -> []Doc      the only stage that touches the world
    Parser     (Doc)   -> Doc        text made plain, structure into Meta
    Normalizer (string)-> string     one transform; a chain is a composition
    Splitter   (Doc)   -> []Chunk    boundaries that keep meaning whole
    Extractor  (Chunk) -> []Triple   the chunk travels with every assertion

A pipeline is their composition and nothing else. Six requirements:

1. **A stage MUST NOT depend on a later one.** Parsing never opens a file:
   turning a source into a document is the ingester's job, and what a parser
   reads is `Doc.Text`. A parser MUST NOT mutate the caller's document; it
   returns a document carrying a copy of the metadata.

2. **A nil stage is skipped.** A caller who wants only to split MUST NOT have to
   supply an extractor. The one exception is the ingester, because there is
   nothing to read without one, and a pipeline missing it is an error rather
   than an empty answer.

3. **Chunks MUST tile the text.** With zero overlap, the chunks of a document
   concatenate back into the document byte for byte, and a chunk boundary never
   falls inside a rune. This is not tidiness — it is what makes §2's span
   resolvable back to an offset in the source, and a splitter that drops or
   duplicates bytes silently breaks every claim of evidence downstream.

4. **Extraction MUST sit behind a model interface, and the deterministic path
   MUST work with no model at all.** The interface is one method:

       Complete(ctx, prompt string, schema any) (string, error)

   It takes no credential and no endpoint (§8). An implementation MUST provide a
   rule-based extractor that reaches no network, because that is what makes the
   pipeline testable without a key and what a deployment falls back to when the
   gateway is unreachable. The measurement in §7 was produced entirely on that
   path.

5. **A schema check and a confidence floor are orthogonal and MUST stay so.**
   One asks whether an extraction is in the vocabulary; the other asks whether
   it is sure enough. An implementation MUST NOT fold them into a single
   threshold.

6. **Ingest drivers extend by registration, not by fork.** The readers a
   standard library can serve honestly — files, directory trees, HTTP(S),
   readers already in memory — are the built-in set. Everything else (object
   stores, SaaS APIs, databases, queues) implements the same `Ingester` under a
   scheme in a registry. **No source is faked**: a driver that cannot read what
   it names MUST fail rather than return an empty document set.

### §4 The stores

Three questions, three interfaces. They are separate because they answer
separate questions, and a deployment MAY back all three with one engine.

    Vector    Put(id, vec, meta)        Near(vec, k) -> []Match
    Graph     Node(id, props)  Edge(from, to, label)  Out(id) -> []id
    Triple    Assert(s, p, o)           Match(s, p, o) -> [][3]string

Requirements:

1. **The vector interface MUST admit a metadata filter on the query.** §7's
   finding depends on scoping a search by a field rather than on standing up a
   second index, and an interface without a filter forces the second index. In
   the reference implementation the query carries the filter and the namespace
   is an ordinary metadata key (`store/mem.go:22-67`, `store/filter.go`).

2. **A store MUST NOT be selected at compile time.** Which engine backs which
   question is a run-time fact, so drivers register under a name and a caller
   opens one from a data source name. A name registered with no implementation
   MUST report that this build cannot serve it, distinctly from a name nobody
   has heard of — the two are different operator problems and one error message
   for both wastes an afternoon (`store/drivers.go:80-107`).

3. **A store MUST NOT be required for the library to work.** In-memory and file
   implementations of all three are the default, so the pipeline, its tests and
   its examples run with no database. The reference implementation additionally
   ships Qdrant over its JSON HTTP API for vectors and a SPARQL 1.1 endpoint for
   triples, and names six further vector, four graph and two triple drivers as
   registered-but-unimplemented.

### §5 Provenance

**W3C PROV-O, vocabulary verbatim.** An Entity was generated by an Activity,
which was associated with an Agent; an Activity used entities and ran over an
interval; an Entity was derived from other entities.

    Entity    { ID, GeneratedBy Activity, DerivedFrom []Entity }
    Activity  { ID, Kind, Agent, Start, End, Used []Entity }
    Agent     { ID, Kind }              // person, software, organization
    Log       Entity(), Activity(), Agent(), Trace(id) -> []Activity

An implementation MUST use the PROV-O terms as they stand — `wasGeneratedBy`,
`wasDerivedFrom`, `used`, `wasAssociatedWith`, `startedAtTime`, `endedAtTime` —
and MUST NOT rename them. Renaming costs a translation at every boundary the
record crosses and buys nothing; keeping them means the record joins other PROV
data untranslated, which is the whole reason to adopt an external vocabulary
rather than write one.

**Every derived assertion MUST record what it was derived from.** A derivation
naming no antecedents is not a derivation, and an assertion nobody can explain
is not evidence — deriving it was pointless if nothing can answer for it later.
Where derivation is by forward chaining, each derived fact MUST also name the
rule that produced it, so there is one place to look when asking why
(`reason/reason.go:1-12`).

**The record is append-only, and it is not a second copy of an audit trail.**
HIP-0522 establishes that where a hash-chained audit record already exists,
provenance is a projection over it and a second store holding the same facts is
forbidden. That constraint and this one are consistent: a library writes what it
derived, because nothing else saw the derivation happen; a served plane that
already holds a chain MUST project rather than duplicate.

### §6 Decisions

The layer the graph exists for: what an agent knew, what it chose, under which
rule, and what followed.

    Record   { ID, Agent, Choice, Because []id, Rule, At }
    Policy   Allow(ctx, agent, choice) -> (bool, reason)
    Recorder Record(r)   By(agent) -> []Record
    Cause    Chain(id)   -> []Record

`Because` names assertion or entity identifiers, which is why §2's identity rule
is normative rather than advisory: a decision that cites evidence by an
identifier only one runtime can mint is unciteable from any other.

Two requirements:

1. **A refusal is a decision with a reason, not an error.** An implementation
   MUST record a refused choice with the rule that refused it and the reason it
   gave, and MUST NOT return it to the caller as an error and drop it. An agent
   that was stopped still made a choice, and why it was stopped is the part
   somebody reads months later. A policy answers before the act, so this is
   expressible at the point of decision rather than reconstructed from a
   failure.

2. **The explanation is the walk, not a stored narrative.** `Chain` returns the
   decisions a decision rests on. An implementation MUST NOT store a separate
   prose rationale as the answer to "why", because it is free to drift from the
   graph it explains and nothing detects the drift. This restates HIP-0522's
   position at the level of the library.

### §7 Retrieval

One finding, measured, with its limits stated. It is reported here because it
constrains §4's interface and nothing else in the corpus records it.

**The measurement.** LoCoMo (Maharana et al.) asks what a system remembers of a
conversation held over months: ten conversations, 272 sessions, 5,882 turns,
1,986 questions, typed as single-hop, multi-hop, temporal, open-domain and
adversarial. Two memories were built over the same turns, asked the same
questions by the same reader, and marked by the dataset's own scorer. They
differ in exactly one thing: the second filters retrieval candidates by the
person the question names before ranking them. Both rank by cosine over the same
weighted terms through the same in-memory store.

    go run ./bench/locomo            # hanzoai/semantic v0.2.2, measured 2026-09-09

    category         n    subject-scoped        flat
    answerable    1540    0.142  r 0.444    0.144  r 0.471
    adversarial    446    0.502  r 0.135    0.200  r 0.511

F1 is the official metric; `r` is the share of a question's annotated evidence
the memory returned, which owes nothing to the reader. Bootstrap confidence
intervals over the ten conversations: adversarial [+0.248, +0.347], answerable
[-0.010, +0.006].

**What this supports.** Scoping retrieval to the subject a question names makes
an index selectively blind to turns about other people. The mechanism is
measurable and independent of the reader: run with the top-k lifted past the
number of turns and the recall column stops measuring ranking and starts
measuring reach. The scoped index can reach 58–79% of the annotated evidence for
questions that have an answer and 27% for questions that do not; the flat index
reaches 96–99% of both. Its abstention therefore carries some signal about
whether a question is answerable at all (ROC AUC 0.684) where the flat index's
carries none (0.520, which is chance).

**What this does not support, stated because two plausible readings are wrong.**

- **It is not a result about graph structure.** Emptying the graph entirely
  leaves every number above byte-identical. The graph is where read turns are
  kept; it is not what answers.
- **It is not a result about inference.** Forward chaining derived 44 facts from
  23,942 across all ten conversations. At this scale inference contributed
  nothing, which is a finding about where the value in this kind of memory sits,
  not a defect in the reasoner.
- **About half the effect is the filter alone.** Adding only the subject
  partition to the unchanged baseline turn index reaches 0.354 on adversarial
  questions; the claim-span index with the filter removed reaches 0.170, below
  the flat baseline.
- **Perfect retrieval is a liability on these questions.** An arm handed the
  dataset's own annotated evidence scores 0.426 adversarial, below the scoped
  index's 0.502, because on a trap question the trap turn *is* the annotated
  evidence.
- **No aggregate over the whole question set means anything.** A system replying
  "No information available" to all 1,986 questions scores 0.228 on this metric,
  which is above every arm. A quarter of the questions are adversarial and the
  scorer rewards declining them. Only the answerable/adversarial split is
  readable.
- **Absolute F1 is not comparable to published numbers.** No model was called,
  in either arm or in the reader; the reader is deterministic and extractive and
  its own ceiling is 0.306 on answerable questions even with perfect retrieval.
  The two columns are comparable to each other because they differ in one thing.

The port of the official scorer is held against the Python it ports —
`task_eval/evaluation.py` and the stemmer it calls — across all 1,986 questions
and four arms, and agrees to three decimals. `bench/locomo/README.md` carries
the full tables, the threshold sweep at matched abstention, and the reproduction
commands. The wider negative result on multi-hop retrieval, measured over the
same dataset with a dense retriever, is `hanzoai/papers`,
`hanzo-multi-hop-retrieval`.

**What follows normatively**, kept proportional to the evidence: a retrieval
interface MUST admit a metadata filter (§4.1), and an implementation SHOULD
scope retrieval by the subject a question names when the question names one.
This is a claim about which questions a memory declines, not a claim about the
quality of the answers it gives.

### §8 Tenant and identity

**IAM is the only authority, per HIP-0111.** The tenant comes from the validated
principal and from nothing else. A request field naming an organization MUST NOT
exist, and where one exists it MUST be ignored.

A library implementing this HIP holds no identity, and that division is
deliberate rather than an omission. The scope value the reference implementation
carries — agent, session, task — is a filter over what one agent may see, not a
credential; it says which of its own notes an agent is asking about. A library
that resolved a tenant would be a second answer to a question IAM already
answers, and the two would disagree eventually.

A served surface over this substrate MUST therefore:

1. Resolve the organization from the validated principal, refusing before any
   store is opened when there is none (HIP-1198 §5).
2. Stamp the filing identity server-side and never take it from the body. A
   plane whose product is provenance certifies whatever the caller typed if it
   does otherwise.
3. Isolate a tenant by holding a separate store rather than by adding a
   predicate to a shared one, so a cross-tenant read is unspellable rather than
   merely forbidden.

**Credentials never reach this layer.** The model interface in §3.4 takes no key
and no endpoint: an adapter binds it to the gateway (HIP-0004), which is where
provider credentials are held, and a secret is named by its path rather than
carried as a configuration value (HIP-0136).

### §9 Conformance

A second implementation interoperates with the reference one when all six hold.
They are the whole list.

1. The three values of §2 with those field names, and an assertion carrying the
   chunk it was read from.
2. The identity function of §2.3 — fold, then FNV-1a over the NUL-separated
   folded parts, sixteen hex digits — so an id minted in one runtime resolves in
   the other.
3. Chunks that tile, so a span resolves to an offset in the source.
4. PROV-O terms verbatim, and every derived assertion naming its antecedents.
5. A refusal recorded as a decision with its rule and reason.
6. A retrieval interface admitting a metadata filter.

**What the reference runtime carries today**: all five stages; the three store
interfaces with in-memory and file implementations plus Qdrant and SPARQL; the
provenance record; the decision layer over a graph whose nodes and edges carry
spans; eighteen runnable examples; the measurement harness of §7.

**What it does not carry**, which is why this proposal is Draft rather than
Final:

- The root assertion value carries no temporal bounds. The span model of §2 is
  implemented on the agent's graph (`agent/graph.go`) and not on
  `semantic.Triple`, so a pipeline's output is untimed until it reaches that
  graph. Closing that gap is a field on the value and a bound on the read; it
  changes no interface in §3.
- The library binds no identity, correctly (§8), so §8's requirements are
  requirements on whatever serves it. Today that is HIP-1198's plane and nothing
  else.

## Rationale

**Three store interfaces rather than one.** A single interface over similarity,
adjacency and assertion would have to be the union of three query shapes, and
every backend would implement two thirds of it by returning an error. Three
interfaces let one engine answer all three questions when it can — the in-memory
store here registers under all three — while a deployment that wants a
purpose-built index per question changes one registration. The cost is that a
caller wanting all three names three things.

**An assertion carrying its span rather than a confidence alone.** Carrying the
chunk costs memory in the pipeline and a column in any store. Not carrying it is
cheaper and forecloses every later check, because the extraction that knew the
span has finished by the time anyone wants it. This is the one decision in the
document that cannot be revisited later, which is why it is the first
requirement rather than a recommendation.

**Extraction as a library stage rather than a gateway feature.** Putting
extraction behind the model API would make every pipeline a network call and
make the deterministic path impossible, which would in turn make the measurement
in §7 unreproducible without a key. The model interface is one method precisely
so that binding it to the gateway is an adapter and not an architecture.

**PROV-O rather than a vocabulary of our own.** A local vocabulary would be
shorter and would fit the three values here more exactly. It would also need a
translation at every boundary where the record meets provenance data from
anywhere else, and translations are where fields quietly stop meaning what they
meant. The external vocabulary is worth its slight misfit.

**A library rather than a service.** A service would give one deployment and one
version, and would put a network hop between a document and its chunks. The
estate already has the service — HIP-1198's plane — and what it lacked was
something the plane, a batch job, a CLI and a test could all use without one of
them standing up an address. The cost is that conformance must be specified in
prose, which is §9.

## Security Considerations

**A span or a filing identity taken from the caller.** Both are the same defect
in two places: a record whose provenance the caller chose is not provenance. An
implementation MUST derive the span from the extraction that produced the
assertion, and a served surface MUST stamp the filing identity from the
principal (§8.2). An as-of read bounded by a caller-declared instant is
backdating — file today, claim it was knowable a year ago — and every horizon in
the store becomes decorative. The bound must be derived (HIP-1198 §4).

**A document is untrusted input, and extraction executes it.** An extractor that
asks a model to read a document is running text written by whoever wrote the
document. An assertion returned by that model MUST be treated as data and never
as an instruction to the surrounding program, and a schema check (§3.5) is the
mechanism that keeps an extraction inside a known vocabulary. This matters more
here than in ordinary retrieval because assertions persist and are read back
later as evidence: an injected claim is not a bad answer once, it is a false
premise for every decision that later cites it. A pipeline SHOULD record the
extractor and the model that produced each assertion (§5) so an injected batch
can be identified and retracted as a set.

**Ingest is the only stage that touches the world.** A reference is a
caller-supplied URL or path, so an ingester is a request forger and a file
reader unless it is bounded. Drivers MUST bound what they will resolve — scheme,
host and path — and MUST NOT follow a redirect out of the bound. Because this is
the only stage with that exposure, bounding it once is sufficient, which is a
reason to keep the stages separate.

**A vector index is not less sensitive than the text it was built from.** The
embeddings of a tenant's documents are derived from those documents, and
nearest-neighbour queries over a shared index disclose membership even when no
text is returned. An index MUST sit inside the same tenant boundary as the text,
and MUST NOT be treated as public metadata on the grounds that it holds no
strings.

**Retraction is not erasure, and MUST NOT be served as one.** Closing a span
withdraws a claim and keeps the record (§2). A request to erase — a legal
deletion, a revoked source — MUST remove the record and leave a tombstone.
Serving an erasure request by closing a span leaves the data in the store while
reporting that it is gone, which is the worse of the two failures because it is
silent.

**A derived assertion with no antecedents** is indistinguishable from an
asserted one, so a store that accepts it loses the ability to tell what the
system was told from what it concluded. §5 requires the antecedents; an
implementation SHOULD refuse the write rather than record the derivation without
them.

## References

- HIP-0000 — Hanzo AI Architecture and Framework
- HIP-0004 — LLM Gateway, the unified provider interface the model adapter binds to
- HIP-0111 — Hanzo IAM Authentication Standard
- HIP-0114 — ZAP, the transport a served surface over this substrate speaks
- HIP-0136 — One Secret, One Path
- HIP-0522 — The Context Graph, the noun assertions land as
- HIP-1147 — Search, hybrid retrieval over the indexes
- HIP-1198 — Graph, the assertion plane at `/v1/graph`
- HIP-1260 — Knowledge, documents and their vector index
- W3C PROV-O — the provenance vocabulary §5 keeps verbatim
- `github.com/hanzoai/semantic` — the reference implementation
- `bench/locomo/README.md` in that repository — §7's tables, sweeps and reproduction
- `hanzoai/papers`, `hanzo-multi-hop-retrieval` — the multi-hop retrieval result over the same dataset

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
